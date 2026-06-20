"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { getAccessTokenWithRetry } from "@/lib/supabase/session";

type UploadTarget = "user_mesh" | "sample";
type UploadPurpose =
  | "replace_failed"
  | "external_tool"
  | "test_data"
  | "sample"
  | "quality_replacement";

type ProfileResponse = {
  data: {
    role: "user" | "admin";
  };
};

type UploadResponse = {
  data: {
    humanMeshId: string | null;
    modelObjectPath: string;
    adminUploadId: string;
    action: "replace" | "sample_create";
  };
};

export function AdminModelUploadForm() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [target, setTarget] = useState<UploadTarget>("user_mesh");
  const [targetUserId, setTargetUserId] = useState("");
  const [humanMeshId, setHumanMeshId] = useState("");
  const [purpose, setPurpose] = useState<UploadPurpose>("replace_failed");
  const [reason, setReason] = useState("");
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<UploadResponse["data"] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkAdminRole() {
      if (!supabase) {
        setError("Supabase 환경 변수가 설정되지 않았습니다.");
        setAuthorized(false);
        return;
      }

      const token = await getAccessTokenWithRetry(supabase);

      if (!token) {
        setAuthorized(false);
        return;
      }

      const response = await fetch("/api/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (cancelled) {
        return;
      }

      if (!response.ok) {
        setAuthorized(false);
        return;
      }

      const profile = (await response.json()) as ProfileResponse;
      setAuthorized(profile.data.role === "admin");
    }

    void checkAdminRole();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  function handleTargetChange(nextTarget: UploadTarget) {
    setTarget(nextTarget);
    setPurpose(nextTarget === "sample" ? "sample" : "replace_failed");
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!supabase) {
      setError("Supabase 환경 변수가 설정되지 않았습니다.");
      return;
    }

    if (!modelFile) {
      setError("GLB 또는 GLTF 파일을 선택해주세요.");
      return;
    }

    if (target === "user_mesh" && !humanMeshId.trim()) {
      setError("교체할 Human Mesh ID가 필요합니다.");
      return;
    }

    setPending(true);

    try {
      const token = await getAccessTokenWithRetry(supabase);

      if (!token) {
        throw new Error("로그인이 필요합니다.");
      }

      const formData = new FormData();
      formData.append("modelFile", modelFile);
      formData.append("purpose", target === "sample" ? "sample" : purpose);
      formData.append("reason", reason);

      if (target === "user_mesh") {
        formData.append("humanMeshId", humanMeshId.trim());

        if (targetUserId.trim()) {
          formData.append("targetUserId", targetUserId.trim());
        }
      }

      const response = await fetch("/api/admin/models/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error?.message ?? "관리자 모델 업로드에 실패했습니다.");
      }

      setSuccess((body as UploadResponse).data);
      setModelFile(null);
      setReason("");
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "관리자 모델 업로드에 실패했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  if (authorized === null) {
    return <p className="text-sm text-zinc-500">관리자 권한을 확인하는 중입니다.</p>;
  }

  if (!authorized) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        관리자 권한이 필요합니다.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      <fieldset className="grid gap-3">
        <legend className="text-sm font-semibold text-zinc-950">업로드 대상</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <TargetButton
            selected={target === "user_mesh"}
            title="사용자 모델 교체"
            description="기존 Human Mesh 결과를 관리자 모델로 교체"
            onClick={() => handleTargetChange("user_mesh")}
          />
          <TargetButton
            selected={target === "sample"}
            title="샘플 모델 등록"
            description="랜딩·테스트용 독립 샘플 파일 저장"
            onClick={() => handleTargetChange("sample")}
          />
        </div>
      </fieldset>

      {target === "user_mesh" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Human Mesh ID" required>
            <input
              value={humanMeshId}
              onChange={(event) => setHumanMeshId(event.target.value)}
              placeholder="교체할 mesh UUID"
              className="h-11 w-full rounded-md border border-zinc-300 px-3 text-sm"
              required
            />
          </Field>
          <Field label="대상 사용자 ID" hint="선택 입력, 소유자 검증용">
            <input
              value={targetUserId}
              onChange={(event) => setTargetUserId(event.target.value)}
              placeholder="사용자 UUID"
              className="h-11 w-full rounded-md border border-zinc-300 px-3 text-sm"
            />
          </Field>
        </div>
      ) : (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          샘플 파일과 감사 이력이 저장됩니다. Gallery 노출 연결은 별도 기능입니다.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="모델 파일" hint="GLB 또는 외부 리소스가 없는 GLTF, 최대 100MB" required>
          <input
            type="file"
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            onChange={(event) => setModelFile(event.target.files?.[0] ?? null)}
            className="block w-full rounded-md border border-zinc-300 p-2 text-sm"
            required
          />
        </Field>

        <Field label="업로드 목적" required>
          <select
            value={target === "sample" ? "sample" : purpose}
            onChange={(event) => setPurpose(event.target.value as UploadPurpose)}
            disabled={target === "sample"}
            className="h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm disabled:bg-zinc-100"
          >
            <option value="replace_failed">AI 실패 대응</option>
            <option value="external_tool">외부 툴 결과</option>
            <option value="test_data">테스트 데이터</option>
            <option value="quality_replacement">품질 개선 교체</option>
            <option value="sample">샘플</option>
          </select>
        </Field>
      </div>

      <Field label="작업 사유" hint="감사 로그에 기록됩니다. 최대 1000자">
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={1000}
          rows={4}
          className="w-full rounded-md border border-zinc-300 p-3 text-sm"
        />
      </Field>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <p className="font-semibold">모델 업로드가 완료되었습니다.</p>
          <p className="mt-1 break-all">Storage: {success.modelObjectPath}</p>
          <p className="mt-1 break-all">Audit ID: {success.adminUploadId}</p>
        </div>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {pending ? "업로드 중..." : "관리자 모델 업로드"}
        </button>
      </div>
    </form>
  );
}

function TargetButton({
  selected,
  title,
  description,
  onClick,
}: {
  selected: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-4 text-left ${
        selected ? "border-zinc-950 bg-zinc-50" : "border-zinc-200 bg-white"
      }`}
    >
      <span className="block text-sm font-semibold text-zinc-950">{title}</span>
      <span className="mt-1 block text-xs leading-5 text-zinc-500">{description}</span>
    </button>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium text-zinc-800">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}
