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
  { id: "1", gradient: "from-clay-300 to-clay-500", qualityGrade: "A+", daysAgo: 1 },
  { id: "2", gradient: "from-celadon-400 to-celadon-700", qualityGrade: "A", daysAgo: 2 },
  { id: "3", gradient: "from-clay-400 to-kiln-600", qualityGrade: "A+", daysAgo: 3 },
  { id: "4", gradient: "from-clay-200 to-clay-400", qualityGrade: "B", daysAgo: 4 },
  { id: "5", gradient: "from-celadon-100 to-celadon-400", qualityGrade: "A", daysAgo: 5 },
  { id: "6", gradient: "from-clay-300 to-celadon-600", qualityGrade: "A+", daysAgo: 6 },
  { id: "7", gradient: "from-kiln-100 to-clay-500", qualityGrade: "A", daysAgo: 7 },
  { id: "8", gradient: "from-clay-300 to-clay-500", qualityGrade: "B", daysAgo: 8 },
];

const QUALITY_BADGE_STYLE: Record<string, string> = {
  "S+": "bg-kiln-700 text-clay-50",
  S: "bg-kiln-600 text-clay-50",
  "A+": "bg-celadon-600 text-clay-50",
  A: "bg-ink text-clay-50",
  B: "bg-clay-500 text-clay-50",
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
        <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-celadon-600">
          Community Gallery
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          사용자들이 만든 실사형 3D 메쉬
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-ink-dim">
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
              className="group relative aspect-square overflow-hidden rounded-md border border-hairline bg-clay-200"
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
                  className="absolute inset-0 bg-gradient-to-br from-clay-300 to-clay-500"
                  aria-hidden
                />
              )}

              <span
                className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  QUALITY_BADGE_STYLE[mesh.qualityGrade] ?? "bg-clay-500 text-clay-50"
                }`}
              >
                {mesh.qualityGrade}
              </span>

              {mesh.isFeatured ? (
                <span className="absolute right-2 top-2 rounded-full bg-kiln-600 px-2 py-0.5 text-[11px] font-semibold text-clay-50">
                  Featured
                </span>
              ) : null}

              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-ink/60 to-transparent px-2.5 py-2 text-clay-50">
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
              className="group relative aspect-square overflow-hidden rounded-md border border-hairline bg-clay-200"
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
                  QUALITY_BADGE_STYLE[card.qualityGrade] ?? "bg-clay-500 text-clay-50"
                }`}
              >
                {card.qualityGrade}
              </span>

              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-ink/60 to-transparent px-2.5 py-2 text-clay-50">
                <span className="text-[11px] font-medium">예시 카드 · {card.daysAgo}일 전</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
