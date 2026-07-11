"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function LogoutButton() {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  async function handleLogout() {
    await supabase?.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="rounded-md border border-hairline-strong px-3 py-2 text-sm font-medium text-ink-dim hover:bg-clay-100 hover:text-ink"
    >
      로그아웃
    </button>
  );
}
