"use client";

import { useEffect, useState } from "react";

type Slide = {
  eyebrow: string;
  title: string;
  description: string;
  gradient: string;
};

const SLIDES: Slide[] = [
  {
    eyebrow: "REALISTIC 3D SCAN",
    title: "정면 사진 한 장이면 충분합니다",
    description:
      "얼굴 구조와 비율을 보존한 실사형 3D 헤드 메쉬를 몇 분 안에 생성합니다.",
    gradient: "from-celadon-600 via-celadon-700 to-ink",
  },
  {
    eyebrow: "ANGLE-AWARE QUALITY",
    title: "각도를 더할수록 정교해지는 A+ 등급",
    description:
      "정면 + 측면 + 45도, 세 장을 모두 올리면 가장 높은 품질 등급으로 생성됩니다.",
    gradient: "from-clay-400 via-clay-500 to-ink",
  },
  {
    eyebrow: "NOT A CHARACTER AVATAR",
    title: "캐릭터가 아니라 당신의 얼굴입니다",
    description:
      "VRM이나 만화풍 아바타가 아닌, 실제 촬영·스캔에 가까운 실사형 메쉬를 지향합니다.",
    gradient: "from-kiln-600 via-kiln-700 to-ink",
  },
  {
    eyebrow: "READY-TO-USE GLB",
    title: "다운로드한 GLB, 어디서든 활용하세요",
    description:
      "브라우저 3D 뷰어로 바로 확인하고, 완성된 모델은 GLB 파일로 내려받습니다.",
    gradient: "from-axis-z via-celadon-700 to-ink",
  },
];

const AUTO_ADVANCE_MS = 5000;

export function HeroCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) {
      return;
    }

    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % SLIDES.length);
    }, AUTO_ADVANCE_MS);

    return () => clearInterval(timer);
  }, [paused]);

  const slide = SLIDES[index];

  return (
    <div
      className="relative flex min-h-[360px] flex-col justify-between overflow-hidden rounded-2xl p-8 text-white shadow-lg sm:min-h-[420px] sm:p-10"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br transition-colors duration-700 ${slide.gradient}`}
        aria-hidden
      />
      <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" aria-hidden />
      <div className="absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-white/10 blur-3xl" aria-hidden />
      <svg
        className="pointer-events-none absolute -bottom-8 right-2 h-56 w-56 text-white/10 sm:h-64 sm:w-64"
        viewBox="0 0 200 200"
        fill="none"
        aria-hidden
      >
        <circle cx="100" cy="72" r="42" fill="currentColor" />
        <path
          d="M30 190c0-45 31-82 70-82s70 37 70 82"
          fill="currentColor"
        />
      </svg>

      <div className="relative flex flex-1 flex-col justify-center gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
          {slide.eyebrow}
        </p>
        <h2 className="max-w-md text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
          {slide.title}
        </h2>
        <p className="max-w-sm text-sm leading-6 text-white/80">{slide.description}</p>
      </div>

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2">
          {SLIDES.map((item, itemIndex) => (
            <button
              key={item.title}
              type="button"
              onClick={() => setIndex(itemIndex)}
              aria-label={`${itemIndex + 1}번째 배너로 이동`}
              className={`h-1.5 rounded-full transition-all ${
                itemIndex === index ? "w-6 bg-white" : "w-1.5 bg-white/40 hover:bg-white/60"
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIndex((current) => (current - 1 + SLIDES.length) % SLIDES.length)}
            aria-label="이전 배너"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setIndex((current) => (current + 1) % SLIDES.length)}
            aria-label="다음 배너"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
