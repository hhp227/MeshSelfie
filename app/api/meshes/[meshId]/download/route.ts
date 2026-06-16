import { jsonError } from "@/lib/api";
import { getAuthenticatedUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{
    meshId: string;
  }>;
};

type HumanMeshDownloadRow = {
  id: string;
  status: string;
  model_bucket: string | null;
  model_object_path: string | null;
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
    .select("id,status,model_bucket,model_object_path")
    .eq("id", meshId)
    .eq("user_id", user.id)
    .is("soft_deleted_at", null)
    .single();

  if (error || !data) {
    return jsonError("MESH_NOT_FOUND", "Human Mesh was not found.", 404);
  }

  const mesh = data as unknown as HumanMeshDownloadRow;

  if (mesh.status !== "completed") {
    return jsonError("MESH_NOT_COMPLETED", "아직 다운로드 가능한 상태가 아닙니다.", 409);
  }

  if (!mesh.model_object_path) {
    return jsonError("MODEL_FILE_NOT_FOUND", "모델 파일이 아직 저장되지 않았습니다.", 409);
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from(mesh.model_bucket ?? "avatars")
    .createSignedUrl(mesh.model_object_path, 60 * 5);

  if (signedError || !signed?.signedUrl) {
    return jsonError("SIGNED_URL_FAILED", signedError?.message ?? "Signed URL failed.", 500);
  }

  return Response.json({
    data: {
      url: signed.signedUrl,
      expiresIn: 60 * 5,
    },
  });
}
