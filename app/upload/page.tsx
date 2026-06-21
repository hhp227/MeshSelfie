import { AppNav } from "@/components/app-nav";
import { AuthenticatedPage } from "@/components/auth/authenticated-page";
import { UploadForm } from "@/components/upload/upload-form";

export default function UploadPage() {
  return (
    <AuthenticatedPage>
      <div className="min-h-screen bg-stone-50 text-zinc-950">
        <AppNav />
        <main className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">사진 업로드</h1>
            <p className="mt-2 text-sm text-zinc-600">
              정면은 필수입니다. 45도와 측면 사진을 추가하면 얼굴·두상 복원 정확도가
              높아집니다.
            </p>
          </div>

          <UploadForm />
        </main>
      </div>
    </AuthenticatedPage>
  );
}
