"use client";

import { createClient } from "@supabase/supabase-js";

import { getPublicSupabaseEnv } from "@/lib/env";

type BrowserSupabaseClient = ReturnType<typeof createClient>;

declare global {
  var meshselfieSupabaseBrowserClient: BrowserSupabaseClient | undefined;
}

export function createBrowserSupabaseClient() {
  if (globalThis.meshselfieSupabaseBrowserClient) {
    return globalThis.meshselfieSupabaseBrowserClient;
  }

  const { supabaseUrl, supabaseAnonKey } = getPublicSupabaseEnv();

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  globalThis.meshselfieSupabaseBrowserClient = createClient(supabaseUrl, supabaseAnonKey);

  return globalThis.meshselfieSupabaseBrowserClient;
}
