import { getBearerToken, jsonError } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type HumanMeshListRow = {
  id: string;
  title: string | null;
  status: string;
  input_image_count: number;
  quality_grade: string;
  model_source: string;
  thumbnail_url: string | null;
  model_object_path: string | null;
  created_at: string;
  completed_at: string | null;
};

export async function GET(request: Request) {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return jsonError(
      "SUPABASE_NOT_CONFIGURED",
      "Supabase environment variables are not configured.",
      500,
    );
  }

  const token = getBearerToken(request);

  if (!token) {
    return jsonError("UNAUTHORIZED", "Authentication is required.", 401);
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return jsonError("UNAUTHORIZED", "Invalid or expired session.", 401);
  }

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
        "thumbnail_url",
        "model_object_path",
        "created_at",
        "completed_at",
      ].join(","),
    )
    .eq("user_id", user.id)
    .is("soft_deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return jsonError("AVATAR_LIST_FAILED", error.message, 500);
  }

  const meshes = data as unknown as HumanMeshListRow[];

  return Response.json({
    data: meshes.map((mesh) => ({
      id: mesh.id,
      title: mesh.title,
      status: mesh.status,
      inputImageCount: mesh.input_image_count,
      qualityGrade: mesh.quality_grade,
      modelSource: mesh.model_source,
      thumbnailUrl: mesh.thumbnail_url,
      modelObjectPath: mesh.model_object_path,
      createdAt: mesh.created_at,
      completedAt: mesh.completed_at,
    })),
  });
}
