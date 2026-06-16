import Link from "next/link";

import { LogoutButton } from "@/components/auth/logout-button";

export function AppNav() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/dashboard" className="text-base font-semibold tracking-tight">
          MeshSelfie
        </Link>
        <nav className="flex items-center gap-4 text-sm font-medium text-zinc-700">
          <Link href="/dashboard" className="hover:text-zinc-950">
            대시보드
          </Link>
          <Link href="/upload" className="hover:text-zinc-950">
            업로드
          </Link>
          <Link href="/profile" className="hover:text-zinc-950">
            프로필
          </Link>
          <LogoutButton />
        </nav>
      </div>
    </header>
  );
}
