import Link from "next/link";

import { LogoutButton } from "@/components/auth/logout-button";

export function AppNav() {
  return (
    <header className="border-b border-hairline bg-clay-200">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="font-mono text-[13px] font-bold tracking-wider">
          Mesh<span className="text-celadon-600">Selfie</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm font-medium text-ink-dim">
          <Link href="/" className="hover:text-ink">
            홈
          </Link>
          <Link href="/dashboard" className="hover:text-ink">
            대시보드
          </Link>
          <Link href="/upload" className="hover:text-ink">
            업로드
          </Link>
          <Link href="/profile" className="hover:text-ink">
            프로필
          </Link>
          <LogoutButton />
        </nav>
      </div>
    </header>
  );
}
