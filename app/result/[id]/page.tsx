import { AppNav } from "@/components/app-nav";
import { ResultClient } from "@/components/result/result-client";

export default async function ResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-950">
      <AppNav />
      <main className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">3D 모델 결과</h1>
          <p className="mt-2 text-sm text-zinc-600">모델 ID: {id}</p>
        </div>
        <ResultClient meshId={id} />
      </main>
    </div>
  );
}
