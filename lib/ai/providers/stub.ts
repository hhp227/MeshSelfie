import type { AIProvider, GenerationInput } from "@/lib/ai/interface";

export class StubHumanMeshProvider implements AIProvider {
  key = "replicate" as const;
  modelName = "stub-photorealistic-human-mesh";

  async supports() {
    return true;
  }

  async estimate() {
    return {
      estimatedCost: null,
      estimatedSeconds: 180,
    };
  }

  async createJob(input: GenerationInput) {
    return {
      providerJobId: `stub_${input.jobId}`,
      raw: {
        provider: this.key,
        modelName: this.modelName,
        mode: "development_stub",
      },
    };
  }

  async getJob(providerJobId: string) {
    return {
      status: "generating" as const,
      raw: {
        id: providerJobId,
        mode: "development_stub",
      },
    };
  }

  async cancelJob() {}
}
