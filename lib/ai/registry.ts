import type { AIProvider } from "@/lib/ai/interface";
import { StubHumanMeshProvider } from "@/lib/ai/providers/stub";

const providers: AIProvider[] = [new StubHumanMeshProvider()];

export function getDefaultAIProvider() {
  return providers[0];
}
