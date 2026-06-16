import { AppNav } from "@/components/app-nav";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-stone-50 text-zinc-950">
      <AppNav />
      <main className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">대시보드</h1>
          <p className="mt-2 text-sm text-zinc-600">
            생성된 Photorealistic Human Mesh 상태와 크레딧을 확인합니다.
          </p>
        </div>
        <DashboardClient />
      </main>
    </div>
  );
}
