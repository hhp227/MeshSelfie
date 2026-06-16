"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type ProfileResponse = {
  data: {
    email: string;
    role: "user" | "admin";
    meshCount: number;
    completedMeshCount: number;
    remainingCredits: number;
    usedCredits: number;
  };
};

type AvatarListResponse = {
  data: Array<{
    id: string;
    title: string | null;
    status: string;
    inputImageCount: number;
    qualityGrade: string;
    modelSource: string;
    thumbnailUrl: string | null;
    createdAt: string;
  }>;
};

export function DashboardClient() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [profile, setProfile] = useState<ProfileResponse["data"] | null>(null);
  const [avatars, setAvatars] = useState<AvatarListResponse["data"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function getAccessTokenWithRetry() {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const { data } = await supabase!.auth.getSession();
        const token = data.session?.access_token;

        if (token) {
          return token;
        }

        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      return null;
    }

    async function loadDashboard() {
      if (!supabase) {
        setError("Supabase 환경 변수가 설정되지 않았습니다.");
        setLoading(false);
        return;
      }

      const token = await getAccessTokenWithRetry();

      if (cancelled) {
        return;
      }

      if (!token) {
        setError("로그인이 필요합니다.");
        setLoading(false);
        return;
      }

      const headers = { Authorization: `Bearer ${token}` };
      const [profileResult, avatarResult] = await Promise.all([
        fetch("/api/profile", { headers }),
        fetch("/api/avatars", { headers }),
      ]);

      if (!profileResult.ok || !avatarResult.ok) {
        setError("대시보드 정보를 불러오지 못했습니다.");
        setLoading(false);
        return;
      }

      const profileJson = (await profileResult.json()) as ProfileResponse;
      const avatarJson = (await avatarResult.json()) as AvatarListResponse;

      if (cancelled) {
        return;
      }

      setProfile(profileJson.data);
      setAvatars(avatarJson.data);
      setLoading(false);
    }

    void loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  if (loading) {
    return <p className="text-sm text-zinc-600">대시보드를 불러오는 중입니다.</p>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {error}{" "}
        <Link href="/login" className="font-semibold underline">
          로그인으로 이동
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 sm:grid-cols-4">
        {[
          ["완료 모델", profile?.completedMeshCount ?? 0],
          ["전체 생성", profile?.meshCount ?? 0],
          ["남은 크레딧", profile?.remainingCredits ?? 0],
          ["사용 크레딧", profile?.usedCredits ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-sm text-zinc-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white">
        <div className="flex items-center justify-between border-b border-zinc-200 p-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">생성 모델</h2>
            <p className="mt-1 text-sm text-zinc-500">{profile?.email}</p>
          </div>
          <Link
            href="/upload"
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            새 모델 생성
          </Link>
        </div>

        {avatars.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            아직 생성된 3D 모델이 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-zinc-200">
            {avatars.map((avatar) => (
              <Link
                key={avatar.id}
                href={`/result/${avatar.id}`}
                className="grid gap-3 p-4 hover:bg-zinc-50 sm:grid-cols-[1fr_120px_120px_120px_120px]"
              >
                <span className="font-medium text-zinc-950">
                  {avatar.title ?? "Untitled Mesh"}
                </span>
                <span className="text-sm text-zinc-600">{avatar.status}</span>
                <span className="text-sm text-zinc-600">{avatar.inputImageCount}장</span>
                <span className="text-sm text-zinc-600">{avatar.qualityGrade}</span>
                <span className="text-sm text-zinc-600">{avatar.modelSource}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
