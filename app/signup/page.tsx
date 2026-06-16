import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <section className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-zinc-950">회원가입</h1>
        <p className="mt-2 text-sm text-zinc-600">
          정면, 측면, 45도 사진으로 Photorealistic Human Mesh를 생성합니다.
        </p>
        <div className="mt-8">
          <AuthForm mode="signup" />
        </div>
        <p className="mt-6 text-sm text-zinc-600">
          이미 계정이 있나요?{" "}
          <Link className="font-medium text-zinc-950 underline" href="/login">
            로그인
          </Link>
        </p>
      </section>
    </main>
  );
}
