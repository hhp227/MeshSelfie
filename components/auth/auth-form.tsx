"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type AuthMode = "login" | "signup";

function getAuthErrorMessage(message: string) {
  if (message.toLowerCase().includes("email not confirmed")) {
    return "이메일 인증이 완료되지 않았습니다. 메일함에서 인증 링크를 클릭하거나, 개발 중이라면 Supabase Auth 설정에서 이메일 인증을 비활성화하세요.";
  }

  if (message.toLowerCase().includes("invalid login credentials")) {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }

  return message;
}

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!supabase) {
      setError("Supabase 환경 변수가 설정되지 않았습니다.");
      return;
    }

    setPending(true);

    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (result.error) {
      setPending(false);
      setError(getAuthErrorMessage(result.error.message));
      return;
    }

    if (!result.data.session) {
      setPending(false);
      setError(
        mode === "signup"
          ? "회원가입은 완료됐지만 이메일 인증이 필요합니다. 메일함을 확인해주세요."
          : "로그인은 처리됐지만 세션이 생성되지 않았습니다. 이메일 인증 상태를 확인해주세요.",
      );
      return;
    }

    await supabase.auth.setSession({
      access_token: result.data.session.access_token,
      refresh_token: result.data.session.refresh_token,
    });

    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-2 text-sm font-medium text-zinc-800">
        이메일
        <input
          className="h-11 rounded-md border border-zinc-300 px-3 text-base outline-none focus:border-zinc-900"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium text-zinc-800">
        비밀번호
        <input
          className="h-11 rounded-md border border-zinc-300 px-3 text-base outline-none focus:border-zinc-900"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={6}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
      </label>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        {pending ? "처리 중..." : mode === "login" ? "로그인" : "회원가입"}
      </button>
    </form>
  );
}
