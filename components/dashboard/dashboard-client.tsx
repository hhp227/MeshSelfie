"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { getAccessTokenWithRetry } from "@/lib/supabase/session";

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
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      if (!supabase) {
        setError("Supabase 환경 변수가 설정되지 않았습니다.");
        setLoading(false);
        return;
      }

      const token = await getAccessTokenWithRetry(supabase);

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

  async function handleDelete(avatar: AvatarListResponse["data"][number]) {
    if (!supabase || deletingId) {
      return;
    }

    const confirmed = window.confirm(
      `"${avatar.title ?? "Untitled Mesh"}" 모델을 삭제할까요? 30일 후 영구 삭제됩니다.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(avatar.id);
    setActionError(null);
    const token = await getAccessTokenWithRetry(supabase);

    if (!token) {
      setActionError("로그인 세션을 확인하지 못했습니다.");
      setDeletingId(null);
      return;
    }

    const result = await fetch(`/api/meshes/${avatar.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!result.ok) {
      const body = await result.json().catch(() => null);
      setActionError(body?.error?.message ?? "모델을 삭제하지 못했습니다.");
      setDeletingId(null);
      return;
    }

    setAvatars((current) => current.filter((item) => item.id !== avatar.id));
    setProfile((current) =>
      current
        ? {
            ...current,
            meshCount: Math.max(current.meshCount - 1, 0),
            completedMeshCount:
              avatar.status === "completed"
                ? Math.max(current.completedMeshCount - 1, 0)
                : current.completedMeshCount,
          }
        : current,
    );
    setDeletingId(null);
  }

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
          <div className="flex items-center gap-2">
            {profile?.role === "admin" ? (
              <Link
                href="/admin"
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
              >
                관리자 모델 업로드
              </Link>
            ) : null}
            <Link
              href="/upload"
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              새 모델 생성
            </Link>
          </div>
        </div>

        {actionError ? (
          <p className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {actionError}
          </p>
        ) : null}

        {avatars.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            아직 생성된 3D 모델이 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-zinc-200">
            {avatars.map((avatar) => (
              <div
                key={avatar.id}
                className="grid items-center gap-3 p-4 hover:bg-zinc-50 sm:grid-cols-[minmax(0,1fr)_100px_80px_70px_110px_72px]"
              >
                <Link
                  href={`/result/${avatar.id}`}
                  className="truncate font-medium text-zinc-950 hover:underline"
                >
                  {avatar.title ?? "Untitled Mesh"}
                </Link>
                <span className="text-sm text-zinc-600">{avatar.status}</span>
                <span className="text-sm text-zinc-600">{avatar.inputImageCount}장</span>
                <span className="text-sm text-zinc-600">{avatar.qualityGrade}</span>
                <span className="text-sm text-zinc-600">{avatar.modelSource}</span>
                <button
                  type="button"
                  onClick={() => void handleDelete(avatar)}
                  disabled={deletingId !== null}
                  className="rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deletingId === avatar.id ? "삭제 중" : "삭제"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
