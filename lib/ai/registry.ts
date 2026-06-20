import type { AIProvider } from "@/lib/ai/interface";
import { ReplicateHumanMeshProvider } from "@/lib/ai/providers/replicate";
import { StubHumanMeshProvider } from "@/lib/ai/providers/stub";
import { getReplicateEnv } from "@/lib/env";

export function getDefaultAIProvider(): AIProvider {
  const { apiToken, modelVersion } = getReplicateEnv();
  return apiToken
    ? new ReplicateHumanMeshProvider(apiToken, modelVersion)
    : new StubHumanMeshProvider();
}

export function getAIProviderForJob(modelName: string): AIProvider | null {
  if (modelName === "stub-photorealistic-human-mesh") {
    return new StubHumanMeshProvider();
  }

  const provider = getDefaultAIProvider();
  return provider.modelName === modelName ? provider : null;
}
