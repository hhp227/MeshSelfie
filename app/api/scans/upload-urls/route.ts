import { randomUUID } from "crypto";

import { getAuthenticatedUser } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { SCAN_MAX_PHOTOS, SCAN_MIN_PHOTOS } from "@/lib/uploads";

// Vercel 요청 바디 한도(4.5MB) 때문에 다중 사진은 multipart로 받을 수 없다.
// 서명 업로드 URL을 발급해 브라우저가 Storage에 직접 올리고,
// /api/scans/upload-complete가 세션 row를 확정한다.
const PHOTO_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
]);

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request);

  if ("error" in auth) {
    return auth.error;
  }

  const { supabase, user } = auth;
  const body = (await request.json().catch(() => null)) as {
    contentTypes?: unknown;
  } | null;

  if (!body || !Array.isArray(body.contentTypes)) {
    return jsonError("SCAN_CONTENT_TYPES_REQUIRED", "업로드할 사진 형식 목록이 필요합니다.", 400);
  }

  const contentTypes = body.contentTypes;

  if (contentTypes.length < SCAN_MIN_PHOTOS || contentTypes.length > SCAN_MAX_PHOTOS) {
    return jsonError(
      "INVALID_PHOTO_COUNT",
      `사진은 ${SCAN_MIN_PHOTOS}~${SCAN_MAX_PHOTOS}장이어야 합니다 (현재 ${contentTypes.length}장, 권장 40장).`,
      400,
    );
  }

  const extensions: string[] = [];

  for (const contentType of contentTypes) {
    const extension = typeof contentType === "string" ? PHOTO_EXTENSIONS.get(contentType) : null;

    if (!extension) {
      return jsonError("UNSUPPORTED_FILE_TYPE", "JPG 또는 PNG 사진만 지원합니다.", 415);
    }

    extensions.push(extension);
  }

  const scanSessionId = randomUUID();
  const basePath = `scans/${user.id}/${scanSessionId}/frames`;

  const results = await Promise.all(
    extensions.map((extension, index) => {
      const objectPath = `${basePath}/photo_${String(index + 1).padStart(4, "0")}.${extension}`;
      return supabase.storage.from("avatars").createSignedUploadUrl(objectPath);
    }),
  );

  const uploads: Array<{ path: string; token: string }> = [];

  for (const { data, error } of results) {
    if (error || !data?.token) {
      return jsonError("SCAN_UPLOAD_URL_FAILED", "업로드 URL 생성에 실패했습니다.", 500);
    }

    uploads.push({ path: data.path, token: data.token });
  }

  return Response.json({
    data: { scanSessionId, bucket: "avatars", uploads },
  });
}
