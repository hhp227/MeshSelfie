import { getAuthenticatedUser } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import {
  calculateScanQualityGrade,
  SCAN_MAX_PHOTOS,
  SCAN_MIN_PHOTOS,
} from "@/lib/uploads";

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FRAME_NAME_PATTERN = /^photo_\d{4}\.(jpg|png)$/;

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request);

  if ("error" in auth) {
    return auth.error;
  }

  const { supabase, user } = auth;
  const body = (await request.json().catch(() => null)) as {
    scanSessionId?: unknown;
  } | null;
  const scanSessionId = body?.scanSessionId;

  if (typeof scanSessionId !== "string" || !UUID_PATTERN.test(scanSessionId)) {
    return jsonError("SCAN_SESSION_REQUIRED", "스캔 세션 ID가 필요합니다.", 400);
  }

  // 경로 prefix에 user.id가 박혀 있으므로 남의 세션/경로는 조회 자체가 불가능하다.
  const basePath = `scans/${user.id}/${scanSessionId}/frames`;
  const { data: objects, error: listError } = await supabase.storage
    .from("avatars")
    .list(basePath, { limit: SCAN_MAX_PHOTOS + 20, sortBy: { column: "name", order: "asc" } });

  if (listError) {
    return jsonError("SCAN_UPLOAD_LIST_FAILED", "업로드된 사진을 확인하지 못했습니다.", 500);
  }

  const frames = (objects ?? []).filter((object) => FRAME_NAME_PATTERN.test(object.name));

  if (frames.length < SCAN_MIN_PHOTOS || frames.length > SCAN_MAX_PHOTOS) {
    return jsonError(
      "INVALID_PHOTO_COUNT",
      `사진은 ${SCAN_MIN_PHOTOS}~${SCAN_MAX_PHOTOS}장이어야 합니다 (현재 ${frames.length}장 업로드됨).`,
      400,
    );
  }

  for (const frame of frames) {
    const size = (frame.metadata as { size?: number } | null)?.size ?? 0;

    if (size <= 0 || size > MAX_PHOTO_BYTES) {
      return jsonError("FILE_TOO_LARGE", "사진 1장당 15MB 이하여야 합니다.", 413);
    }
  }

  const framePaths = frames.map((frame) => `${basePath}/${frame.name}`);
  const qualityGrade = calculateScanQualityGrade(framePaths.length);

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
    // PK 충돌 = 이미 확정된 세션 (중복 호출 방어)
    if (insertError.code === "23505") {
      return jsonError("SCAN_SESSION_ALREADY_USED", "이미 처리 중이거나 완료된 스캔입니다.", 409);
    }

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
