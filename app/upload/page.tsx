import { AppNav } from "@/components/app-nav";
import { UploadForm } from "@/components/upload/upload-form";

export default function UploadPage() {
  return (
    <div className="min-h-screen bg-stone-50 text-zinc-950">
      <AppNav />
      <main className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">사진 업로드</h1>
          <p className="mt-2 text-sm text-zinc-600">
            front는 필수이고, side와 angle45는 선택입니다. 업로드 API 구현은 다음 단계입니다.
          </p>
        </div>

        <UploadForm />
      </main>
    </div>
  );
}
