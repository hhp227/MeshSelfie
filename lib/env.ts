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

export type ReplicateModelFamily = "trellis" | "hunyuan3d";

export function getReplicateEnv() {
  const rawFamily = (process.env.REPLICATE_MODEL_FAMILY ?? "trellis").trim().toLowerCase();

  return {
    apiToken: process.env.REPLICATE_API_TOKEN ?? "",
    modelFamily: (rawFamily === "hunyuan3d" ? "hunyuan3d" : "trellis") as ReplicateModelFamily,
    modelVersion:
      process.env.REPLICATE_MODEL_VERSION ??
      "e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c",
    hunyuanModelVersion:
      process.env.HUNYUAN3D_MODEL_VERSION ??
      "71798fbc3c9f7b7097e3bb85496e5a797d8b8f616b550692e7c3e176a8e9e5db",
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

/** PRD v2.0 photogrammetry scan worker (Modal GPU, 별도 배포). */
export function getScanReconstructionEnv() {
  return {
    apiUrl: (process.env.SCAN_RECONSTRUCTION_API_URL ?? "").replace(/\/$/, ""),
    apiKey: process.env.SCAN_RECONSTRUCTION_API_KEY ?? "",
    modelName:
      process.env.SCAN_RECONSTRUCTION_MODEL_NAME ?? "photogrammetry-colmap-v1",
  };
}

export function isScanReconstructionConfigured() {
  const { apiUrl, apiKey } = getScanReconstructionEnv();
  return Boolean(apiUrl && apiKey);
}
