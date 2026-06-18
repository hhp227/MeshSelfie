"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

export async function getAccessTokenWithRetry(
  supabase: SupabaseClient,
  attempts = 8,
  delayMs = 150,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (token) {
      return token;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return null;
}
