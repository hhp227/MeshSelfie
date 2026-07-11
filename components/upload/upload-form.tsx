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
type ScanInputKind = "video" | "photoset";

type ScanUploadResponse = {
  data: {
    scanSessionId: string;
    inputKind: string;
    qualityGrade: string | null;
  };
};

type ScanUploadUrlsResponse = {
  data: {
    scanSessionId: string;
    bucket: string;
    uploads: Array<{ path: string; token: string }>;
  };
};

const SCAN_PHOTO_MIN = 15;
const SCAN_PHOTO_MAX = 80;
const SCAN_PHOTO_LONG_EDGE = 1600; // 워커 COLMAP 해상도 상한 — 그 이상은 업로드 낭비
const SCAN_UPLOAD_CONCURRENCY = 4;

/** 긴 변 1600px JPEG로 다운스케일 (EXIF 회전 반영) — 업로드 용량·시간 절감 */
async function downscaleScanPhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }

  try {
    const scale = Math.min(1, SCAN_PHOTO_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("이미지 처리를 지원하지 않는 브라우저입니다.");
    }

    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );

    if (!blob) {
      throw new Error("이미지 변환에 실패했습니다.");
    }

    return blob;
  } finally {
    bitmap.close();
  }
}

async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number,
) {
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(items[index], index);
      }
    }),
  );
}

export function UploadForm() {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [mode, setMode] = useState<UploadMode>("photos");
  const [scanInputKind, setScanInputKind] = useState<ScanInputKind>("video");
  const [scanVideo, setScanVideo] = useState<File | null>(null);
  const [scanPhotos, setScanPhotos] = useState<File[]>([]);
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

  async function requestScanGenerate(token: string, scanSessionId: string) {
    setMessage("3D 재구성을 요청하는 중입니다. 5~15분 정도 걸립니다.");

    const generateResult = await fetch("/api/scans/generate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scanSessionId }),
    });

    if (!generateResult.ok) {
      const body = await generateResult.json();
      throw new Error(body.error?.message ?? "재구성 요청에 실패했습니다.");
    }

    const generateJson = (await generateResult.json()) as GenerateResponse;
    router.push(`/result/${generateJson.data.humanMeshId}`);
  }

  async function uploadScanVideo(token: string) {
    if (!scanVideo) {
      throw new Error("스캔 동영상을 선택해주세요.");
    }

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
    return uploadJson.data.scanSessionId;
  }

  async function uploadScanPhotos(token: string) {
    if (scanPhotos.length < SCAN_PHOTO_MIN || scanPhotos.length > SCAN_PHOTO_MAX) {
      throw new Error(
        `사진은 ${SCAN_PHOTO_MIN}~${SCAN_PHOTO_MAX}장이어야 합니다 (현재 ${scanPhotos.length}장, 권장 40장).`,
      );
    }

    if (!supabase) {
      throw new Error("Supabase 환경 변수가 설정되지 않았습니다.");
    }

    setMessage(`사진 ${scanPhotos.length}장을 변환하는 중입니다.`);

    const blobs: Blob[] = [];

    for (const photo of scanPhotos) {
      blobs.push(await downscaleScanPhoto(photo));
    }

    const urlsResult = await fetch("/api/scans/upload-urls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ contentTypes: blobs.map(() => "image/jpeg") }),
    });

    if (!urlsResult.ok) {
      const body = await urlsResult.json();
      throw new Error(body.error?.message ?? "업로드 URL 발급에 실패했습니다.");
    }

    const urlsJson = (await urlsResult.json()) as ScanUploadUrlsResponse;
    const { scanSessionId, bucket, uploads } = urlsJson.data;
    let uploaded = 0;

    await runWithConcurrency(
      uploads,
      async (upload, index) => {
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .uploadToSignedUrl(upload.path, upload.token, blobs[index], {
            contentType: "image/jpeg",
          });

        if (uploadError) {
          throw new Error(`사진 업로드에 실패했습니다 (${index + 1}번째). 다시 시도해주세요.`);
        }

        uploaded += 1;
        setMessage(`사진 업로드 중 (${uploaded}/${uploads.length})`);
      },
      SCAN_UPLOAD_CONCURRENCY,
    );

    const completeResult = await fetch("/api/scans/upload-complete", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scanSessionId }),
    });

    if (!completeResult.ok) {
      const body = await completeResult.json();
      throw new Error(body.error?.message ?? "업로드 확정에 실패했습니다.");
    }

    return scanSessionId;
  }

  async function handleScanSubmit() {
    if (scanInputKind === "video" && !scanVideo) {
      setError("스캔 동영상을 선택해주세요.");
      return;
    }

    if (scanInputKind === "photoset" && scanPhotos.length === 0) {
      setError("스캔 사진을 선택해주세요.");
      return;
    }

    setPending(true);

    try {
      const token = await getAccessToken();
      const scanSessionId =
        scanInputKind === "video" ? await uploadScanVideo(token) : await uploadScanPhotos(token);

      await requestScanGenerate(token, scanSessionId);
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
      <div className="grid grid-cols-2 rounded-md border border-hairline bg-clay-50 p-1 text-sm font-semibold">
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
              mode === value ? "bg-celadon-600 text-clay-50" : "text-ink-dim hover:bg-clay-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "scan" ? (
        <>
          <div className="grid grid-cols-2 rounded-md border border-hairline bg-clay-50 p-1 text-sm font-medium">
            {(
              [
                ["photoset", "사진 여러 장 (권장)"],
                ["video", "동영상"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScanInputKind(value)}
                className={`rounded-md px-3 py-2 ${
                  scanInputKind === value
                    ? "bg-celadon-600 text-clay-50"
                    : "text-ink-dim hover:bg-clay-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="rounded-md border border-celadon-400/40 bg-celadon-100 p-4 text-sm text-ink">
            <p className="font-semibold">스캔 촬영 기준 (품질의 90%는 촬영이 결정합니다)</p>
            {scanInputKind === "photoset" ? (
              <ul className="mt-1 list-disc pl-5 leading-6 text-celadon-700">
                <li>15~80장 (40장 이상이면 S 등급) · JPG/PNG</li>
                <li>피사체 주위를 돌며 한 걸음마다 멈춰서 한 장씩 — 흔들림 없는 사진이 핵심</li>
                <li>표면에 무늬·질감이 있는 피사체, 균일한 밝은 조명, 모든 각도에서 겹치게</li>
              </ul>
            ) : (
              <ul className="mt-1 list-disc pl-5 leading-6 text-celadon-700">
                <li>10~20초, 45MB 이하 MP4/MOV</li>
                <li>피사체는 완전 정지(표정·시선 고정), 카메라가 얼굴 주위로 천천히 반원 이동</li>
                <li>균일한 밝은 조명, 흔들림(블러) 없이, 얼굴이 화면의 절반 이상</li>
              </ul>
            )}
          </div>

          {scanInputKind === "photoset" ? (
            <div className="rounded-md border border-hairline bg-clay-50 p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-ink">스캔 사진 (15~80장)</h2>
                <span className="rounded-md bg-clay-200 px-2 py-1 text-xs text-ink-dim">필수</span>
              </div>
              <label className="mt-4 flex aspect-[3/1] cursor-pointer items-center justify-center rounded-md border border-dashed border-hairline-strong bg-clay-100/60 px-4 text-center text-sm text-ink-dim hover:bg-clay-100">
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  multiple
                  className="sr-only"
                  onChange={(event) => setScanPhotos(Array.from(event.target.files ?? []))}
                />
                {scanPhotos.length > 0
                  ? `${scanPhotos.length}장 선택됨 (${(
                      scanPhotos.reduce((total, photo) => total + photo.size, 0) /
                      1024 /
                      1024
                    ).toFixed(1)}MB — 업로드 시 자동 축소)`
                  : "JPG/PNG 여러 장 선택 (권장 40장)"}
              </label>
            </div>
          ) : (
            <div className="rounded-md border border-hairline bg-clay-50 p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-ink">스캔 동영상</h2>
                <span className="rounded-md bg-clay-200 px-2 py-1 text-xs text-ink-dim">필수</span>
              </div>
              <label className="mt-4 flex aspect-[3/1] cursor-pointer items-center justify-center rounded-md border border-dashed border-hairline-strong bg-clay-100/60 px-4 text-center text-sm text-ink-dim hover:bg-clay-100">
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
          )}
        </>
      ) : (
        <div className="rounded-md border border-axis-z/30 bg-axis-z/10 p-4 text-sm text-ink">
          <p className="font-semibold">고정밀 얼굴·목 복원 촬영 기준</p>
          <p className="mt-1 leading-6 text-ink-dim">
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
        <p className="rounded-md border border-hairline bg-clay-50 px-4 py-3 text-sm text-ink-dim">
          {message}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md border border-kiln-600/30 bg-kiln-100 px-4 py-3 text-sm text-kiln-700">
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-md bg-celadon-600 px-5 text-sm font-semibold text-clay-50 hover:bg-celadon-700 disabled:cursor-not-allowed disabled:bg-clay-400"
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
    <div className="rounded-md border border-hairline bg-clay-50 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink">{title}</h2>
        <span className="rounded-md bg-clay-200 px-2 py-1 text-xs text-ink-dim">
          {requiredLabel}
        </span>
      </div>
      <p className="mt-2 min-h-10 text-sm leading-5 text-ink-dim">{description}</p>
      <label className="mt-4 flex aspect-[4/3] cursor-pointer items-center justify-center rounded-md border border-dashed border-hairline-strong bg-clay-100/60 px-4 text-center text-sm text-ink-dim hover:bg-clay-100">
        <input
          type="file"
          accept="image/jpeg,image/png"
          className="sr-only"
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        />
        {file ? file.name : "JPG/PNG 선택"}
      </label>

      {direction && onDirectionChange ? (
        <div className="mt-4 grid grid-cols-2 rounded-md border border-hairline p-1 text-sm">
          {(["left", "right"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onDirectionChange(option)}
              className={`rounded px-3 py-2 font-medium ${
                direction === option
                  ? "bg-celadon-600 text-clay-50"
                  : "text-ink-dim hover:bg-clay-100"
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
