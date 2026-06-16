import Link from "next/link";

export default function Home() {
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

        <section className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.05fr_0.95fr]">
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
                href="/dashboard"
                className="flex h-12 items-center justify-center rounded-md border border-zinc-300 px-5 text-sm font-semibold text-zinc-800 hover:bg-white"
              >
                대시보드 보기
              </Link>
            </div>
          </div>

          <div className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            {[
              ["입력", "front 필수, side 및 45도 사진 선택 업로드"],
              ["검증", "얼굴 존재, 흐림, 가림, 다중 인물 자동 검사"],
              ["생성", "AI Provider 추상화 기반 비동기 GLB 생성"],
              ["결과", "3D Viewer, 썸네일, 다운로드, 관리자 교체 지원"],
            ].map(([title, description]) => (
              <div key={title} className="rounded-md border border-zinc-200 p-4">
                <p className="text-sm font-semibold text-zinc-950">{title}</p>
                <p className="mt-1 text-sm leading-6 text-zinc-600">{description}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
