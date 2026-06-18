import { AppNav } from "@/components/app-nav";
import { AuthenticatedPage } from "@/components/auth/authenticated-page";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export default function ProfilePage() {
  return (
    <AuthenticatedPage>
      <div className="min-h-screen bg-stone-50 text-zinc-950">
        <AppNav />
        <main className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">프로필</h1>
            <p className="mt-2 text-sm text-zinc-600">
              현재 로그인한 계정과 사용량 정보를 확인합니다.
            </p>
          </div>
          <DashboardClient />
        </main>
      </div>
    </AuthenticatedPage>
  );
}
