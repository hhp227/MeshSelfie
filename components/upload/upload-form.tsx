"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { getAccessTokenWithRetry } from "@/lib/supabase/session";

type Direction = "left" | "right";

type UploadResponse = {
  data: {
    images: Array<{
      id: string;
      role: "front" | "side" | "angle45";
    }>;
  };
};

type GenerateResponse = {
  data: {
    humanMeshId: string;
    jobId: string;
  };
};

type UploadMode = "photos" | "scan";

type ScanUploadResponse = {
  data: {
    scanSessionId: string;
    inputKind: string;
    qualityGrade: string | null;
  };
};

export function UploadForm() {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [mode, setMode] = useState<UploadMode>("photos");
  const [scanVideo, setScanVideo] = useState<File | null>(null);
  const [frontImage, setFrontImage] = useState<File | null>(null);
  const [sideImage, setSideImage] = useState<File | null>(null);
  const [angle45Image, setAngle45Image] = useState<File | null>(null);
  const [sideDirection, setSideDirection] = useState<Direction>("left");
  const [angle45Direction, setAngle45Direction] = useState<Direction>("left");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function getAccessToken() {
    if (!supabase) {
      throw new Error("Supabase 환경 변수가 설정되지 않았습니다.");
    }

    const token = await getAccessTokenWithRetry(supabase);

    if (!token) {
      throw new Error("로그인이 필요합니다.");
    }

    return token;
  }

  async function handleScanSubmit() {
    if (!scanVideo) {
      setError("스캔 동영상을 선택해주세요.");
      return;
    }

    setPending(true);

    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append("video", scanVideo);

      setMessage("스캔 동영상을 업로드하는 중입니다.");

      const uploadResult = await fetch("/api/scans/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!uploadResult.ok) {
        const body = await uploadResult.json();
        throw new Error(body.error?.message ?? "스캔 업로드에 실패했습니다.");
      }

      const uploadJson = (await uploadResult.json()) as ScanUploadResponse;

      setMessage("3D 재구성을 요청하는 중입니다. 5~15분 정도 걸립니다.");

      const generateResult = await fetch("/api/scans/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scanSessionId: uploadJson.data.scanSessionId }),
      });

      if (!generateResult.ok) {
        const body = await generateResult.json();
        throw new Error(body.error?.message ?? "재구성 요청에 실패했습니다.");
      }

      const generateJson = (await generateResult.json()) as GenerateResponse;
      router.push(`/result/${generateJson.data.humanMeshId}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "요청 처리에 실패했습니다.");
      setPending(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (mode === "scan") {
      await handleScanSubmit();
      return;
    }

    if (!frontImage) {
      setError("정면 사진은 필수입니다.");
      return;
    }

    setPending(true);

    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append("frontImage", frontImage);

      if (sideImage) {
        formData.append("sideImage", sideImage);
        formData.append("sideDirection", sideDirection);
      }

      if (angle45Image) {
        formData.append("angle45Image", angle45Image);
        formData.append("angle45Direction", angle45Direction);
      }

      setMessage("이미지를 업로드하는 중입니다.");

      const uploadResult = await fetch("/api/uploads/images", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!uploadResult.ok) {
        const body = await uploadResult.json();
        throw new Error(body.error?.message ?? "이미지 업로드에 실패했습니다.");
      }

      const uploadJson = (await uploadResult.json()) as UploadResponse;
      const front = uploadJson.data.images.find((image) => image.role === "front");
      const side = uploadJson.data.images.find((image) => image.role === "side");
      const angle45 = uploadJson.data.images.find((image) => image.role === "angle45");

      if (!front) {
        throw new Error("업로드된 정면 이미지 ID를 찾을 수 없습니다.");
      }

      setMessage("3D 모델 생성을 요청하는 중입니다.");

      const generateResult = await fetch("/api/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          frontSourceImageId: front.id,
          sideSourceImageId: side?.id,
          angle45SourceImageId: angle45?.id,
        }),
      });

      if (!generateResult.ok) {
        const body = await generateResult.json();
        throw new Error(body.error?.message ?? "생성 요청에 실패했습니다.");
      }

      const generateJson = (await generateResult.json()) as GenerateResponse;
      router.push(`/result/${generateJson.data.humanMeshId}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "요청 처리에 실패했습니다.");
      setPending(false);
      return;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      <div className="grid grid-cols-2 rounded-lg border border-zinc-200 bg-white p-1 text-sm font-semibold">
        {(
          [
            ["photos", "사진 3장 (AI 생성)"],
            ["scan", "스캔 동영상 (Photogrammetry)"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`rounded-md px-3 py-2.5 ${
              mode === value ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "scan" ? (
        <>
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950">
            <p className="font-semibold">스캔 촬영 기준 (품질의 90%는 촬영이 결정합니다)</p>
            <ul className="mt-1 list-disc pl-5 leading-6 text-teal-900">
              <li>10~20초, 45MB 이하 MP4/MOV</li>
              <li>피사체는 완전 정지(표정·시선 고정), 카메라가 얼굴 주위로 천천히 반원 이동</li>
              <li>균일한 밝은 조명, 흔들림(블러) 없이, 얼굴이 화면의 절반 이상</li>
            </ul>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-950">스캔 동영상</h2>
              <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-600">필수</span>
            </div>
            <label className="mt-4 flex aspect-[3/1] cursor-pointer items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 text-center text-sm text-zinc-500 hover:bg-zinc-100">
              <input
                type="file"
                accept="video/mp4,video/quicktime"
                className="sr-only"
                onChange={(event) => setScanVideo(event.target.files?.[0] ?? null)}
              />
              {scanVideo
                ? `${scanVideo.name} (${(scanVideo.size / 1024 / 1024).toFixed(1)}MB)`
                : "MP4/MOV 선택 (10~20초 궤도 촬영)"}
            </label>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
          <p className="font-semibold">고정밀 얼굴·목 복원 촬영 기준</p>
          <p className="mt-1 leading-6 text-blue-900">
            가로·세로 최소 512px, 권장 1024px 이상 · 머리와 목 중심 · 동일한 표정과
            조명 · 머리카락이 귀, 턱선, 목을 가리지 않는 사진을 사용해주세요.
          </p>
        </div>
      )}
      <div className={mode === "scan" ? "hidden" : "grid gap-4 md:grid-cols-3"}>
        <UploadSlot
          title="정면 사진"
          requiredLabel="필수"
          description="얼굴이 정면을 바라보는 사진"
          file={frontImage}
          onFileChange={setFrontImage}
        />
        <UploadSlot
          title="측면 사진"
          requiredLabel="선택"
          description="왼쪽 또는 오른쪽 측면 사진"
          file={sideImage}
          onFileChange={setSideImage}
          direction={sideDirection}
          onDirectionChange={setSideDirection}
        />
        <UploadSlot
          title="45도 사진"
          requiredLabel="선택"
          description="왼쪽 또는 오른쪽 45도 사진"
          file={angle45Image}
          onFileChange={setAngle45Image}
          direction={angle45Direction}
          onDirectionChange={setAngle45Direction}
        />
      </div>

      {message ? (
        <p className="rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
          {message}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {pending
            ? "처리 중..."
            : mode === "scan"
              ? "업로드 후 3D 재구성 요청"
              : "업로드 후 생성 요청"}
        </button>
      </div>
    </form>
  );
}

function UploadSlot({
  title,
  requiredLabel,
  description,
  file,
  onFileChange,
  direction,
  onDirectionChange,
}: {
  title: string;
  requiredLabel: string;
  description: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  direction?: Direction;
  onDirectionChange?: (direction: Direction) => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-zinc-950">{title}</h2>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-600">
          {requiredLabel}
        </span>
      </div>
      <p className="mt-2 min-h-10 text-sm leading-5 text-zinc-500">{description}</p>
      <label className="mt-4 flex aspect-[4/3] cursor-pointer items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 text-center text-sm text-zinc-500 hover:bg-zinc-100">
        <input
          type="file"
          accept="image/jpeg,image/png"
          className="sr-only"
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        />
        {file ? file.name : "JPG/PNG 선택"}
      </label>

      {direction && onDirectionChange ? (
        <div className="mt-4 grid grid-cols-2 rounded-md border border-zinc-200 p-1 text-sm">
          {(["left", "right"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onDirectionChange(option)}
              className={`rounded px-3 py-2 font-medium ${
                direction === option
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {option === "left" ? "왼쪽" : "오른쪽"}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
