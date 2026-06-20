import { jsonError } from "@/lib/api";
import { getAIProviderForJob } from "@/lib/ai/registry";
import { getAuthenticatedUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{
    meshId: string;
  }>;
};

type HumanMeshRow = {
  id: string;
  title: string | null;
  status: string;
  input_image_count: number;
  quality_grade: string;
  model_source: string;
  model_bucket: string | null;
  model_object_path: string | null;
  thumbnail_bucket: string | null;
  thumbnail_object_path: string | null;
  thumbnail_url: string | null;
  latest_job_id: string | null;
  created_at: string;
  completed_at: string | null;
  failed_at: string | null;
};

type GenerationJobRow = {
  id: string;
  status: string;
  progress: number | null;
  provider: string;
  model_name: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
};

type DeletableMeshRow = {
  id: string;
  status: string;
  latest_job_id: string | null;
};

type DeletableJobRow = {
  id: string;
  status: string;
  model_name: string;
  provider_prediction_id: string | null;
};

export async function GET(request: Request, context: RouteContext) {
  const auth = await getAuthenticatedUser(request);

  if ("error" in auth) {
    return auth.error;
  }

  const { supabase, user } = auth;
  const { meshId } = await context.params;

  const { data, error } = await supabase
    .from("human_meshes")
    .select(
      [
        "id",
        "title",
        "status",
        "input_image_count",
        "quality_grade",
        "model_source",
        "model_bucket",
        "model_object_path",
        "thumbnail_bucket",
        "thumbnail_object_path",
        "thumbnail_url",
        "latest_job_id",
        "created_at",
        "completed_at",
        "failed_at",
      ].join(","),
    )
    .eq("id", meshId)
    .eq("user_id", user.id)
    .is("soft_deleted_at", null)
    .single();

  if (error || !data) {
    return jsonError("MESH_NOT_FOUND", "Human Mesh was not found.", 404);
  }

  const mesh = data as unknown as HumanMeshRow;
  let modelSignedUrl: string | null = null;
  let thumbnailSignedUrl: string | null = null;
  let latestJob: GenerationJobRow | null = null;

  if (mesh.model_object_path) {
    const { data: signed } = await supabase.storage
      .from(mesh.model_bucket ?? "avatars")
      .createSignedUrl(mesh.model_object_path, 60 * 5);

    modelSignedUrl = signed?.signedUrl ?? null;
  }

  if (mesh.thumbnail_object_path) {
    const { data: signed } = await supabase.storage
      .from(mesh.thumbnail_bucket ?? "avatars")
      .createSignedUrl(mesh.thumbnail_object_path, 60 * 5);

    thumbnailSignedUrl = signed?.signedUrl ?? null;
  }

  if (mesh.latest_job_id) {
    const { data: job } = await supabase
      .from("generation_jobs")
      .select(
        [
          "id",
          "status",
          "progress",
          "provider",
          "model_name",
          "error_code",
          "error_message",
          "created_at",
          "started_at",
          "completed_at",
          "failed_at",
        ].join(","),
      )
      .eq("id", mesh.latest_job_id)
      .eq("user_id", user.id)
      .maybeSingle();

    latestJob = job as unknown as GenerationJobRow | null;
  }

  return Response.json({
    data: {
      id: mesh.id,
      title: mesh.title,
      status: mesh.status,
      inputImageCount: mesh.input_image_count,
      qualityGrade: mesh.quality_grade,
      modelSource: mesh.model_source,
      modelObjectPath: mesh.model_object_path,
      modelSignedUrl,
      thumbnailUrl: mesh.thumbnail_url,
      thumbnailSignedUrl,
      latestJob: latestJob
        ? {
            id: latestJob.id,
            status: latestJob.status,
            progress: latestJob.progress,
            provider: latestJob.provider,
            modelName: latestJob.model_name,
            errorCode: latestJob.error_code,
            errorMessage: latestJob.error_message,
            createdAt: latestJob.created_at,
            startedAt: latestJob.started_at,
            completedAt: latestJob.completed_at,
            failedAt: latestJob.failed_at,
          }
        : null,
      createdAt: mesh.created_at,
      completedAt: mesh.completed_at,
      failedAt: mesh.failed_at,
    },
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await getAuthenticatedUser(request);

  if ("error" in auth) {
    return auth.error;
  }

  const { supabase, user } = auth;
  const { meshId } = await context.params;
  const { data, error } = await supabase
    .from("human_meshes")
    .select("id,status,latest_job_id")
    .eq("id", meshId)
    .eq("user_id", user.id)
    .is("soft_deleted_at", null)
    .maybeSingle();

  if (error) {
    return jsonError("MESH_LOOKUP_FAILED", error.message, 500);
  }

  if (!data) {
    return jsonError("MESH_NOT_FOUND", "삭제할 모델을 찾을 수 없습니다.", 404);
  }

  const mesh = data as DeletableMeshRow;
  let latestJob: DeletableJobRow | null = null;

  if (mesh.latest_job_id) {
    const { data: job, error: jobError } = await supabase
      .from("generation_jobs")
      .select("id,status,model_name,provider_prediction_id")
      .eq("id", mesh.latest_job_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (jobError) {
      return jsonError("GENERATION_JOB_LOOKUP_FAILED", jobError.message, 500);
    }

    latestJob = job as DeletableJobRow | null;
  }

  const deletedAt = new Date();
  const purgeAfter = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const { data: deletedMesh, error: deleteError } = await supabase
    .from("human_meshes")
    .update({
      status: "deleted",
      is_featured: false,
      featured_at: null,
      soft_deleted_at: deletedAt.toISOString(),
      purge_after: purgeAfter.toISOString(),
    })
    .eq("id", mesh.id)
    .eq("user_id", user.id)
    .is("soft_deleted_at", null)
    .select("id")
    .maybeSingle();

  if (deleteError || !deletedMesh) {
    return jsonError(
      "MESH_DELETE_FAILED",
      deleteError?.message ?? "모델 삭제 상태를 저장하지 못했습니다.",
      500,
    );
  }

  const shouldCancelJob = latestJob ? isCancelableStatus(latestJob.status) : false;
  let providerCancellation: "not_applicable" | "canceled" | "failed" = "not_applicable";

  if (latestJob && shouldCancelJob) {
    await supabase
      .from("generation_jobs")
      .update({
        status: "canceled",
        progress: 100,
        error_code: "CANCELED_BY_USER",
        error_message: "사용자가 모델을 삭제해 생성 작업을 취소했습니다.",
        failed_at: null,
      })
      .eq("id", latestJob.id)
      .eq("user_id", user.id)
      .in("status", ["queued", "validating", "preprocessing", "generating", "postprocessing", "thumbnailing"]);

    if (latestJob.provider_prediction_id) {
      const provider = getAIProviderForJob(latestJob.model_name);

      if (provider) {
        try {
          await provider.cancelJob(latestJob.provider_prediction_id);
          providerCancellation = "canceled";
        } catch (providerError) {
          providerCancellation = "failed";
          console.error("Provider cancellation failed after mesh deletion", providerError);
        }
      } else {
        providerCancellation = "failed";
      }
    }
  }

  await supabase.from("usage_events").insert({
    user_id: user.id,
    event_type: "mesh_deleted",
    entity_type: "human_mesh",
    entity_id: mesh.id,
    metadata: {
      previousStatus: mesh.status,
      purgeAfter: purgeAfter.toISOString(),
      providerCancellation,
    },
  });

  return Response.json({
    data: {
      id: mesh.id,
      status: "deleted",
      deletedAt: deletedAt.toISOString(),
      purgeAfter: purgeAfter.toISOString(),
      providerCancellation,
    },
  });
}

function isCancelableStatus(status: string) {
  return [
    "queued",
    "validating",
    "preprocessing",
    "generating",
    "postprocessing",
    "thumbnailing",
  ].includes(status);
}
