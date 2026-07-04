import { randomUUID } from "crypto";

import { getAuthenticatedUser } from "@/lib/auth";
import { jsonError } from "@/lib/api";

const MAX_VIDEO_BYTES = 45 * 1024 * 1024; // Supabase 무료 티어 파일당 50MB 제한 고려
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MIN_PHOTOS = 15;
const MAX_PHOTOS = 80;
const VIDEO_TYPES = new Map([
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
]);
const PHOTO_TYPES = new Set(["image/jpeg", "image/png"]);

/** PRD v2.0 §4: 사진 수 기반 품질 등급 */
function scanQualityGrade(frameCount: number): "B" | "A" | "S" | "S+" {
  if (frameCount >= 80) return "S+";
  if (frameCount >= 40) return "S";
  if (frameCount >= 20) return "A";
  return "B";
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request);

  if ("error" in auth) {
    return auth.error;
  }

  const { supabase, user } = auth;
  const formData = await request.formData();
  const video = formData.get("video");
  const photos = formData.getAll("photos").filter((p): p is File => p instanceof File);

  if (!(video instanceof File) && photos.length === 0) {
    return jsonError(
      "SCAN_INPUT_REQUIRED",
      "스캔 동영상 또는 사진(15~80장)을 업로드해주세요.",
      400,
    );
  }

  const scanSessionId = randomUUID();
  const basePath = `scans/${user.id}/${scanSessionId}`;

  if (video instanceof File) {
    const extension = VIDEO_TYPES.get(video.type);

    if (!extension) {
      return jsonError("UNSUPPORTED_FILE_TYPE", "MP4 또는 MOV 동영상만 지원합니다.", 415);
    }

    if (video.size <= 0 || video.size > MAX_VIDEO_BYTES) {
      return jsonError(
        "FILE_TOO_LARGE",
        `동영상은 ${Math.floor(MAX_VIDEO_BYTES / 1024 / 1024)}MB 이하여야 합니다. 10~20초 분량을 권장합니다.`,
        413,
      );
    }

    const objectPath = `${basePath}/video.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(objectPath, video, { contentType: video.type, upsert: false });

    if (uploadError) {
      return jsonError("STORAGE_UPLOAD_FAILED", uploadError.message, 500);
    }

    const { error: insertError } = await supabase.from("scan_sessions").insert({
      id: scanSessionId,
      user_id: user.id,
      bucket: "avatars",
      input_kind: "video",
      video_object_path: objectPath,
    });

    if (insertError) {
      return jsonError("SCAN_SESSION_INSERT_FAILED", insertError.message, 500);
    }

    return Response.json({
      data: { scanSessionId, inputKind: "video", qualityGrade: null },
    });
  }

  // 다중 사진 입력
  if (photos.length < MIN_PHOTOS || photos.length > MAX_PHOTOS) {
    return jsonError(
      "INVALID_PHOTO_COUNT",
      `사진은 ${MIN_PHOTOS}~${MAX_PHOTOS}장이어야 합니다 (현재 ${photos.length}장, 권장 40장).`,
      400,
    );
  }

  const framePaths: string[] = [];

  for (const [index, photo] of photos.entries()) {
    if (!PHOTO_TYPES.has(photo.type)) {
      return jsonError("UNSUPPORTED_FILE_TYPE", "JPG 또는 PNG 사진만 지원합니다.", 415);
    }

    if (photo.size <= 0 || photo.size > MAX_PHOTO_BYTES) {
      return jsonError("FILE_TOO_LARGE", "사진 1장당 15MB 이하여야 합니다.", 413);
    }

    const extension = photo.type === "image/png" ? "png" : "jpg";
    const objectPath = `${basePath}/frames/photo_${String(index + 1).padStart(4, "0")}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(objectPath, photo, { contentType: photo.type, upsert: false });

    if (uploadError) {
      return jsonError("STORAGE_UPLOAD_FAILED", uploadError.message, 500);
    }

    framePaths.push(objectPath);
  }

  const qualityGrade = scanQualityGrade(framePaths.length);
  const { error: insertError } = await supabase.from("scan_sessions").insert({
    id: scanSessionId,
    user_id: user.id,
    bucket: "avatars",
    input_kind: "photos",
    frame_object_paths: framePaths,
    frame_count: framePaths.length,
    quality_grade: qualityGrade,
  });

  if (insertError) {
    return jsonError("SCAN_SESSION_INSERT_FAILED", insertError.message, 500);
  }

  return Response.json({
    data: {
      scanSessionId,
      inputKind: "photos",
      frameCount: framePaths.length,
      qualityGrade,
    },
  });
}
