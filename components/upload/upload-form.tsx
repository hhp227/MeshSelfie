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

export function UploadForm() {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

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
      <div className="grid gap-4 md:grid-cols-3">
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
          {pending ? "처리 중..." : "업로드 후 생성 요청"}
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
