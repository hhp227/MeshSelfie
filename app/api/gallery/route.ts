import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { jsonError } from "@/lib/api";

// 공개 갤러리 (인증 불필요) — 완료된 메쉬는 기본 공개 정책.
// GET 라우트 핸들러는 기본적으로 정적 캐시되므로 서명 URL이 굳지 않게 강제 동적.
export const dynamic = "force-dynamic";

const GALLERY_LIMIT = 12;
const THUMBNAIL_URL_TTL_SECONDS = 60 * 10;

type GalleryMeshRow = {
  id: string;
  user_id: string;
  title: string | null;
  quality_grade: string;
  thumbnail_object_path: string | null;
  is_featured: boolean | null;
  completed_at: string | null;
  created_at: string;
};

export async function GET() {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return jsonError("SERVER_NOT_CONFIGURED", "서버 설정이 완료되지 않았습니다.", 500);
  }

  const { data, error } = await supabase
    .from("human_meshes")
    .select(
      "id,user_id,title,quality_grade,thumbnail_object_path,is_featured,completed_at,created_at",
    )
    .eq("status", "completed")
    .is("soft_deleted_at", null)
    .not("thumbnail_object_path", "is", null)
    .order("is_featured", { ascending: false })
    .order("completed_at", { ascending: false })
    .limit(GALLERY_LIMIT);

  if (error) {
    return jsonError("GALLERY_LOOKUP_FAILED", "갤러리를 불러오지 못했습니다.", 500);
  }

  const meshes = (data ?? []) as unknown as GalleryMeshRow[];

  if (meshes.length === 0) {
    return Response.json({ data: [] });
  }

  const userIds = Array.from(new Set(meshes.map((mesh) => mesh.user_id)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id,display_name")
    .in("id", userIds);

  const displayNames = new Map(
    (profiles ?? []).map((profile) => [profile.id as string, profile.display_name as string | null]),
  );

  const thumbnailPaths = meshes
    .map((mesh) => mesh.thumbnail_object_path)
    .filter((path): path is string => Boolean(path));
  const { data: signedList } = await supabase.storage
    .from("avatars")
    .createSignedUrls(thumbnailPaths, THUMBNAIL_URL_TTL_SECONDS);

  const signedThumbnails = new Map(
    (signedList ?? [])
      .filter((item) => item.signedUrl && item.path)
      .map((item) => [item.path as string, item.signedUrl]),
  );

  return Response.json({
    data: meshes.map((mesh) => ({
      id: mesh.id,
      title: mesh.title,
      qualityGrade: mesh.quality_grade,
      // user_id는 공개하지 않는다 — 표시 이름만 노출
      displayName: displayNames.get(mesh.user_id) ?? null,
      isFeatured: Boolean(mesh.is_featured),
      completedAt: mesh.completed_at ?? mesh.created_at,
      thumbnailUrl: mesh.thumbnail_object_path
        ? signedThumbnails.get(mesh.thumbnail_object_path) ?? null
        : null,
    })),
  });
}
