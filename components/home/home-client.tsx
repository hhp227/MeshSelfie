"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AppNav } from "@/components/app-nav";
import { GalleryFeed } from "@/components/landing/gallery-feed";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { getAccessTokenWithRetry } from "@/lib/supabase/session";

type ProfileData = {
  email: string;
  role: "user" | "admin";
  meshCount: number;
  completedMeshCount: number;
  remainingCredits: number;
  usedCredits: number;
};

type MeshItem = {
  id: string;
  title: string | null;
  status: string;
  inputImageCount: number;
  qualityGrade: string;
  modelSource: string;
  thumbnailUrl: string | null;
  createdAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  queued: "대기 중",
  validating: "검증 중",
  preprocessing: "전처리 중",
  generating: "생성 중",
  postprocessing: "후처리 중",
  thumbnailing: "마무리 중",
  completed: "완료",
  failed: "실패",
  canceled: "취소됨",
};

const STATUS_BADGE_STYLES: Record<string, string> = {
  completed: "bg-teal-600 text-white",
  failed: "bg-red-600 text-white",
  canceled: "bg-zinc-500 text-white",
};

const CARD_GRADIENTS = [
  "from-teal-400 to-teal-700",
  "from-indigo-400 to-indigo-700",
  "from-rose-400 to-rose-700",
  "from-amber-400 to-orange-700",
  "from-sky-400 to-sky-700",
  "from-emerald-400 to-emerald-700",
];

export function HomeClient() {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [meshes, setMeshes] = useState<MeshItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHome() {
      if (!supabase) {
        router.replace("/landing");
        return;
      }

      const token = await getAccessTokenWithRetry(supabase);

      if (cancelled) {
        return;
      }

      // 비로그인 방문자는 랜딩 페이지로 안내한다
      if (!token) {
        router.replace("/landing");
        return;
      }

      const headers = { Authorization: `Bearer ${token}` };
      const [profileResult, meshResult] = await Promise.all([
        fetch("/api/profile", { headers }),
        fetch("/api/avatars", { headers }),
      ]);

      if (cancelled) {
        return;
      }

      if (!profileResult.ok || !meshResult.ok) {
        setError("홈 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
        setLoading(false);
        return;
      }

      const profileJson = (await profileResult.json()) as { data: ProfileData };
      const meshJson = (await meshResult.json()) as { data: MeshItem[] };

      if (cancelled) {
        return;
      }

      setProfile(profileJson.data);
      setMeshes(meshJson.data);
      setLoading(false);
    }

    void loadHome();

    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-stone-50 text-sm text-zinc-600">
        MeshSelfie를 불러오는 중입니다.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-950">
      <AppNav />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-8">
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <section className="flex flex-col justify-between gap-5 rounded-2xl border border-zinc-200 bg-white p-6 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">
              안녕하세요{profile ? `, ${profile.email}` : ""} 👋
            </h1>
            <p className="text-sm text-zinc-600">
              완료 모델 {profile?.completedMeshCount ?? 0}개 · 전체 {profile?.meshCount ?? 0}개
              · 남은 크레딧 <span className="font-semibold text-zinc-900">{profile?.remainingCredits ?? 0}</span>개
            </p>
          </div>
          <Link
            href="/upload"
            className="flex h-12 shrink-0 items-center justify-center rounded-md bg-zinc-950 px-6 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            + 새 3D 모델 생성
          </Link>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">내 모델</h2>
            <Link href="/dashboard" className="text-sm font-medium text-zinc-600 hover:text-zinc-950">
              전체 관리 →
            </Link>
          </div>

          {meshes.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-14 text-center">
              <p className="text-base font-semibold text-zinc-900">아직 생성한 3D 모델이 없습니다</p>
              <p className="text-sm text-zinc-600">
                정면 사진 한 장이면 실사형 3D 헤드 메쉬를 만들 수 있어요.
              </p>
              <Link
                href="/upload"
                className="mt-2 flex h-11 items-center justify-center rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                첫 모델 만들기
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {meshes.map((mesh, index) => (
                <Link
                  key={mesh.id}
                  href={`/result/${mesh.id}`}
                  className="group relative aspect-square overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100"
                >
                  {mesh.thumbnailUrl ? (
                    // Storage signed URL은 도메인이 동적이라 next/image 대신 img를 사용
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mesh.thumbnailUrl}
                      alt={mesh.title ?? "3D 모델 썸네일"}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <>
                      <div
                        className={`absolute inset-0 bg-gradient-to-br ${CARD_GRADIENTS[index % CARD_GRADIENTS.length]} transition-transform duration-300 group-hover:scale-105`}
                        aria-hidden
                      />
                      <svg
                        className="pointer-events-none absolute inset-0 m-auto h-16 w-16 text-white/40"
                        viewBox="0 0 200 200"
                        fill="none"
                        aria-hidden
                      >
                        <circle cx="100" cy="72" r="42" fill="currentColor" />
                        <path d="M30 190c0-45 31-82 70-82s70 37 70 82" fill="currentColor" />
                      </svg>
                    </>
                  )}

                  <span
                    className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      STATUS_BADGE_STYLES[mesh.status] ?? "bg-zinc-800/80 text-white"
                    }`}
                  >
                    {STATUS_LABELS[mesh.status] ?? mesh.status}
                  </span>
                  <span className="absolute right-2 top-2 rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-bold text-zinc-800">
                    {mesh.qualityGrade}
                  </span>

                  <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/65 to-transparent px-3 py-2 text-white">
                    <span className="truncate text-xs font-semibold">
                      {mesh.title ?? "Untitled Mesh"}
                    </span>
                    <span className="text-[11px] text-white/75">
                      {new Date(mesh.createdAt).toLocaleDateString("ko-KR")} · 사진 {mesh.inputImageCount}장
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="border-t border-zinc-200 pt-10">
          <GalleryFeed />
        </section>

        <footer className="flex flex-col gap-1 border-t border-zinc-200 py-6 text-xs text-zinc-400">
          <p>&copy; {new Date().getFullYear()} MeshSelfie</p>
          <p>
            두상 재구성에 FLAME 모델(MPI-IS,{" "}
            <a
              href="https://flame.is.tue.mpg.de"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-zinc-600"
            >
              CC-BY-4.0
            </a>
            )을 사용합니다.
          </p>
        </footer>
      </main>
    </div>
  );
}
