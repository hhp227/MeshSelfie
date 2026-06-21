export function getPublicSupabaseEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  };
}

export function isSupabasePublicConfigured() {
  const { supabaseUrl, supabaseAnonKey } = getPublicSupabaseEnv();
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getSupabaseAdminEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
}

export function isSupabaseAdminConfigured() {
  const { supabaseUrl, supabaseServiceRoleKey } = getSupabaseAdminEnv();
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

export function getReplicateEnv() {
  return {
    apiToken: process.env.REPLICATE_API_TOKEN ?? "",
    modelVersion:
      process.env.REPLICATE_MODEL_VERSION ??
      "e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c",
  };
}

export function getHeadReconstructionEnv() {
  return {
    apiUrl: (process.env.HEAD_RECONSTRUCTION_API_URL ?? "").replace(/\/$/, ""),
    apiKey: process.env.HEAD_RECONSTRUCTION_API_KEY ?? "",
    modelName: process.env.HEAD_RECONSTRUCTION_MODEL_NAME ?? "hybrid-flame-head-v1",
    outputHosts: (process.env.HEAD_RECONSTRUCTION_OUTPUT_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function isHeadReconstructionConfigured() {
  const { apiUrl, apiKey } = getHeadReconstructionEnv();
  return Boolean(apiUrl && apiKey);
}
