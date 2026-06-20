import { getAuthenticatedAdmin } from "@/lib/admin";
import {
  AdminModelValidationError,
  isAdminUploadPurpose,
  validateAdminModelFile,
} from "@/lib/admin-models";
import { jsonError } from "@/lib/api";

type HumanMeshRow = {
  id: string;
  user_id: string;
};

export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await getAuthenticatedAdmin(request);

  if ("error" in auth) {
    return auth.error;
  }

  const { supabase, user } = auth;
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonError("INVALID_MULTIPART_BODY", "업로드 요청 형식이 올바르지 않습니다.", 400);
  }

  const modelFile = formData.get("modelFile");
  const purpose = String(formData.get("purpose") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const targetUserId = String(formData.get("targetUserId") ?? "").trim() || null;
  const humanMeshId = String(formData.get("humanMeshId") ?? "").trim() || null;

  if (!(modelFile instanceof File)) {
    return jsonError("MODEL_FILE_REQUIRED", "업로드할 모델 파일이 필요합니다.", 400);
  }

  if (!isAdminUploadPurpose(purpose)) {
    return jsonError("INVALID_UPLOAD_PURPOSE", "올바른 업로드 목적을 선택해주세요.", 400);
  }

  if (reason.length > 1000) {
    return jsonError("REASON_TOO_LONG", "작업 사유는 1000자 이하여야 합니다.", 400);
  }

  let validatedModel;

  try {
    validatedModel = await validateAdminModelFile(modelFile);
  } catch (error) {
    if (error instanceof AdminModelValidationError) {
      return jsonError(error.code, error.message, error.status);
    }

    return jsonError("MODEL_VALIDATION_FAILED", "모델 파일을 검증하지 못했습니다.", 500);
  }

  const uploadId = crypto.randomUUID();
  let targetMesh: HumanMeshRow | null = null;
  let action: "replace" | "sample_create";
  let objectPath: string;

  if (purpose === "sample") {
    action = "sample_create";
    objectPath = `admin/sample_models/${uploadId}/mesh.${validatedModel.extension}`;
  } else {
    if (!humanMeshId) {
      return jsonError(
        "HUMAN_MESH_REQUIRED",
        "사용자 모델을 교체하려면 Human Mesh ID가 필요합니다.",
        400,
      );
    }

    const { data: mesh, error: meshError } = await supabase
      .from("human_meshes")
      .select("id,user_id")
      .eq("id", humanMeshId)
      .is("soft_deleted_at", null)
      .single();

    if (meshError || !mesh) {
      return jsonError("HUMAN_MESH_NOT_FOUND", "교체할 Human Mesh를 찾을 수 없습니다.", 404);
    }

    targetMesh = mesh as HumanMeshRow;

    if (targetUserId && targetUserId !== targetMesh.user_id) {
      return jsonError("TARGET_USER_MISMATCH", "대상 사용자와 모델 소유자가 일치하지 않습니다.", 400);
    }

    action = "replace";
    objectPath = `models/${targetMesh.user_id}/${targetMesh.id}/admin_uploaded.${validatedModel.extension}`;
  }

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(objectPath, validatedModel.bytes, {
      contentType: validatedModel.contentType,
      upsert: true,
    });

  if (uploadError) {
    return jsonError("ADMIN_MODEL_UPLOAD_FAILED", uploadError.message, 500);
  }

  const { error: auditError } = await supabase.from("admin_model_uploads").insert({
    id: uploadId,
    admin_user_id: user.id,
    target_user_id: targetMesh?.user_id ?? null,
    human_mesh_id: targetMesh?.id ?? null,
    action,
    model_bucket: "avatars",
    model_object_path: objectPath,
    original_filename: modelFile.name,
    content_type: validatedModel.contentType,
    file_size_bytes: validatedModel.bytes.byteLength,
    reason: reason || purpose,
  });

  if (auditError) {
    return jsonError("ADMIN_UPLOAD_AUDIT_FAILED", auditError.message, 500);
  }

  if (targetMesh) {
    const completedAt = new Date().toISOString();
    const { error: meshUpdateError } = await supabase
      .from("human_meshes")
      .update({
        latest_job_id: null,
        status: "completed",
        model_source: "admin_uploaded",
        model_bucket: "avatars",
        model_object_path: objectPath,
        model_content_type: validatedModel.contentType,
        model_file_size_bytes: validatedModel.bytes.byteLength,
        completed_at: completedAt,
        failed_at: null,
      })
      .eq("id", targetMesh.id)
      .eq("user_id", targetMesh.user_id);

    if (meshUpdateError) {
      return jsonError("ADMIN_MODEL_REPLACE_FAILED", meshUpdateError.message, 500);
    }
  }

  await supabase.from("usage_events").insert({
    user_id: targetMesh?.user_id ?? null,
    event_type: targetMesh ? "admin_model_replaced" : "admin_model_uploaded",
    entity_type: targetMesh ? "human_mesh" : "admin_model_upload",
    entity_id: targetMesh?.id ?? uploadId,
    metadata: {
      adminUserId: user.id,
      adminUploadId: uploadId,
      purpose,
      modelObjectPath: objectPath,
    },
  });

  return Response.json({
    data: {
      humanMeshId: targetMesh?.id ?? null,
      modelSource: "admin_uploaded",
      modelObjectPath: objectPath,
      adminUploadId: uploadId,
      action,
    },
  });
}
