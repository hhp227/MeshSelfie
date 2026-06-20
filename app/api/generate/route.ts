import type { SupabaseClient } from "@supabase/supabase-js";

import { getDefaultAIProvider } from "@/lib/ai/registry";
import { ReplicateProviderError } from "@/lib/ai/providers/replicate";
import { jsonError } from "@/lib/api";
import { getAuthenticatedUser } from "@/lib/auth";
import { getOrCreateProfile } from "@/lib/profiles";
import { calculateQualityGrade, type ImageDirection } from "@/lib/uploads";

type SourceImageRow = {
  id: string;
  user_id: string;
  object_path: string;
  image_role: "front" | "side" | "angle45";
  image_direction: ImageDirection | null;
  status: string;
  soft_deleted_at: string | null;
};

type GenerateRequest = {
  frontSourceImageId?: string;
  sideSourceImageId?: string;
  angle45SourceImageId?: string;
};

const PROVIDER_IMAGE_URL_TTL_SECONDS = 600;

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request);

  if ("error" in auth) {
    return auth.error;
  }

  const { supabase, user } = auth;
  const body = (await request.json()) as GenerateRequest;

  if (!body.frontSourceImageId) {
    return jsonError("FRONT_SOURCE_IMAGE_REQUIRED", "정면 이미지 ID가 필요합니다.", 400);
  }

  const requestedIds = [
    body.frontSourceImageId,
    body.sideSourceImageId,
    body.angle45SourceImageId,
  ].filter((id): id is string => Boolean(id));

  if (new Set(requestedIds).size !== requestedIds.length) {
    return jsonError("DUPLICATE_SOURCE_IMAGE", "동일한 이미지를 중복 사용할 수 없습니다.", 400);
  }

  const { profile, error: profileError } = await getOrCreateProfile(supabase, user);

  if (profileError || !profile) {
    return jsonError(
      "PROFILE_SYNC_FAILED",
      profileError?.message ?? "Profile sync failed.",
      500,
    );
  }

  if (profile.remaining_credits <= 0) {
    return jsonError("INSUFFICIENT_CREDITS", "남은 생성 크레딧이 없습니다.", 402);
  }

  const { data, error } = await supabase
    .from("source_images")
    .select("id,user_id,object_path,image_role,image_direction,status,soft_deleted_at")
    .eq("user_id", user.id)
    .in("id", requestedIds);

  if (error) {
    return jsonError("SOURCE_IMAGE_LOOKUP_FAILED", error.message, 500);
  }

  const sourceImages = data as unknown as SourceImageRow[];

  if (sourceImages.length !== requestedIds.length) {
    return jsonError("SOURCE_IMAGE_NOT_FOUND", "선택한 이미지 일부를 찾을 수 없습니다.", 404);
  }

  const front = sourceImages.find((image) => image.id === body.frontSourceImageId);
  const side = body.sideSourceImageId
    ? sourceImages.find((image) => image.id === body.sideSourceImageId)
    : null;
  const angle45 = body.angle45SourceImageId
    ? sourceImages.find((image) => image.id === body.angle45SourceImageId)
    : null;

  if (!front || front.image_role !== "front") {
    return jsonError("INVALID_FRONT_IMAGE", "front 역할의 이미지를 선택해주세요.", 400);
  }

  if (side && (side.image_role !== "side" || !side.image_direction)) {
    return jsonError("INVALID_SIDE_IMAGE", "side 역할과 방향이 있는 이미지를 선택해주세요.", 400);
  }

  if (angle45 && (angle45.image_role !== "angle45" || !angle45.image_direction)) {
    return jsonError("INVALID_ANGLE45_IMAGE", "angle45 역할과 방향이 있는 이미지를 선택해주세요.", 400);
  }

  const inputImageCount = sourceImages.length;
  const qualityGrade = calculateQualityGrade(inputImageCount);
  const provider = getDefaultAIProvider();

  const { data: mesh, error: meshError } = await supabase
    .from("human_meshes")
    .insert({
      user_id: user.id,
      front_source_image_id: front.id,
      side_source_image_id: side?.id ?? null,
      angle45_source_image_id: angle45?.id ?? null,
      front_image_url: front.object_path,
      side_image_url: side?.object_path ?? null,
      side_direction: side?.image_direction ?? null,
      angle45_image_url: angle45?.object_path ?? null,
      angle45_direction: angle45?.image_direction ?? null,
      title: "Photorealistic Human Mesh",
      status: "queued",
      input_image_count: inputImageCount,
      quality_grade: qualityGrade,
      model_source: "ai_generated",
    })
    .select("id")
    .single();

  if (meshError || !mesh) {
    return jsonError("MESH_CREATE_FAILED", meshError?.message ?? "Mesh create failed.", 500);
  }

  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .insert({
      user_id: user.id,
      human_mesh_id: mesh.id,
      front_source_image_id: front.id,
      side_source_image_id: side?.id ?? null,
      angle45_source_image_id: angle45?.id ?? null,
      provider: provider.key,
      model_name: provider.modelName,
      status: "queued",
      progress: 0,
      quality_grade: qualityGrade,
      used_credits: 1,
      input_payload: {
        frontImagePath: front.object_path,
        sideImagePath: side?.object_path ?? null,
        sideDirection: side?.image_direction ?? null,
        angle45ImagePath: angle45?.object_path ?? null,
        angle45Direction: angle45?.image_direction ?? null,
      },
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return jsonError("JOB_CREATE_FAILED", jobError?.message ?? "Job create failed.", 500);
  }

  await supabase
    .from("human_meshes")
    .update({ latest_job_id: job.id })
    .eq("id", mesh.id);

  const signedUrls = await Promise.all(
    [front, side, angle45].map(async (image) => {
      if (!image) {
        return null;
      }

      const { data: signedUrl, error: signedUrlError } = await supabase.storage
        .from("avatars")
        .createSignedUrl(image.object_path, PROVIDER_IMAGE_URL_TTL_SECONDS);

      if (signedUrlError || !signedUrl?.signedUrl) {
        throw new Error(signedUrlError?.message ?? `Could not sign ${image.image_role} image.`);
      }

      return signedUrl.signedUrl;
    }),
  ).catch(async (signedUrlError: unknown) => {
    await markGenerationFailed(
      supabase,
      mesh.id,
      job.id,
      "PROVIDER_INPUT_URL_FAILED",
      "AI Provider용 이미지 URL을 생성하지 못했습니다.",
      signedUrlError instanceof Error ? signedUrlError.message : "Provider input URL creation failed.",
    );
    return null;
  });

  if (!signedUrls) {
    return jsonError(
      "PROVIDER_INPUT_URL_FAILED",
      "AI Provider용 이미지 URL을 생성하지 못했습니다.",
      500,
    );
  }

  let providerJob;

  try {
    providerJob = await provider.createJob({
      jobId: job.id,
      userId: user.id,
      frontImageUrl: signedUrls[0]!,
      sideImageUrl: signedUrls[1] ?? undefined,
      sideDirection: side?.image_direction ?? undefined,
      angle45ImageUrl: signedUrls[2] ?? undefined,
      angle45Direction: angle45?.image_direction ?? undefined,
      qualityGrade,
      outputFormat: "glb",
    });
  } catch (providerError) {
    const failure = describeProviderFailure(providerError);
    await markGenerationFailed(
      supabase,
      mesh.id,
      job.id,
      failure.code,
      failure.publicMessage,
      failure.internalError,
    );
    return jsonError(failure.code, failure.publicMessage, failure.httpStatus);
  }

  await Promise.all([
    supabase
      .from("human_meshes")
      .update({
        latest_job_id: job.id,
        status: "generating",
      })
      .eq("id", mesh.id),
    supabase
      .from("generation_jobs")
      .update({
        provider_prediction_id: providerJob.providerJobId,
        status: "generating",
        progress: 5,
        output_payload: {
          predictionId: providerJob.providerJobId,
        },
        started_at: new Date().toISOString(),
      })
      .eq("id", job.id),
    supabase
      .from("profiles")
      .update({
        remaining_credits: profile.remaining_credits - 1,
        used_credits: profile.used_credits + 1,
      })
      .eq("id", user.id),
    supabase.from("credit_ledger").insert({
      user_id: user.id,
      generation_job_id: job.id,
      delta: -1,
      balance_after: profile.remaining_credits - 1,
      reason: "generation_used",
      metadata: {
        humanMeshId: mesh.id,
        qualityGrade,
        provider: provider.key,
      },
    }),
  ]);

  return Response.json({
    data: {
      humanMeshId: mesh.id,
      jobId: job.id,
      status: "generating",
      qualityGrade,
      provider: provider.key,
      providerJobId: providerJob.providerJobId,
    },
  });
}

async function markGenerationFailed(
  supabase: SupabaseClient,
  meshId: string,
  jobId: string,
  errorCode: string,
  errorMessage: string,
  internalError: string,
) {
  const failedAt = new Date().toISOString();
  await Promise.all([
    supabase
      .from("human_meshes")
      .update({ status: "failed", failed_at: failedAt })
      .eq("id", meshId),
    supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        error_code: errorCode,
        error_message: errorMessage,
        internal_error: internalError,
        failed_at: failedAt,
      })
      .eq("id", jobId),
  ]);
}

function describeProviderFailure(error: unknown) {
  if (error instanceof ReplicateProviderError) {
    if (error.status === 402) {
      return {
        code: "REPLICATE_BILLING_REQUIRED",
        publicMessage:
          "Replicate 크레딧 또는 결제 설정이 필요합니다. Replicate Billing을 확인해주세요.",
        internalError: `${error.message} ${safeDetails(error.details)}`.trim(),
        httpStatus: 503,
      };
    }

    if (error.status === 401 || error.status === 403) {
      return {
        code: "REPLICATE_AUTH_FAILED",
        publicMessage: "Replicate API 토큰이 유효하지 않거나 모델 접근 권한이 없습니다.",
        internalError: `${error.message} ${safeDetails(error.details)}`.trim(),
        httpStatus: 503,
      };
    }

    if (error.status === 429) {
      return {
        code: "REPLICATE_RATE_LIMITED",
        publicMessage: "Replicate 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.",
        internalError: `${error.message} ${safeDetails(error.details)}`.trim(),
        httpStatus: 503,
      };
    }
  }

  return {
    code: "AI_PROVIDER_FAILED",
    publicMessage: "AI 생성 작업을 시작하지 못했습니다.",
    internalError: error instanceof Error ? error.message : "AI Provider request failed.",
    httpStatus: 502,
  };
}

function safeDetails(details: unknown) {
  if (details === undefined) {
    return "";
  }

  try {
    return JSON.stringify(details).slice(0, 2000);
  } catch {
    return "Provider error details could not be serialized.";
  }
}
