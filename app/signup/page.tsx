import Link from "next/link";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/auth-form";

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-clay-100 px-6 text-ink">
      <section className="w-full max-w-sm rounded-md border border-hairline bg-clay-50 p-8">
        <h1 className="text-2xl font-bold text-ink">회원가입</h1>
        <p className="mt-2 text-sm text-ink-dim">
          정면, 측면, 45도 사진으로 Photorealistic Human Mesh를 생성합니다.
        </p>
        <div className="mt-8">
          <Suspense fallback={null}>
            <AuthForm mode="signup" />
          </Suspense>
        </div>
        <p className="mt-6 text-sm text-ink-dim">
          이미 계정이 있나요?{" "}
          <Link className="font-medium text-celadon-600 underline hover:text-celadon-700" href="/login">
            로그인
          </Link>
        </p>
      </section>
    </main>
  );
}
