import { jsonError } from "@/lib/api";
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
