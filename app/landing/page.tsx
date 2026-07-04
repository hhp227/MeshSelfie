import Link from "next/link";

import { GalleryFeed } from "@/components/landing/gallery-feed";
import { HeroCarousel } from "@/components/landing/hero-carousel";

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "사진 업로드",
    description: "정면 사진 1장은 필수, 측면과 45도 사진은 선택으로 추가합니다.",
  },
  {
    step: "2",
    title: "3D 메쉬 생성",
    description: "AI가 얼굴 구조와 비율을 분석해 실사형 Human Mesh(GLB)를 생성합니다.",
  },
  {
    step: "3",
    title: "확인 후 다운로드",
    description: "브라우저 3D 뷰어로 회전·확대해 확인하고 GLB 파일을 내려받습니다.",
  },
];

const QUALITY_TIERS = [
  { grade: "B", input: "정면 1장", detail: "정면 얼굴 구조 중심, 측면 형상은 추정 비중이 높음" },
  { grade: "A", input: "정면 + 측면 또는 45도", detail: "얼굴 깊이와 비율 추정이 개선됨" },
  { grade: "A+", input: "정면 + 측면 + 45도", detail: "얼굴 및 머리 형상 보존 정확도가 가장 높음" },
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

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-stone-50 text-zinc-950">
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
        <nav className="flex items-center justify-between border-b border-zinc-200 pb-5">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            MeshSelfie
          </Link>
          <div className="flex items-center gap-3 text-sm font-medium">
            <Link href="/login" className="text-zinc-700 hover:text-zinc-950">
              로그인
            </Link>
            <Link
              href="/signup"
              className="rounded-md bg-zinc-950 px-4 py-2 text-white hover:bg-zinc-800"
            >
              시작하기
            </Link>
          </div>
        </nav>

        <section className="grid items-center gap-10 py-14 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="flex max-w-2xl flex-col gap-7">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">
              Photorealistic Human Mesh
            </p>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-zinc-950 sm:text-6xl">
              셀카 한 장에서 시작하는 실사형 3D 얼굴 메쉬 생성
            </h1>
            <p className="max-w-xl text-lg leading-8 text-zinc-600">
              MeshSelfie는 캐릭터 아바타가 아니라 실제 얼굴 구조, 비율, 텍스처를 최대한
              보존하는 GLB 기반 3D Reconstruction 서비스를 목표로 합니다.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="flex h-12 items-center justify-center rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                무료로 시작
              </Link>
              <Link
                href="/"
                className="flex h-12 items-center justify-center rounded-md border border-zinc-300 px-5 text-sm font-semibold text-zinc-800 hover:bg-white"
              >
                서비스 홈으로
              </Link>
            </div>
          </div>

          <HeroCarousel />
        </section>

        <section className="flex flex-col gap-6 border-t border-zinc-200 py-14">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">
              How it works
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">
              3단계면 충분합니다
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step} className="rounded-lg border border-zinc-200 bg-white p-5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-950 text-sm font-semibold text-white">
                  {item.step}
                </span>
                <p className="mt-4 text-base font-semibold text-zinc-950">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-zinc-600">{item.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-zinc-200 py-14">
          <GalleryFeed />
        </section>

        <section className="flex flex-col gap-6 border-t border-zinc-200 py-14">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">
              Quality Grade
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">
              사진을 더할수록 정교해지는 품질 등급
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {QUALITY_TIERS.map((tier) => (
              <div key={tier.grade} className="rounded-lg border border-zinc-200 bg-white p-5">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-950 text-sm font-bold text-white">
                    {tier.grade}
                  </span>
                  <p className="text-sm font-semibold text-zinc-950">{tier.input}</p>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-600">{tier.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-6 border-t border-zinc-200 py-14">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">FAQ</p>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">
              자주 묻는 질문
            </h2>
          </div>
          <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
            {FAQ_ITEMS.map((item) => (
              <details key={item.question} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-zinc-950">
                  {item.question}
                  <span className="ml-4 text-zinc-400 transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-6 text-zinc-600">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 bg-white px-6 py-14 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">
            지금 바로 나만의 3D 헤드 메쉬를 만들어보세요
          </h2>
          <p className="max-w-xl text-sm leading-6 text-zinc-600">
            가입 후 정면 사진 한 장만 올리면 바로 시작할 수 있습니다.
          </p>
          <Link
            href="/signup"
            className="flex h-12 items-center justify-center rounded-md bg-zinc-950 px-6 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            무료로 시작
          </Link>
        </section>

        <footer className="flex flex-col gap-2 border-t border-zinc-200 py-8 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <p>&copy; {new Date().getFullYear()} MeshSelfie</p>
            <p className="text-xs text-zinc-400">
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
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hover:text-zinc-700">
              로그인
            </Link>
            <Link href="/signup" className="hover:text-zinc-700">
              회원가입
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
