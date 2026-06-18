"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { getAccessTokenWithRetry } from "@/lib/supabase/session";

export function AuthenticatedPage({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [ready, setReady] = useState(false);
  const [configError, setConfigError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function verifySession() {
      if (!supabase) {
        setConfigError(true);
        return;
      }

      const token = await getAccessTokenWithRetry(supabase);

      if (cancelled) {
        return;
      }

      if (!token) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }

      setReady(true);
    }

    void verifySession();

    return () => {
      cancelled = true;
    };
  }, [pathname, router, supabase]);

  if (configError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6 text-sm text-red-700">
        Supabase 환경 변수가 설정되지 않았습니다.
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6 text-sm text-zinc-600">
        세션을 확인하는 중입니다.
      </main>
    );
  }

  return children;
}
