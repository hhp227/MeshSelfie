import type { ImageDirection, QualityGrade } from "@/lib/uploads";

export type ProviderKey = "replicate" | "trellis" | "hunyuan3d" | "triposr" | "self_hosted";

export type GenerationInput = {
  jobId: string;
  userId: string;
  frontImageUrl: string;
  sideImageUrl?: string;
  sideDirection?: ImageDirection;
  angle45ImageUrl?: string;
  angle45Direction?: ImageDirection;
  qualityGrade: QualityGrade;
  targetRegion?: "head_neck";
  faceDetail?: "high";
  hairDetail?: "low";
  outputFormat: "glb";
};

export type ProviderJobResult = {
  providerJobId: string;
  raw: unknown;
};

export type ProviderJobStatus = {
  status: "queued" | "generating" | "completed" | "failed" | "canceled";
  outputUrl?: string;
  errorCode?: string;
  errorMessage?: string;
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
  getJob(providerJobId: string): Promise<ProviderJobStatus>;
  cancelJob(providerJobId: string): Promise<void>;
}
