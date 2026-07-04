import { randomUUID } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthenticatedUser } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import {
  judgeImageQuality,
  requestImageValidation,
  type ImageValidationMetrics,
} from "@/lib/generation/image-validation";
import {
  getImageExtension,
  parseDirection,
  readImageDimensions,
  RECOMMENDED_IMAGE_DIMENSION,
  sha256Hex,
  validateImageDimensions,
  validateImageFile,
  type ImageDimensions,
  type ImageDirection,
  type ImageRole,
} from "@/lib/uploads";

type UploadEntry = {
  role: ImageRole;
  file: File;
  direction: ImageDirection | null;
  label: string;
};

type ValidatedUploadEntry = UploadEntry & {
  dimensions: ImageDimensions;
  baseWarnings: string[];
};

type UploadedEntry = ValidatedUploadEntry & {
  sourceImageId: string;
  objectPath: string;
};

const VALIDATION_URL_TTL_SECONDS = 600;

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request);

  if ("error" in auth) {
    return auth.error;
  }

  const { supabase, user } = auth;
  const formData = await request.formData();
  const front = formData.get("frontImage");
  const side = formData.get("sideImage");
  const angle45 = formData.get("angle45Image");
  const sideDirection = parseDirection(formData.get("sideDirection"));
  const angle45Direction = parseDirection(formData.get("angle45Direction"));

  if (!(front instanceof File)) {
    return jsonError("FRONT_IMAGE_REQUIRED", "정면 사진을 업로드해주세요.", 400);
  }

  if (side && !(side instanceof File)) {
    return jsonError("INVALID_SIDE_IMAGE", "측면 사진 형식이 올바르지 않습니다.", 400);
  }

  if (angle45 && !(angle45 instanceof File)) {
    return jsonError("INVALID_ANGLE45_IMAGE", "45도 사진 형식이 올바르지 않습니다.", 400);
  }

  if (side instanceof File && !sideDirection) {
    return jsonError("SIDE_DIRECTION_REQUIRED", "측면 사진 방향을 선택해주세요.", 400);
  }

  if (angle45 instanceof File && !angle45Direction) {
    return jsonError("ANGLE45_DIRECTION_REQUIRED", "45도 사진 방향을 선택해주세요.", 400);
  }

  const files: UploadEntry[] = [
    { role: "front", file: front, direction: null, label: "정면 사진" },
  ];

  if (side instanceof File) {
    files.push({ role: "side", file: side, direction: sideDirection, label: "측면 사진" });
  }

  if (angle45 instanceof File) {
    files.push({
      role: "angle45",
      file: angle45,
      direction: angle45Direction,
      label: "45도 사진",
    });
  }

  const validatedFiles: ValidatedUploadEntry[] = [];

  for (const entry of files) {
    const validationError = validateImageFile(entry.file, entry.label);

    if (validationError) {
      return jsonError("IMAGE_VALIDATION_FAILED", validationError, 400);
    }

    const dimensions = await readImageDimensions(entry.file);

    if (!dimensions) {
      return jsonError(
        "IMAGE_DECODE_FAILED",
        `${entry.label}의 이미지 정보를 읽을 수 없습니다. 올바른 JPG 또는 PNG 파일을 선택해주세요.`,
        400,
      );
    }

    const dimensionError = validateImageDimensions(dimensions, entry.label);

    if (dimensionError) {
      return jsonError("IMAGE_RESOLUTION_TOO_LOW", dimensionError, 400);
    }

    const baseWarnings: string[] = [];

    if (
      dimensions.width < RECOMMENDED_IMAGE_DIMENSION ||
      dimensions.height < RECOMMENDED_IMAGE_DIMENSION
    ) {
      baseWarnings.push(
        `고정밀 두상 복원에는 가로·세로 ${RECOMMENDED_IMAGE_DIMENSION}px 이상을 권장합니다.`,
      );
    }

    validatedFiles.push({ ...entry, dimensions, baseWarnings });
  }

  // 1) Storage 업로드
  const uploadGroupId = randomUUID();
  const uploaded: UploadedEntry[] = [];

  for (const entry of validatedFiles) {
    const sourceImageId = randomUUID();
    const extension = getImageExtension(entry.file.type);
    const objectPath = `images/${user.id}/uploads/${uploadGroupId}/${entry.role}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(objectPath, entry.file, {
        contentType: entry.file.type,
        upsert: false,
      });

    if (uploadError) {
      return jsonError("STORAGE_UPLOAD_FAILED", uploadError.message, 500);
    }

    uploaded.push({ ...entry, sourceImageId, objectPath });
  }

  // 2) Vision 품질 검증 (worker 미설정·실패 시 null — 업로드는 계속 진행)
  const metricsByRole = await validateUploadedImages(supabase, uploaded);

  // 3) 역할별 판정. 하드 실패가 있으면 업로드 롤백 후 400
  const judgements = new Map<
    string,
    { status: "pending" | "passed" | "warning" | "failed"; warnings: string[]; metrics: ImageValidationMetrics | null }
  >();
  const hardErrors: string[] = [];

  for (const entry of uploaded) {
    const metrics = metricsByRole?.[entry.role] ?? null;

    if (!metrics) {
      judgements.set(entry.role, {
        status: "pending",
        warnings: [
          ...entry.baseWarnings,
          "얼굴·흐림 자동 검증을 수행하지 못해 결과 품질이 보장되지 않을 수 있습니다.",
        ],
        metrics: null,
      });
      continue;
    }

    const judgement = judgeImageQuality(entry.role, metrics);
    hardErrors.push(...judgement.errors.map((message) => `${entry.label}: ${message}`));
    judgements.set(entry.role, {
      status: judgement.status,
      warnings: [...entry.baseWarnings, ...judgement.warnings],
      metrics,
    });
  }

  if (hardErrors.length > 0) {
    await supabase.storage
      .from("avatars")
      .remove(uploaded.map((entry) => entry.objectPath));
    return jsonError("IMAGE_VALIDATION_FAILED", hardErrors[0], 400);
  }

  // 4) source_images 저장
  for (const entry of uploaded) {
    const judgement = judgements.get(entry.role)!;
    const checksum = await sha256Hex(entry.file);

    const { error: insertError } = await supabase.from("source_images").insert({
      id: entry.sourceImageId,
      user_id: user.id,
      bucket: "avatars",
      object_path: entry.objectPath,
      image_role: entry.role,
      image_direction: entry.direction,
      original_filename: entry.file.name || `${entry.role}.${getImageExtension(entry.file.type)}`,
      content_type: entry.file.type,
      file_size_bytes: entry.file.size,
      width: entry.dimensions.width,
      height: entry.dimensions.height,
      checksum_sha256: checksum,
      validation_status: judgement.status,
      validation_warnings: judgement.warnings,
      face_bbox: judgement.metrics?.faceBbox ?? null,
      blur_score: judgement.metrics?.blurScore ?? null,
    });

    if (insertError) {
      return jsonError("SOURCE_IMAGE_INSERT_FAILED", insertError.message, 500);
    }
  }

  return Response.json({
    data: {
      uploadGroupId,
      images: uploaded.map((entry) => ({
        id: entry.sourceImageId,
        role: entry.role,
        direction: entry.direction,
        objectPath: entry.objectPath,
        contentType: entry.file.type,
        fileSizeBytes: entry.file.size,
        validationStatus: judgements.get(entry.role)!.status,
        validationWarnings: judgements.get(entry.role)!.warnings,
      })),
    },
  });
}

async function validateUploadedImages(
  supabase: SupabaseClient,
  uploaded: UploadedEntry[],
): Promise<Record<string, ImageValidationMetrics> | null> {
  const targets: Array<{ role: ImageRole; url: string }> = [];

  for (const entry of uploaded) {
    const { data: signed, error } = await supabase.storage
      .from("avatars")
      .createSignedUrl(entry.objectPath, VALIDATION_URL_TTL_SECONDS);

    if (error || !signed?.signedUrl) {
      return null;
    }

    targets.push({ role: entry.role, url: signed.signedUrl });
  }

  return requestImageValidation(targets);
}
