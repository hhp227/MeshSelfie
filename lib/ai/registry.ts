import type { AIProvider } from "@/lib/ai/interface";
import { HeadReconstructionProvider } from "@/lib/ai/providers/head-reconstruction";
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

  const { apiToken, modelVersion } = getReplicateEnv();
  return apiToken
    ? new ReplicateHumanMeshProvider(apiToken, modelVersion)
    : new StubHumanMeshProvider();
}

export function getAIProviderForJob(modelName: string): AIProvider | null {
  if (modelName === "stub-photorealistic-human-mesh") {
    return new StubHumanMeshProvider();
  }

  const headProvider = createHeadReconstructionProvider();

  if (isHeadReconstructionConfigured() && headProvider.modelName === modelName) {
    return headProvider;
  }

  const { apiToken, modelVersion } = getReplicateEnv();

  if (apiToken && modelName === "firtoz/trellis") {
    return new ReplicateHumanMeshProvider(apiToken, modelVersion);
  }

  return null;
}

function createHeadReconstructionProvider() {
  const { apiUrl, apiKey, modelName } = getHeadReconstructionEnv();
  return new HeadReconstructionProvider(modelName, apiUrl, apiKey);
}
