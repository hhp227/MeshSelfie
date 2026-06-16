import { jsonError } from "@/lib/api";
import { getAuthenticatedUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

type GenerationJobRow = {
  id: string;
  human_mesh_id: string;
  provider: string;
  model_name: string;
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
        "human_mesh_id",
        "provider",
        "model_name",
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
