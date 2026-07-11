import Link from "next/link";

import { GalleryFeed } from "@/components/landing/gallery-feed";
import { WireframeHead } from "@/components/landing/wireframe-head";

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "사진 업로드",
    description: "정면 사진 1장은 필수, 측면과 45도 사진은 선택으로 추가합니다.",
  },
  {
    step: "02",
    title: "3D 메쉬 생성",
    description: "AI가 얼굴 구조와 비율을 분석해 실사형 Human Mesh(GLB)를 생성합니다.",
  },
  {
    step: "03",
    title: "확인 후 다운로드",
    description: "브라우저 3D 뷰어로 회전·확대해 확인하고 GLB 파일을 내려받습니다.",
  },
];

const QUALITY_TIERS = [
  {
    grade: "B",
    input: "정면 1장",
    detail: "정면 얼굴 구조 중심, 측면 형상은 추정 비중이 높음",
    cams: ["front"] as CameraAngle[],
    best: false,
  },
  {
    grade: "A",
    input: "정면 + 측면 또는 45도",
    detail: "얼굴 깊이와 비율 추정이 개선됨",
    cams: ["front", "angle45"] as CameraAngle[],
    best: false,
  },
  {
    grade: "A+",
    input: "정면 + 측면 + 45도",
    detail: "얼굴 및 머리 형상 보존 정확도가 가장 높음",
    cams: ["front", "angle45", "side"] as CameraAngle[],
    best: true,
  },
];

const FAQ_ITEMS = [
  {
    question: "정면 사진만 있어도 생성할 수 있나요?",
    answer:
      "네, 정면 사진 1장만으로 생성이 가능합니다. 다만 측면·45도 사진을 추가하면 얼굴 깊이와 머리 형상 보존 정확도가 높아져 더 높은 품질 등급으로 계산됩니다.",
  },
  {
    question: "어떤 파일 형식을 지원하나요?",
    answer: "업로드는 JPG·PNG를 지원하고, 생성된 3D 모델은 GLB 파일로 다운로드할 수 있습니다.",
  },
  {
    question: "생성에는 시간이 얼마나 걸리나요?",
    answer: "입력 사진 수와 서버 상황에 따라 다르지만, 일반적으로 몇 분 내로 완료됩니다.",
  },
  {
    question: "캐릭터나 VRM 아바타로도 만들 수 있나요?",
    answer:
      "아니요. MeshSelfie는 캐릭터형 아바타나 VRM이 아니라, 실제 얼굴 구조와 텍스처를 최대한 보존한 실사형 3D 모델을 목표로 합니다.",
  },
];

// human_meshes/generation_jobs 상태와 동일한 순서·표기 (design 요소로 노출)
const PIPELINE_STAGES = [
  { label: "대기 중", state: "done" },
  { label: "검증 중", state: "done" },
  { label: "전처리 중", state: "done" },
  { label: "생성 중", state: "hot" },
  { label: "후처리 중", state: "todo" },
  { label: "마무리 중", state: "todo" },
  { label: "완료", state: "todo" },
] as const;

type CameraAngle = "front" | "angle45" | "side";

// 위에서 내려다본 카메라 배치도 — 정면(+Z)/45도/측면(+X)
function CameraDiagram({ cams }: { cams: CameraAngle[] }) {
  return (
    <svg viewBox="0 0 240 148" aria-hidden className="block w-full">
      <circle cx="120" cy="58" r="30" className="stroke-clay-400" fill="none" strokeWidth="1.4" />
      <path
        d="M120,28 A30,30 0 0 1 120,88"
        className="stroke-clay-400"
        fill="none"
        strokeWidth="0.7"
        opacity="0.5"
      />
      <path
        d="M64,112 A72,72 0 0 1 176,112"
        stroke="rgba(43,33,25,0.18)"
        fill="none"
        strokeDasharray="3 6"
      />
      {cams.includes("front") ? (
        <g>
          <rect x="110" y="112" width="20" height="13" rx="2" className="fill-axis-z" />
          <path d="M120,112 L112,102 h16 Z" className="fill-axis-z" opacity="0.5" />
          <text
            x="120"
            y="140"
            textAnchor="middle"
            className="fill-ink-dim font-mono"
            fontSize="9.5"
          >
            정면
          </text>
        </g>
      ) : null}
      {cams.includes("angle45") ? (
        <g>
          <rect
            x="162"
            y="86"
            width="20"
            height="13"
            rx="2"
            className="fill-axis-45"
            transform="rotate(-45 172 92)"
          />
          <text x="200" y="88" textAnchor="middle" className="fill-ink-dim font-mono" fontSize="9.5">
            45°
          </text>
        </g>
      ) : null}
      {cams.includes("side") ? (
        <g>
          <rect
            x="186"
            y="50"
            width="20"
            height="13"
            rx="2"
            className="fill-axis-x"
            transform="rotate(-90 196 56)"
          />
          <text x="216" y="44" textAnchor="middle" className="fill-ink-dim font-mono" fontSize="9.5">
            측면
          </text>
        </g>
      ) : null}
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-clay-100 text-ink">
      {/* 메뉴바 */}
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-hairline bg-clay-200 px-5 py-2.5">
        <Link href="/" className="font-mono text-[13px] font-bold tracking-wider">
          Mesh<span className="text-celadon-600">Selfie</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link href="/login" className="text-ink-dim hover:text-ink">
            로그인
          </Link>
          <Link
            href="/signup"
            className="flex h-9 items-center justify-center rounded-md bg-celadon-600 px-4 text-[13px] font-semibold text-clay-50 hover:bg-celadon-700"
          >
            시작하기
          </Link>
        </nav>
      </header>

      {/* 뷰포트 히어로 */}
      <section className="relative flex flex-col overflow-hidden border-b border-hairline bg-clay-50">
        <div className="vp-floor" aria-hidden />

        {/* HUD — 좌상단 스펙 */}
        <div
          className="absolute left-5 top-4 hidden font-mono text-[11.5px] leading-[1.9] tracking-wide text-ink-dim lg:block"
          aria-hidden
        >
          <div>
            <span className="inline-block w-16 opacity-60">Verts</span> 5,023
          </div>
          <div>
            <span className="inline-block w-16 opacity-60">Faces</span> 9,976
          </div>
          <div>
            <span className="inline-block w-16 opacity-60">Format</span> GLB v2 · ≤50MB
          </div>
        </div>

        {/* 축 기즈모 — 우상단 */}
        <svg
          className="absolute right-5 top-4 hidden lg:block"
          width="84"
          height="84"
          viewBox="0 0 84 84"
          aria-hidden
        >
          <line x1="42" y1="42" x2="72" y2="52" className="stroke-axis-x" strokeWidth="2" />
          <circle cx="74" cy="53" r="7" className="fill-axis-x" />
          <text x="71" y="56" fontSize="9" className="fill-clay-50 font-mono">
            X
          </text>
          <line x1="42" y1="42" x2="42" y2="10" className="stroke-axis-y" strokeWidth="2" />
          <circle cx="42" cy="9" r="7" className="fill-axis-y" />
          <text x="39" y="12" fontSize="9" className="fill-clay-50 font-mono">
            Y
          </text>
          <line x1="42" y1="42" x2="14" y2="56" className="stroke-axis-z" strokeWidth="2" />
          <circle cx="12" cy="57" r="7" className="fill-axis-z" />
          <text x="9" y="60" fontSize="9" className="fill-clay-50 font-mono">
            Z
          </text>
          <circle cx="42" cy="42" r="3" fill="rgba(43,33,25,0.5)" />
        </svg>

        <div className="relative mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-6 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
          <div className="flex max-w-2xl flex-col gap-7">
            <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-celadon-600">
              Photorealistic Human Mesh
            </p>
            <h1 className="break-keep text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-6xl">
              셀카 한 장에서 시작하는 실사형 3D 얼굴 메쉬 생성
            </h1>
            <p className="max-w-xl text-lg leading-8 text-ink-dim">
              MeshSelfie는 캐릭터 아바타가 아니라 실제 얼굴 구조, 비율, 텍스처를 최대한
              보존하는 GLB 기반 3D Reconstruction 서비스를 목표로 합니다.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="flex h-12 items-center justify-center rounded-md bg-celadon-600 px-6 text-sm font-semibold text-clay-50 hover:bg-celadon-700"
              >
                무료로 시작
              </Link>
              <Link
                href="/"
                className="flex h-12 items-center justify-center rounded-md border border-hairline-strong px-6 text-sm font-semibold text-ink hover:bg-clay-100"
              >
                서비스 홈으로
              </Link>
            </div>
          </div>

          <figure aria-label="와이어프레임 두상" className="relative">
            <WireframeHead className="mx-auto block h-auto w-full max-w-[300px] lg:max-w-[440px]" />
          </figure>
        </div>

        {/* 상태바 — 실제 생성 파이프라인 단계 */}
        <div
          className="relative flex items-stretch overflow-x-auto border-t border-hairline bg-clay-200 font-mono text-[11px]"
          role="list"
          aria-label="생성 파이프라인 단계"
        >
          {PIPELINE_STAGES.map((stage) => (
            <div
              key={stage.label}
              role="listitem"
              className={`flex items-center gap-2 whitespace-nowrap border-r border-hairline px-4 py-2 ${
                stage.state === "hot"
                  ? "text-kiln-600"
                  : stage.state === "done"
                    ? "text-ink"
                    : "text-ink-dim"
              }`}
            >
              <span
                className={`h-[7px] w-[7px] rounded-full ${
                  stage.state === "hot"
                    ? "stage-blink bg-kiln-600"
                    : stage.state === "done"
                      ? "bg-axis-y"
                      : "bg-hairline-strong"
                }`}
              />
              {stage.label}
            </div>
          ))}
          <div className="flex flex-1 items-center justify-end px-4 text-ink-dim" aria-hidden>
            pipeline
          </div>
        </div>
      </section>

      <main className="mx-auto w-full max-w-6xl px-6">
        {/* How it works — 아웃라이너 */}
        <section className="border-b border-hairline py-16">
          <div className="mb-10 flex flex-col gap-2">
            <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-celadon-600">
              How it works
            </p>
            <h2 className="break-keep text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              3단계면 충분합니다
            </h2>
          </div>
          <div className="overflow-hidden rounded-md border border-hairline">
            {HOW_IT_WORKS.map((item, index) => (
              <div
                key={item.step}
                className={`grid gap-2 bg-clay-50 p-6 hover:bg-clay-200 sm:grid-cols-[64px_200px_1fr] sm:gap-4 ${
                  index > 0 ? "border-t border-hairline" : ""
                }`}
              >
                <span className="font-mono text-sm text-ink-dim">{item.step}</span>
                <span className="text-[17px] font-bold text-ink">{item.title}</span>
                <span className="text-sm leading-6 text-ink-dim">{item.description}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 품질 등급 — 카메라 배치도 */}
        <section className="border-b border-hairline py-16">
          <div className="mb-6 flex flex-col gap-2">
            <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-celadon-600">
              Quality Grade
            </p>
            <h2 className="break-keep text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              사진을 더할수록 정교해지는 품질 등급
            </h2>
          </div>
          <div
            className="mb-7 flex flex-wrap gap-5 font-mono text-[11.5px] text-ink-dim"
            aria-hidden
          >
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-axis-z" />
              정면 +Z
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-axis-45" />
              45°
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-axis-x" />
              측면 +X
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {QUALITY_TIERS.map((tier) => (
              <div
                key={tier.grade}
                className={`rounded-md border bg-clay-50 p-6 ${
                  tier.best ? "border-kiln-600" : "border-hairline"
                }`}
              >
                <p
                  className={`font-mono text-3xl font-bold ${
                    tier.best ? "text-kiln-600" : "text-ink"
                  }`}
                >
                  {tier.grade}
                </p>
                <p className="mb-4 mt-1 text-sm font-semibold text-ink-dim">{tier.input}</p>
                <CameraDiagram cams={tier.cams} />
                <p className="mt-4 text-sm leading-6 text-ink-dim">{tier.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-b border-hairline py-16">
          <GalleryFeed />
        </section>

        {/* FAQ — 패널 */}
        <section className="border-b border-hairline py-16">
          <div className="mb-10 flex flex-col gap-2">
            <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-celadon-600">
              FAQ
            </p>
            <h2 className="break-keep text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              자주 묻는 질문
            </h2>
          </div>
          <div className="flex flex-col gap-2.5">
            {FAQ_ITEMS.map((item) => (
              <details
                key={item.question}
                className="group rounded-md border border-hairline bg-clay-50"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between p-5 text-[15px] font-semibold text-ink">
                  {item.question}
                  <span className="ml-4 font-mono text-celadon-600 transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="max-w-3xl px-5 pb-5 text-sm leading-6 text-ink-dim">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="flex flex-col items-center gap-4 py-24 text-center">
          <h2 className="break-keep text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            지금 바로 나만의 3D 헤드 메쉬를 만들어보세요
          </h2>
          <p className="max-w-xl text-sm leading-6 text-ink-dim">
            가입 후 정면 사진 한 장만 올리면 바로 시작할 수 있습니다.
          </p>
          <Link
            href="/signup"
            className="mt-2 flex h-[52px] items-center justify-center rounded-md bg-celadon-600 px-9 text-[15px] font-semibold text-clay-50 hover:bg-celadon-700"
          >
            무료로 시작
          </Link>
        </section>
      </main>

      {/* 풋바 */}
      <footer className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-hairline bg-clay-200 px-5 py-3 font-mono text-[11px] text-ink-dim">
        <span>&copy; {new Date().getFullYear()} MeshSelfie</span>
        <span>
          두상 재구성에 FLAME 모델(MPI-IS,{" "}
          <a
            href="https://flame.is.tue.mpg.de"
            target="_blank"
            rel="noreferrer"
            className="text-ink underline hover:text-celadon-600"
          >
            CC-BY-4.0
          </a>
          )을 사용합니다.
        </span>
        <span className="flex-1" />
        <Link href="/login" className="hover:text-ink">
          로그인
        </Link>
        <Link href="/signup" className="hover:text-ink">
          회원가입
        </Link>
      </footer>
    </div>
  );
}
