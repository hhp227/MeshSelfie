import { getBearerToken, jsonError } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function getAuthenticatedUser(request: Request) {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return {
      error: jsonError(
        "SUPABASE_NOT_CONFIGURED",
        "Supabase environment variables are not configured.",
        500,
      ),
    };
  }

  const token = getBearerToken(request);

  if (!token) {
    return { error: jsonError("UNAUTHORIZED", "Authentication is required.", 401) };
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { error: jsonError("UNAUTHORIZED", "Invalid or expired session.", 401) };
  }

  return { supabase, user };
}
