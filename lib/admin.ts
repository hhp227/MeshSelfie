import { jsonError } from "@/lib/api";
import { getAuthenticatedUser } from "@/lib/auth";

export async function getAuthenticatedAdmin(request: Request) {
  const auth = await getAuthenticatedUser(request);

  if ("error" in auth) {
    return auth;
  }

  const { data: profile, error } = await auth.supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();

  if (error) {
    return {
      error: jsonError("ADMIN_ROLE_LOOKUP_FAILED", "관리자 권한을 확인하지 못했습니다.", 500),
    };
  }

  if (profile?.role !== "admin") {
    return {
      error: jsonError("FORBIDDEN", "관리자 권한이 필요합니다.", 403),
    };
  }

  return auth;
}
