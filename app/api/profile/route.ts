import { getBearerToken, jsonError } from "@/lib/api";
import { getOrCreateProfile } from "@/lib/profiles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

  const { profile, error: profileError } = await getOrCreateProfile(supabase, user);

  if (profileError || !profile) {
    return jsonError(
      "PROFILE_SYNC_FAILED",
      profileError?.message ?? "Profile sync failed.",
      500,
    );
  }

  const [{ count: meshCount }, { count: completedMeshCount }] = await Promise.all([
    supabase
      .from("human_meshes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("soft_deleted_at", null),
    supabase
      .from("human_meshes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "completed")
      .is("soft_deleted_at", null),
  ]);

  return Response.json({
    data: {
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      role: profile.role,
      meshCount: meshCount ?? 0,
      completedMeshCount: completedMeshCount ?? 0,
      dailyQuota: profile.mesh_quota_daily,
      remainingCredits: profile.remaining_credits,
      usedCredits: profile.used_credits,
      createdAt: profile.created_at,
    },
  });
}
