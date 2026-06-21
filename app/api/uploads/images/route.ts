import { randomUUID } from "crypto";

import { getAuthenticatedUser } from "@/lib/auth";
import { jsonError } from "@/lib/api";
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
  validationWarnings: string[];
};

type UploadedSourceImage = {
  id: string;
  role: ImageRole;
  direction: ImageDirection | null;
  objectPath: string;
  contentType: string;
  fileSizeBytes: number;
};

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

    const validationWarnings: string[] = [];

    if (
      dimensions.width < RECOMMENDED_IMAGE_DIMENSION ||
      dimensions.height < RECOMMENDED_IMAGE_DIMENSION
    ) {
      validationWarnings.push(
        `고정밀 두상 복원에는 가로·세로 ${RECOMMENDED_IMAGE_DIMENSION}px 이상을 권장합니다.`,
      );
    }

    validationWarnings.push("얼굴 검출·가림·흐림 자동 검증은 후속 Vision 단계에서 추가됩니다.");
    validatedFiles.push({ ...entry, dimensions, validationWarnings });
  }

  const uploadGroupId = randomUUID();
  const uploaded: UploadedSourceImage[] = [];

  for (const entry of validatedFiles) {
    const sourceImageId = randomUUID();
    const extension = getImageExtension(entry.file.type);
    const objectPath = `images/${user.id}/uploads/${uploadGroupId}/${entry.role}.${extension}`;
    const checksum = await sha256Hex(entry.file);

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(objectPath, entry.file, {
        contentType: entry.file.type,
        upsert: false,
      });

    if (uploadError) {
      return jsonError("STORAGE_UPLOAD_FAILED", uploadError.message, 500);
    }

    const { error: insertError } = await supabase.from("source_images").insert({
      id: sourceImageId,
      user_id: user.id,
      bucket: "avatars",
      object_path: objectPath,
      image_role: entry.role,
      image_direction: entry.direction,
      original_filename: entry.file.name || `${entry.role}.${extension}`,
      content_type: entry.file.type,
      file_size_bytes: entry.file.size,
      width: entry.dimensions.width,
      height: entry.dimensions.height,
      checksum_sha256: checksum,
      validation_status: "pending",
      validation_warnings: entry.validationWarnings,
    });

    if (insertError) {
      return jsonError("SOURCE_IMAGE_INSERT_FAILED", insertError.message, 500);
    }

    uploaded.push({
      id: sourceImageId,
      role: entry.role,
      direction: entry.direction,
      objectPath,
      contentType: entry.file.type,
      fileSizeBytes: entry.file.size,
    });
  }

  return Response.json({
    data: {
      uploadGroupId,
      images: uploaded,
    },
  });
}
