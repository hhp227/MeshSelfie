import type { SupabaseClient } from "@supabase/supabase-js";

import { getAIProviderForJob } from "@/lib/ai/registry";
import { jsonError } from "@/lib/api";
import { getAuthenticatedUser } from "@/lib/auth";
import {
  finalizeGeneration,
  GenerationFinalizationError,
} from "@/lib/generation/finalize";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export const maxDuration = 120;

type GenerationJobRow = {
  id: string;
  user_id: string;
  human_mesh_id: string;
  provider: string;
  model_name: string;
  provider_prediction_id: string | null;
  output_payload: {
    modelUrl?: string;
    providerModelUrl?: string;
  } | null;
  status: string;
  progress: number | null;
  quality_grade: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
};

export async function GET(request: Request, context: RouteContext) {
  const auth = await getAuthenticatedUser(request);

  if ("error" in auth) {
    return auth.error;
  }

  const { supabase, user } = auth;
  const { jobId } = await context.params;

  const { data, error } = await supabase
    .from("generation_jobs")
    .select(
      [
        "id",
        "user_id",
        "human_mesh_id",
        "provider",
        "model_name",
        "provider_prediction_id",
        "output_payload",
        "status",
        "progress",
        "quality_grade",
        "error_code",
        "error_message",
        "created_at",
        "started_at",
        "completed_at",
        "failed_at",
      ].join(","),
    )
    .eq("id", jobId)
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
    return jsonError("GENERATION_JOB_NOT_FOUND", "Generation job was not found.", 404);
  }

  const job = data as unknown as GenerationJobRow;

  if (job.provider_prediction_id && isProviderActive(job.status)) {
    const provider = getAIProviderForJob(job.model_name);

    if (!provider) {
      return jsonError(
        "AI_PROVIDER_NOT_CONFIGURED",
        `Provider for ${job.model_name} is not configured.`,
        500,
      );
    }

    try {
      const providerJob = await provider.getJob(job.provider_prediction_id);
      if (providerJob.status === "completed") {
        if (!providerJob.outputUrl) {
          await markGenerationTerminated({
            supabase,
            job,
            status: "failed",
            errorCode: "PROVIDER_OUTPUT_MISSING",
            errorMessage: "AI Provider가 GLB 결과 URL을 반환하지 않았습니다.",
            internalError: "Provider prediction succeeded without a model URL.",
          });
        } else {
          job.status = "postprocessing";
          job.progress = 90;
          job.output_payload = { modelUrl: providerJob.outputUrl };

          const [{ error: jobUpdateError }, { error: meshUpdateError }] = await Promise.all([
            supabase
              .from("generation_jobs")
              .update({
                status: "postprocessing",
                progress: 90,
                output_payload: job.output_payload,
              })
              .eq("id", job.id)
              .neq("status", "canceled"),
            supabase
              .from("human_meshes")
              .update({ status: "postprocessing" })
              .eq("id", job.human_mesh_id)
              .is("soft_deleted_at", null),
          ]);

          if (jobUpdateError || meshUpdateError) {
            return jsonError(
              "POSTPROCESSING_STATE_UPDATE_FAILED",
              jobUpdateError?.message ?? meshUpdateError?.message ?? "State update failed.",
              500,
            );
          }
        }
      } else if (providerJob.status === "failed" || providerJob.status === "canceled") {
        await markGenerationTerminated({
          supabase,
          job,
          status: providerJob.status,
          errorCode: providerJob.errorCode ?? null,
          errorMessage: providerJob.errorMessage ?? "AI 생성 작업이 종료되었습니다.",
          internalError: providerJob.errorMessage ?? null,
        });
      } else {
        job.status = providerJob.status;
        job.progress = providerJob.status === "generating" ? 25 : 5;
        await Promise.all([
          supabase
            .from("generation_jobs")
            .update({ status: job.status, progress: job.progress })
            .eq("id", job.id)
            .neq("status", "canceled"),
          supabase
            .from("human_meshes")
            .update({ status: job.status })
            .eq("id", job.human_mesh_id)
            .is("soft_deleted_at", null),
        ]);
      }
    } catch (providerError) {
      return jsonError(
        "AI_PROVIDER_STATUS_FAILED",
        providerError instanceof Error
          ? providerError.message
          : "AI Provider 상태 조회에 실패했습니다.",
        502,
      );
    }
  }

  if (job.status === "postprocessing") {
    const outputUrl = job.output_payload?.modelUrl ?? job.output_payload?.providerModelUrl;

    if (!outputUrl) {
      await markGenerationTerminated({
        supabase,
        job,
        status: "failed",
        errorCode: "PROVIDER_OUTPUT_MISSING",
        errorMessage: "AI Provider GLB 결과 URL이 없습니다.",
        internalError: "Postprocessing job has no provider model URL.",
      });
    } else {
      try {
        const result = await finalizeGeneration({
          supabase,
          userId: job.user_id,
          jobId: job.id,
          meshId: job.human_mesh_id,
          outputUrl,
        });

        job.status = "completed";
        job.progress = 100;
        job.error_code = null;
        job.error_message = null;
        job.completed_at = result.completedAt;
        job.failed_at = null;
      } catch (error) {
        if (
          error instanceof GenerationFinalizationError &&
          (error.code === "MODEL_DATABASE_UPDATE_FAILED" ||
            error.code === "JOB_DATABASE_UPDATE_FAILED")
        ) {
          return jsonError(error.code, error.publicMessage, 500);
        }

        const finalizationError =
          error instanceof GenerationFinalizationError
            ? error
            : new GenerationFinalizationError(
                "MODEL_FINALIZATION_FAILED",
                "3D 모델 완료 처리에 실패했습니다.",
                error instanceof Error ? error.message : "Unknown finalization error.",
              );

        await markGenerationTerminated({
          supabase,
          job,
          status: "failed",
          errorCode: finalizationError.code,
          errorMessage: finalizationError.publicMessage,
          internalError: finalizationError.message,
        });
      }
    }
  }

  return Response.json({
    data: {
      id: job.id,
      humanMeshId: job.human_mesh_id,
      provider: job.provider,
      modelName: job.model_name,
      status: job.status,
      progress: job.progress,
      qualityGrade: job.quality_grade,
      errorCode: job.error_code,
      errorMessage: job.error_message,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      failedAt: job.failed_at,
    },
  });
}

function isProviderActive(status: string) {
  return status === "queued" || status === "generating";
}

async function markGenerationTerminated({
  supabase,
  job,
  status,
  errorCode,
  errorMessage,
  internalError,
}: {
  supabase: SupabaseClient;
  job: GenerationJobRow;
  status: "failed" | "canceled";
  errorCode: string | null;
  errorMessage: string;
  internalError: string | null;
}) {
  const failedAt = status === "failed" ? new Date().toISOString() : null;

  job.status = status;
  job.progress = 100;
  job.error_code = errorCode;
  job.error_message = errorMessage;
  job.failed_at = failedAt;

  await Promise.all([
    supabase
      .from("generation_jobs")
      .update({
        status,
        progress: 100,
        error_code: errorCode,
        error_message: errorMessage,
        internal_error: internalError,
        failed_at: failedAt,
      })
      .eq("id", job.id)
      .neq("status", "canceled")
      .neq("status", "completed"),
    supabase
      .from("human_meshes")
      .update({ status, failed_at: failedAt })
      .eq("id", job.human_mesh_id)
      .is("soft_deleted_at", null)
      .neq("status", "completed"),
  ]);
}
