import type { AIProvider } from "@/lib/ai/interface";
import { HeadReconstructionProvider } from "@/lib/ai/providers/head-reconstruction";
import { HunyuanMultiViewProvider } from "@/lib/ai/providers/hunyuan3d";
import { ReplicateHumanMeshProvider } from "@/lib/ai/providers/replicate";
import { StubHumanMeshProvider } from "@/lib/ai/providers/stub";
import {
  getHeadReconstructionEnv,
  getReplicateEnv,
  getScanReconstructionEnv,
  isHeadReconstructionConfigured,
  isScanReconstructionConfigured,
} from "@/lib/env";

export function getDefaultAIProvider(): AIProvider {
  if (isHeadReconstructionConfigured()) {
    return createHeadReconstructionProvider();
  }

  const { apiToken, modelFamily, modelVersion, hunyuanModelVersion } = getReplicateEnv();

  if (!apiToken) {
    return new StubHumanMeshProvider();
  }

  return modelFamily === "hunyuan3d"
    ? new HunyuanMultiViewProvider(apiToken, hunyuanModelVersion)
    : new ReplicateHumanMeshProvider(apiToken, modelVersion);
}

/** photogrammetry scan worker — head-reconstruction과 동일한 /v1/jobs 계약을 쓴다. */
export function getScanAIProvider(): AIProvider | null {
  if (!isScanReconstructionConfigured()) {
    return null;
  }

  const { apiUrl, apiKey, modelName } = getScanReconstructionEnv();
  return new HeadReconstructionProvider(modelName, apiUrl, apiKey);
}

export function getAIProviderForJob(modelName: string): AIProvider | null {
  if (modelName === "stub-photorealistic-human-mesh") {
    return new StubHumanMeshProvider();
  }

  const scanProvider = getScanAIProvider();

  if (scanProvider && scanProvider.modelName === modelName) {
    return scanProvider;
  }

  const headProvider = createHeadReconstructionProvider();

  if (isHeadReconstructionConfigured() && headProvider.modelName === modelName) {
    return headProvider;
  }

  const { apiToken, modelVersion, hunyuanModelVersion } = getReplicateEnv();

  if (apiToken && modelName === "firtoz/trellis") {
    return new ReplicateHumanMeshProvider(apiToken, modelVersion);
  }

  if (apiToken && modelName === "tencent/hunyuan3d-2mv") {
    return new HunyuanMultiViewProvider(apiToken, hunyuanModelVersion);
  }

  return null;
}

function createHeadReconstructionProvider() {
  const { apiUrl, apiKey, modelName } = getHeadReconstructionEnv();
  return new HeadReconstructionProvider(modelName, apiUrl, apiKey);
}
