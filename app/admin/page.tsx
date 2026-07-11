import { AppNav } from "@/components/app-nav";
import { AdminModelUploadForm } from "@/components/admin/model-upload-form";
import { AuthenticatedPage } from "@/components/auth/authenticated-page";

export default function AdminPage() {
  return (
    <AuthenticatedPage>
      <div className="min-h-screen bg-clay-100 text-ink">
        <AppNav />
        <main className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
            <p className="mt-2 text-sm text-ink-dim">
              GLB/GLTF 샘플을 등록하거나 기존 사용자 Human Mesh를 관리자 모델로 교체합니다.
            </p>
          </div>
          <section className="rounded-md border border-hairline bg-clay-50 p-6">
            <h2 className="text-lg font-bold text-ink">3D 모델 업로드</h2>
            <p className="mt-2 text-sm text-ink-dim">
              파일 검증, private Storage 저장, 사용자 모델 갱신 및 감사 로그 기록을 수행합니다.
            </p>
            <div className="mt-6">
              <AdminModelUploadForm />
            </div>
          </section>
        </main>
      </div>
    </AuthenticatedPage>
  );
}
