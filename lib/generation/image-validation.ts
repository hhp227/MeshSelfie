import { getHeadReconstructionEnv, isHeadReconstructionConfigured } from "@/lib/env";
import type { ImageRole } from "@/lib/uploads";

export type ImageValidationMetrics = {
  faceCount?: number;
  faceBbox?: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
  faceHeightRatio?: number | null;
  blurScore?: number | null;
  error?: string;
};

export type ImageQualityJudgement = {
  status: "passed" | "warning" | "failed";
  errors: string[];
  warnings: string[];
};

const MIN_FACE_HEIGHT_RATIO = 0.15;
const BLUR_WARNING_THRESHOLD = 40;

/**
 * head-reconstruction worker의 /v1/validate로 이미지 품질 메트릭을 요청한다.
 * worker 미설정·호출 실패 시 null을 반환하고 업로드는 계속 진행한다(best-effort).
 */
export async function requestImageValidation(
  images: Array<{ role: ImageRole; url: string }>,
): Promise<Record<string, ImageValidationMetrics> | null> {
  if (!isHeadReconstructionConfigured()) {
    return null;
  }

  const { apiUrl, apiKey } = getHeadReconstructionEnv();

  try {
    const response = await fetch(`${apiUrl}/v1/validate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ images }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as {
      results?: Record<string, ImageValidationMetrics>;
    } | null;
    return body?.results ?? null;
  } catch {
    return null;
  }
}

/** 역할별 통과·경고·실패 정책. 메시지는 사용자에게 그대로 노출된다. */
export function judgeImageQuality(
  role: ImageRole,
  metrics: ImageValidationMetrics,
): ImageQualityJudgement {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (metrics.error) {
    warnings.push("이미지 품질 자동 검증을 수행하지 못했습니다.");
    return { status: "warning", errors, warnings };
  }

  const faceCount = metrics.faceCount ?? 0;

  if (faceCount > 1) {
    errors.push("한 명의 얼굴만 포함된 사진을 업로드해주세요.");
  }

  if (faceCount === 0) {
    if (role === "front") {
      errors.push(
        "얼굴이 인식되지 않았습니다. 얼굴이 잘 보이는 정면 사진을 업로드해주세요.",
      );
    } else {
      // 90° 측면은 얼굴 검출이 안 되는 경우가 많다 — 경고만 남긴다
      warnings.push(
        "이 사진에서는 얼굴이 인식되지 않았습니다. 각도가 심하면 품질에 영향을 줄 수 있습니다.",
      );
    }
  }

  if (
    role === "front" &&
    faceCount === 1 &&
    typeof metrics.faceHeightRatio === "number" &&
    metrics.faceHeightRatio < MIN_FACE_HEIGHT_RATIO
  ) {
    warnings.push("얼굴이 너무 작게 인식되었습니다. 얼굴이 화면을 채우는 사진을 권장합니다.");
  }

  if (
    typeof metrics.blurScore === "number" &&
    metrics.blurScore < BLUR_WARNING_THRESHOLD
  ) {
    warnings.push("사진이 흐릿합니다. 더 선명한 사진을 권장합니다.");
  }

  if (errors.length > 0) {
    return { status: "failed", errors, warnings };
  }

  return { status: warnings.length > 0 ? "warning" : "passed", errors, warnings };
}
