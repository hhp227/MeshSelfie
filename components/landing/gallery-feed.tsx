type MockMesh = {
  id: string;
  gradient: string;
  qualityGrade: "B" | "A" | "A+";
  daysAgo: number;
  likes: number;
};

const MOCK_MESHES: MockMesh[] = [
  { id: "1", gradient: "from-teal-400 to-teal-700", qualityGrade: "A+", daysAgo: 1, likes: 42 },
  { id: "2", gradient: "from-indigo-400 to-indigo-700", qualityGrade: "A", daysAgo: 2, likes: 18 },
  { id: "3", gradient: "from-rose-400 to-rose-700", qualityGrade: "A+", daysAgo: 3, likes: 63 },
  { id: "4", gradient: "from-amber-400 to-orange-700", qualityGrade: "B", daysAgo: 4, likes: 9 },
  { id: "5", gradient: "from-sky-400 to-sky-700", qualityGrade: "A", daysAgo: 5, likes: 27 },
  { id: "6", gradient: "from-emerald-400 to-emerald-700", qualityGrade: "A+", daysAgo: 6, likes: 51 },
  { id: "7", gradient: "from-fuchsia-400 to-fuchsia-700", qualityGrade: "A", daysAgo: 7, likes: 15 },
  { id: "8", gradient: "from-zinc-400 to-zinc-700", qualityGrade: "B", daysAgo: 8, likes: 6 },
];

const QUALITY_BADGE_STYLE: Record<MockMesh["qualityGrade"], string> = {
  "A+": "bg-teal-600 text-white",
  A: "bg-zinc-800 text-white",
  B: "bg-zinc-500 text-white",
};

export function GalleryFeed() {
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
          아래 카드는 실제 서비스 갤러리의 레이아웃 예시입니다. 정식 오픈 후에는 사용자가 생성하고
          공개를 허용한 모델의 실제 썸네일로 교체됩니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {MOCK_MESHES.map((mesh) => (
          <div
            key={mesh.id}
            className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-100"
          >
            <div
              className={`absolute inset-0 bg-gradient-to-br ${mesh.gradient} transition-transform duration-300 group-hover:scale-105`}
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
              className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${QUALITY_BADGE_STYLE[mesh.qualityGrade]}`}
            >
              {mesh.qualityGrade}
            </span>

            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-2.5 py-2 text-white">
              <span className="text-[11px] font-medium">익명 사용자 · {mesh.daysAgo}일 전</span>
              <span className="flex items-center gap-1 text-[11px] font-medium">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3">
                  <path d="M12 21s-6.7-4.35-9.3-8.1C.9 10.1 1.5 6.6 4.4 5A5.4 5.4 0 0 1 12 6.6 5.4 5.4 0 0 1 19.6 5c2.9 1.6 3.5 5.1 1.7 7.9C18.7 16.65 12 21 12 21z" />
                </svg>
                {mesh.likes}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
