import type { AIProvider } from "@/lib/ai/interface";
import { HeadReconstructionProvider } from "@/lib/ai/providers/head-reconstruction";
import { HunyuanMultiViewProvider } from "@/lib/ai/providers/hunyuan3d";
import { ReplicateHumanMeshProvider } from "@/lib/ai/providers/replicate";
import { StubHumanMeshProvider } from "@/lib/ai/providers/stub";
import {
  getHeadReconstructionEnv,
  getReplicateEnv,
  isHeadReconstructionConfigured,
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

export function getAIProviderForJob(modelName: string): AIProvider | null {
  if (modelName === "stub-photorealistic-human-mesh") {
    return new StubHumanMeshProvider();
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
