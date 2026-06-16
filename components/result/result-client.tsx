"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type MeshDetailResponse = {
  data: {
    id: string;
    title: string | null;
    status: string;
    inputImageCount: number;
    qualityGrade: string;
    modelSource: string;
    modelSignedUrl: string | null;
    thumbnailSignedUrl: string | null;
    latestJob: {
      id: string;
      status: string;
      progress: number | null;
      provider: string;
      modelName: string;
      errorCode: string | null;
      errorMessage: string | null;
    } | null;
    createdAt: string;
    completedAt: string | null;
    failedAt: string | null;
  };
};

type DownloadResponse = {
  data: {
    url: string;
    expiresIn: number;
  };
};

const FINAL_STATUSES = new Set(["completed", "failed", "canceled", "deleted"]);

export function ResultClient({ meshId }: { meshId: string }) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [mesh, setMesh] = useState<MeshDetailResponse["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function loadMesh() {
      if (!supabase) {
        setError("Supabase 환경 변수가 설정되지 않았습니다.");
        setLoading(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setError("로그인이 필요합니다.");
        setLoading(false);
        return;
      }

      const result = await fetch(`/api/meshes/${meshId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!result.ok) {
        const body = await result.json();
        setError(body.error?.message ?? "모델 정보를 불러오지 못했습니다.");
        setLoading(false);
        return;
      }

      const json = (await result.json()) as MeshDetailResponse;

      if (cancelled) {
        return;
      }

      setMesh(json.data);
      setLoading(false);
    }

    void loadMesh();
    intervalId = setInterval(() => {
      if (!mesh || !FINAL_STATUSES.has(mesh.status)) {
        void loadMesh();
      }
    }, 2500);

    return () => {
      cancelled = true;

      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [mesh, meshId, supabase]);

  async function handleDownload() {
    if (!supabase) {
      setError("Supabase 환경 변수가 설정되지 않았습니다.");
      return;
    }

    setDownloading(true);
    setError(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      setError("로그인이 필요합니다.");
      setDownloading(false);
      return;
    }

    const result = await fetch(`/api/meshes/${meshId}/download`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    setDownloading(false);

    if (!result.ok) {
      const body = await result.json();
      setError(body.error?.message ?? "다운로드 URL을 발급하지 못했습니다.");
      return;
    }

    const json = (await result.json()) as DownloadResponse;
    window.location.href = json.data.url;
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        모델 상태를 불러오는 중입니다.
      </section>
    );
  }

  if (error && !mesh) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        {error}{" "}
        <Link href="/login" className="font-semibold underline">
          로그인으로 이동
        </Link>
      </section>
    );
  }

  if (!mesh) {
    return null;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="grid min-h-[460px] place-items-center rounded-lg border border-zinc-200 bg-white p-6">
        {mesh.modelSignedUrl ? (
          <div className="text-center">
            <p className="text-sm font-semibold text-zinc-950">GLB 파일 준비 완료</p>
            <p className="mt-2 text-sm text-zinc-500">
              3D Viewer 렌더링은 다음 단계에서 연결합니다.
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-sm font-semibold text-zinc-950">모델 생성 진행 중</p>
            <p className="mt-2 text-sm text-zinc-500">
              현재 Provider는 개발용 stub이므로 실제 GLB 파일은 아직 생성되지 않습니다.
            </p>
          </div>
        )}
      </section>

      <aside className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-base font-semibold text-zinc-950">
          {mesh.title ?? "Photorealistic Human Mesh"}
        </h2>
        <dl className="mt-5 grid gap-3 text-sm">
          <InfoRow label="상태" value={mesh.status} />
          <InfoRow label="진행률" value={`${mesh.latestJob?.progress ?? 0}%`} />
          <InfoRow label="입력 사진" value={`${mesh.inputImageCount}장`} />
          <InfoRow label="품질 등급" value={mesh.qualityGrade} />
          <InfoRow label="생성 방식" value={mesh.modelSource} />
          <InfoRow label="Provider" value={mesh.latestJob?.provider ?? "-"} />
          <InfoRow label="생성일" value={new Date(mesh.createdAt).toLocaleString()} />
        </dl>

        {mesh.latestJob?.errorMessage ? (
          <p className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {mesh.latestJob.errorMessage}
          </p>
        ) : null}

        {error ? (
          <p className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={handleDownload}
          disabled={mesh.status !== "completed" || downloading}
          className="mt-6 h-11 w-full rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {downloading ? "URL 발급 중..." : "GLB 다운로드"}
        </button>
      </aside>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-zinc-100 pb-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-medium text-zinc-950">{value}</dd>
    </div>
  );
}
