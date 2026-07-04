import type { SupabaseClient } from "@supabase/supabase-js";

import { getHeadReconstructionEnv, getScanReconstructionEnv } from "@/lib/env";

const MODEL_BUCKET = "avatars";
const MAX_GLB_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

export class GenerationFinalizationError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
    message: string,
  ) {
    super(message);
    this.name = "GenerationFinalizationError";
  }
}

export async function finalizeGeneration({
  supabase,
  userId,
  jobId,
  meshId,
  outputUrl,
  thumbnailUrl,
}: {
  supabase: SupabaseClient;
  userId: string;
  jobId: string;
  meshId: string;
  outputUrl: string;
  thumbnailUrl?: string;
}) {
  assertTrustedOutputUrl(outputUrl);

  let response: Response;

  try {
    response = await fetch(outputUrl, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    throw new GenerationFinalizationError(
      "MODEL_DOWNLOAD_FAILED",
      "생성된 3D 모델을 내려받지 못했습니다.",
      error instanceof Error ? error.message : "Provider model download failed.",
    );
  }

  if (!response.ok) {
    throw new GenerationFinalizationError(
      "MODEL_DOWNLOAD_FAILED",
      "생성된 3D 모델을 내려받지 못했습니다.",
      `Provider model download returned ${response.status}.`,
    );
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);

  if (contentLength > MAX_GLB_BYTES) {
    throw new GenerationFinalizationError(
      "MODEL_FILE_TOO_LARGE",
      "생성된 3D 모델 파일이 허용 크기를 초과했습니다.",
      `GLB content-length ${contentLength} exceeds ${MAX_GLB_BYTES}.`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  validateGlb(bytes);

  const objectPath = `models/${userId}/${meshId}/mesh.glb`;
  const { error: uploadError } = await supabase.storage
    .from(MODEL_BUCKET)
    .upload(objectPath, bytes, {
      contentType: "model/gltf-binary",
      upsert: true,
    });

  if (uploadError) {
    throw new GenerationFinalizationError(
      "MODEL_STORAGE_UPLOAD_FAILED",
      "생성된 3D 모델을 저장하지 못했습니다.",
      uploadError.message,
    );
  }

  const completedAt = new Date().toISOString();
  const { data: updatedMesh, error: meshUpdateError } = await supabase
    .from("human_meshes")
    .update({
      status: "completed",
      model_bucket: MODEL_BUCKET,
      model_object_path: objectPath,
      model_content_type: "model/gltf-binary",
      model_file_size_bytes: bytes.byteLength,
      completed_at: completedAt,
      failed_at: null,
    })
    .eq("id", meshId)
    .eq("user_id", userId)
    .eq("latest_job_id", jobId)
    .is("soft_deleted_at", null)
    .select("id")
    .maybeSingle();

  if (meshUpdateError || !updatedMesh) {
    throw new GenerationFinalizationError(
      "MODEL_DATABASE_UPDATE_FAILED",
      "3D 모델 완료 정보를 저장하지 못했습니다.",
      meshUpdateError?.message ?? "The mesh is no longer linked to this generation job.",
    );
  }

  const { data: updatedJob, error: jobUpdateError } = await supabase
    .from("generation_jobs")
    .update({
      status: "completed",
      progress: 100,
      output_payload: {
        providerModelUrl: outputUrl,
        modelBucket: MODEL_BUCKET,
        modelObjectPath: objectPath,
        modelFileSizeBytes: bytes.byteLength,
      },
      error_code: null,
      error_message: null,
      internal_error: null,
      completed_at: completedAt,
      failed_at: null,
    })
    .eq("id", jobId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (jobUpdateError || !updatedJob) {
    throw new GenerationFinalizationError(
      "JOB_DATABASE_UPDATE_FAILED",
      "생성 작업 완료 정보를 저장하지 못했습니다.",
      jobUpdateError?.message ?? "Generation job no longer exists.",
    );
  }

  // 썸네일은 best-effort — 실패해도 생성 완료 처리는 유지한다
  if (thumbnailUrl) {
    try {
      await storeThumbnail({ supabase, userId, meshId, thumbnailUrl });
    } catch (thumbnailError) {
      console.warn("Thumbnail finalization failed", thumbnailError);
    }
  }

  await supabase.from("usage_events").insert({
    user_id: userId,
    event_type: "generation_completed",
    entity_type: "generation_job",
    entity_id: jobId,
    metadata: {
      humanMeshId: meshId,
      modelObjectPath: objectPath,
      modelFileSizeBytes: bytes.byteLength,
    },
  });

  return {
    objectPath,
    fileSizeBytes: bytes.byteLength,
    completedAt,
  };
}

const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

async function storeThumbnail({
  supabase,
  userId,
  meshId,
  thumbnailUrl,
}: {
  supabase: SupabaseClient;
  userId: string;
  meshId: string;
  thumbnailUrl: string;
}) {
  assertTrustedOutputUrl(thumbnailUrl);

  const response = await fetch(thumbnailUrl, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Thumbnail download returned ${response.status}.`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  // JPEG magic(0xFFD8) + 크기 상한 검증
  if (bytes.byteLength < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Thumbnail is not a valid JPEG.");
  }

  if (bytes.byteLength > MAX_THUMBNAIL_BYTES) {
    throw new Error(`Thumbnail size ${bytes.byteLength} exceeds ${MAX_THUMBNAIL_BYTES}.`);
  }

  const thumbnailPath = `thumbnails/${userId}/${meshId}/thumbnail.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(MODEL_BUCKET)
    .upload(thumbnailPath, bytes, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  await supabase
    .from("human_meshes")
    .update({
      thumbnail_bucket: MODEL_BUCKET,
      thumbnail_object_path: thumbnailPath,
      thumbnail_generated_at: new Date().toISOString(),
    })
    .eq("id", meshId)
    .eq("user_id", userId)
    .is("soft_deleted_at", null);
}

function assertTrustedOutputUrl(outputUrl: string) {
  let url: URL;

  try {
    url = new URL(outputUrl);
  } catch {
    throw new GenerationFinalizationError(
      "INVALID_PROVIDER_OUTPUT_URL",
      "AI Provider가 잘못된 결과 URL을 반환했습니다.",
      "Provider output URL is invalid.",
    );
  }

  const hostname = url.hostname.toLowerCase();
  const { apiUrl, outputHosts } = getHeadReconstructionEnv();
  const workerApiHost = getHostname(apiUrl);
  const scanWorkerHost = getHostname(getScanReconstructionEnv().apiUrl);
  const trustedWorkerHosts = new Set([
    ...outputHosts,
    ...(workerApiHost ? [workerApiHost] : []),
    ...(scanWorkerHost ? [scanWorkerHost] : []),
  ]);
  const secureProtocol =
    url.protocol === "https:" ||
    (url.protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1"));
  const trustedHost =
    secureProtocol &&
    (hostname === "replicate.delivery" ||
      hostname.endsWith(".replicate.delivery") ||
      trustedWorkerHosts.has(hostname));

  if (!trustedHost) {
    throw new GenerationFinalizationError(
      "UNTRUSTED_PROVIDER_OUTPUT_URL",
      "AI Provider 결과 URL을 신뢰할 수 없습니다.",
      `Provider output host is not allowed: ${url.hostname}`,
    );
  }
}

function getHostname(value: string) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function validateGlb(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_GLB_BYTES) {
    throw new GenerationFinalizationError(
      "MODEL_FILE_TOO_LARGE",
      "생성된 3D 모델 파일이 허용 크기를 초과했습니다.",
      `Downloaded GLB size ${bytes.byteLength} exceeds ${MAX_GLB_BYTES}.`,
    );
  }

  if (bytes.byteLength < 12) {
    throwInvalidGlb("GLB header is missing.");
  }

  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = header.getUint32(0, true);
  const version = header.getUint32(4, true);
  const declaredLength = header.getUint32(8, true);

  if (magic !== 0x46546c67 || version !== 2 || declaredLength !== bytes.byteLength) {
    throwInvalidGlb("GLB header magic, version, or declared length is invalid.");
  }
}

function throwInvalidGlb(message: string): never {
  throw new GenerationFinalizationError(
    "INVALID_GLB_OUTPUT",
    "AI Provider 결과가 올바른 GLB 파일이 아닙니다.",
    message,
  );
}
