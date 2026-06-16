import type { ImageDirection, QualityGrade } from "@/lib/uploads";

export type ProviderKey = "replicate" | "trellis" | "hunyuan3d" | "triposr" | "self_hosted";

export type GenerationInput = {
  jobId: string;
  userId: string;
  frontImagePath: string;
  sideImagePath?: string;
  sideDirection?: ImageDirection;
  angle45ImagePath?: string;
  angle45Direction?: ImageDirection;
  qualityGrade: QualityGrade;
  outputFormat: "glb";
};

export type ProviderJobResult = {
  providerJobId: string;
  raw: unknown;
};

export interface AIProvider {
  key: ProviderKey;
  modelName: string;
  supports(input: GenerationInput): Promise<boolean>;
  estimate(input: GenerationInput): Promise<{
    estimatedCost: number | null;
    estimatedSeconds: number | null;
  }>;
  createJob(input: GenerationInput): Promise<ProviderJobResult>;
}
