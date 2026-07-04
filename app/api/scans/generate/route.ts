import type { SupabaseClient } from "@supabase/supabase-js";

import { getScanAIProvider } from "@/lib/ai/registry";
import { jsonError } from "@/lib/api";
import { getAuthenticatedUser } from "@/lib/auth";
import { getScanReconstructionEnv } from "@/lib/env";
import { getOrCreateProfile } from "@/lib/profiles";

const INPUT_URL_TTL_SECONDS = 1800; // 재구성 시작 시 1회 다운로드 — 콜드스타트 여유 포함

type ScanSessionRow = {
  id: string;
  user_id: string;
  bucket: string;
  input_kind: "video" | "photos";
  video_object_path: string | null;
  frame_object_paths: string[] | null;
  frame_count: number | null;
  quality_grade: string | null;
  status: string;
};

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request);

  if ("error" in auth) {
    return auth.error;
  }

  const { supabase, user } = auth;
  const provider = getScanAIProvider();

  if (!provider) {
    return jsonError(
      "SCAN_WORKER_NOT_CONFIGURED",
      "스캔 재구성 서비스가 아직 설정되지 않았습니다.",
      503,
    );
  }

  const body = (await request.json()) as { scanSessionId?: string };

  if (!body.scanSessionId) {
    return jsonError("SCAN_SESSION_REQUIRED", "스캔 세션 ID가 필요합니다.", 400);
  }

  const { data: sessionData, error: sessionError } = await supabase
    .from("scan_sessions")
    .select(
      "id,user_id,bucket,input_kind,video_object_path,frame_object_paths,frame_count,quality_grade,status",
    )
    .eq("id", body.scanSessionId)
    .eq("user_id", user.id)
    .is("soft_deleted_at", null)
    .maybeSingle();

  if (sessionError) {
    return jsonError("SCAN_SESSION_LOOKUP_FAILED", sessionError.message, 500);
  }

  if (!sessionData) {
    return jsonError("SCAN_SESSION_NOT_FOUND", "스캔 세션을 찾을 수 없습니다.", 404);
  }

  const session = sessionData as unknown as ScanSessionRow;

  if (session.status !== "uploaded") {
    return jsonError(
      "SCAN_SESSION_ALREADY_USED",
      "이미 처리 중이거나 완료된 스캔입니다.",
      409,
    );
  }

  const { profile, error: profileError } = await getOrCreateProfile(supabase, user);

  if (profileError || !profile) {
    return jsonError("PROFILE_SYNC_FAILED", profileError?.message ?? "Profile sync failed.", 500);
  }

  if (profile.remaining_credits <= 0) {
    return jsonError("INSUFFICIENT_CREDITS", "남은 생성 크레딧이 없습니다.", 402);
  }

  const qualityGrade = session.quality_grade ?? "A"; // 동영상은 프레임 수 미정 → 기본 A
  const inputImageCount = session.frame_count ?? 1;

  const { data: mesh, error: meshError } = await supabase
    .from("human_meshes")
    .insert({
      user_id: user.id,
      title: "Photogrammetry Scan",
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
      provider: "self_hosted",
      model_name: provider.modelName,
      status: "queued",
      progress: 0,
      quality_grade: qualityGrade,
      used_credits: 1,
      input_payload: {
        scanSessionId: session.id,
        inputKind: session.input_kind,
      },
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return jsonError("JOB_CREATE_FAILED", jobError?.message ?? "Job create failed.", 500);
  }

  await supabase.from("human_meshes").update({ latest_job_id: job.id }).eq("id", mesh.id);

  // 입력 signed URL 발급
  let videoUrl: string | null = null;
  let imageUrls: string[] = [];

  if (session.input_kind === "video" && session.video_object_path) {
    const { data: signed, error: signError } = await supabase.storage
      .from(session.bucket)
      .createSignedUrl(session.video_object_path, INPUT_URL_TTL_SECONDS);

    if (signError || !signed?.signedUrl) {
      await markFailed(supabase, mesh.id, job.id, "SCAN_INPUT_URL_FAILED");
      return jsonError("SCAN_INPUT_URL_FAILED", "스캔 입력 URL 생성에 실패했습니다.", 500);
    }

    videoUrl = signed.signedUrl;
  } else if (session.frame_object_paths) {
    const { data: signedList, error: signError } = await supabase.storage
      .from(session.bucket)
      .createSignedUrls(session.frame_object_paths, INPUT_URL_TTL_SECONDS);

    imageUrls = (signedList ?? [])
      .map((item) => item.signedUrl)
      .filter((url): url is string => Boolean(url));

    if (signError || imageUrls.length !== session.frame_object_paths.length) {
      await markFailed(supabase, mesh.id, job.id, "SCAN_INPUT_URL_FAILED");
      return jsonError("SCAN_INPUT_URL_FAILED", "스캔 입력 URL 생성에 실패했습니다.", 500);
    }
  }

  // scan worker 호출 (head-reconstruction과 동일 계약, 입력만 video/imageUrls)
  const { apiUrl, apiKey } = getScanReconstructionEnv();
  let providerJobId: string;

  try {
    const response = await fetch(`${apiUrl}/v1/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientJobId: job.id,
        userId: user.id,
        model: provider.modelName,
        input: { videoUrl, imageUrls, outputFormat: "glb" },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });

    const responseBody = (await response.json().catch(() => null)) as { id?: string } | null;

    if (!response.ok || !responseBody?.id) {
      throw new Error(`Scan worker returned ${response.status}.`);
    }

    providerJobId = responseBody.id;
  } catch (workerError) {
    await markFailed(
      supabase,
      mesh.id,
      job.id,
      "SCAN_WORKER_FAILED",
      workerError instanceof Error ? workerError.message : undefined,
    );
    return jsonError("SCAN_WORKER_FAILED", "3D 재구성 작업을 시작하지 못했습니다.", 502);
  }

  await Promise.all([
    supabase
      .from("human_meshes")
      .update({ status: "generating" })
      .eq("id", mesh.id),
    supabase
      .from("generation_jobs")
      .update({
        provider_prediction_id: providerJobId,
        status: "generating",
        progress: 5,
        started_at: new Date().toISOString(),
      })
      .eq("id", job.id),
    supabase
      .from("scan_sessions")
      .update({ status: "processing", human_mesh_id: mesh.id })
      .eq("id", session.id),
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
      metadata: { humanMeshId: mesh.id, scanSessionId: session.id, provider: "photogrammetry" },
    }),
  ]);

  return Response.json({
    data: {
      humanMeshId: mesh.id,
      jobId: job.id,
      status: "generating",
      qualityGrade,
      provider: "self_hosted",
      providerJobId,
    },
  });
}

async function markFailed(
  supabase: SupabaseClient,
  meshId: string,
  jobId: string,
  errorCode: string,
  internalError?: string,
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
        error_message: "3D 재구성 작업을 시작하지 못했습니다.",
        internal_error: internalError ?? null,
        failed_at: failedAt,
      })
      .eq("id", jobId),
  ]);
}
