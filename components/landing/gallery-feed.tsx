"use client";

import { useEffect, useState } from "react";

type GalleryMesh = {
  id: string;
  title: string | null;
  qualityGrade: string;
  displayName: string | null;
  isFeatured: boolean;
  completedAt: string;
  thumbnailUrl: string | null;
};

type PlaceholderCard = {
  id: string;
  gradient: string;
  qualityGrade: string;
  daysAgo: number;
};

// 갤러리가 비어 있을 때만 보여주는 레이아웃 예시 카드
const PLACEHOLDER_CARDS: PlaceholderCard[] = [
  { id: "1", gradient: "from-teal-400 to-teal-700", qualityGrade: "A+", daysAgo: 1 },
  { id: "2", gradient: "from-indigo-400 to-indigo-700", qualityGrade: "A", daysAgo: 2 },
  { id: "3", gradient: "from-rose-400 to-rose-700", qualityGrade: "A+", daysAgo: 3 },
  { id: "4", gradient: "from-amber-400 to-orange-700", qualityGrade: "B", daysAgo: 4 },
  { id: "5", gradient: "from-sky-400 to-sky-700", qualityGrade: "A", daysAgo: 5 },
  { id: "6", gradient: "from-emerald-400 to-emerald-700", qualityGrade: "A+", daysAgo: 6 },
  { id: "7", gradient: "from-fuchsia-400 to-fuchsia-700", qualityGrade: "A", daysAgo: 7 },
  { id: "8", gradient: "from-zinc-400 to-zinc-700", qualityGrade: "B", daysAgo: 8 },
];

const QUALITY_BADGE_STYLE: Record<string, string> = {
  "S+": "bg-violet-600 text-white",
  S: "bg-violet-500 text-white",
  "A+": "bg-teal-600 text-white",
  A: "bg-zinc-800 text-white",
  B: "bg-zinc-500 text-white",
};

function daysAgoLabel(iso: string) {
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000)),
  );
  return days === 0 ? "오늘" : `${days}일 전`;
}

export function GalleryFeed() {
  const [meshes, setMeshes] = useState<GalleryMesh[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadGallery() {
      try {
        const result = await fetch("/api/gallery");

        if (!result.ok) {
          throw new Error(`gallery returned ${result.status}`);
        }

        const json = (await result.json()) as { data: GalleryMesh[] };

        if (!cancelled) {
          setMeshes(json.data);
        }
      } catch {
        if (!cancelled) {
          setMeshes([]);
        }
      }
    }

    void loadGallery();

    return () => {
      cancelled = true;
    };
  }, []);

  const hasRealMeshes = (meshes?.length ?? 0) > 0;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">
          Community Gallery
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">
          사용자들이 만든 실사형 3D 메쉬
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-zinc-600">
          {hasRealMeshes
            ? "MeshSelfie 사용자들이 실제로 생성한 3D 모델의 썸네일입니다."
            : "아직 공개된 모델이 없어 레이아웃 예시를 보여드립니다. 정식 오픈 후에는 사용자가 생성한 모델의 실제 썸네일로 채워집니다."}
        </p>
      </div>

      {hasRealMeshes ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {meshes!.map((mesh) => (
            <div
              key={mesh.id}
              className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-100"
            >
              {mesh.thumbnailUrl ? (
                // Storage signed URL은 도메인이 동적이라 next/image 대신 img를 사용
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mesh.thumbnailUrl}
                  alt={mesh.title ?? "사용자 생성 3D 모델 썸네일"}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div
                  className="absolute inset-0 bg-gradient-to-br from-zinc-300 to-zinc-500"
                  aria-hidden
                />
              )}

              <span
                className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  QUALITY_BADGE_STYLE[mesh.qualityGrade] ?? "bg-zinc-500 text-white"
                }`}
              >
                {mesh.qualityGrade}
              </span>

              {mesh.isFeatured ? (
                <span className="absolute right-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                  Featured
                </span>
              ) : null}

              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-2.5 py-2 text-white">
                <span className="text-[11px] font-medium">
                  {mesh.displayName ?? "익명 사용자"} · {daysAgoLabel(mesh.completedAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {PLACEHOLDER_CARDS.map((card) => (
            <div
              key={card.id}
              className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-100"
            >
              <div
                className={`absolute inset-0 bg-gradient-to-br ${card.gradient} transition-transform duration-300 group-hover:scale-105`}
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

              <span
                className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  QUALITY_BADGE_STYLE[card.qualityGrade] ?? "bg-zinc-500 text-white"
                }`}
              >
                {card.qualityGrade}
              </span>

              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-2.5 py-2 text-white">
                <span className="text-[11px] font-medium">예시 카드 · {card.daysAgo}일 전</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
