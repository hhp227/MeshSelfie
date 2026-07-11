import Link from "next/link";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/auth-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-clay-100 px-6 text-ink">
      <section className="w-full max-w-sm rounded-md border border-hairline bg-clay-50 p-8">
        <h1 className="text-2xl font-bold text-ink">로그인</h1>
        <p className="mt-2 text-sm text-ink-dim">
          MeshSelfie 계정으로 실사형 Human Mesh 생성을 시작하세요.
        </p>
        <div className="mt-8">
          <Suspense fallback={null}>
            <AuthForm mode="login" />
          </Suspense>
        </div>
        <p className="mt-6 text-sm text-ink-dim">
          계정이 없나요?{" "}
          <Link className="font-medium text-celadon-600 underline hover:text-celadon-700" href="/signup">
            회원가입
          </Link>
        </p>
      </section>
    </main>
  );
}
