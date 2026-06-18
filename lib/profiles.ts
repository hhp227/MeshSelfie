import type { SupabaseClient, User } from "@supabase/supabase-js";

export type ProfileRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: "user" | "admin";
  mesh_quota_daily: number;
  remaining_credits: number;
  used_credits: number;
  created_at: string;
};

const PROFILE_SELECT =
  "id,email,display_name,role,mesh_quota_daily,remaining_credits,used_credits,created_at";

export async function getOrCreateProfile(supabase: SupabaseClient, user: User) {
  const { data: existing, error: lookupError } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", user.id)
    .maybeSingle();

  if (lookupError) {
    return { profile: null, error: lookupError };
  }

  if (existing) {
    return { profile: existing as ProfileRow, error: null };
  }

  const { data: created, error: createError } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      email: user.email ?? "",
    })
    .select(PROFILE_SELECT)
    .single();

  if (!createError && created) {
    return { profile: created as ProfileRow, error: null };
  }

  if (createError?.code === "23505") {
    const { data: racedProfile, error: racedError } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", user.id)
      .single();

    return {
      profile: racedProfile as ProfileRow | null,
      error: racedError,
    };
  }

  return { profile: null, error: createError };
}
