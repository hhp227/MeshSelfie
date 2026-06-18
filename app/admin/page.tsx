import { AppNav } from "@/components/app-nav";
import { AuthenticatedPage } from "@/components/auth/authenticated-page";

export default function AdminPage() {
  return (
    <AuthenticatedPage>
      <div className="min-h-screen bg-stone-50 text-zinc-950">
        <AppNav />
        <main className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Admin Dashboard</h1>
            <p className="mt-2 text-sm text-zinc-600">
              사용자 검색, 생성 현황, Provider 통계, 모델 교체/삭제 기능을 구현할 영역입니다.
            </p>
          </div>
          <section className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
            관리자 API와 권한 검사는 다음 구현 단계에서 연결합니다.
          </section>
        </main>
      </div>
    </AuthenticatedPage>
  );
}
