import type {
  AIProvider,
  GenerationInput,
  ProviderJobStatus,
} from "@/lib/ai/interface";
import {
  normalizeReplicateStatus,
  replicateApiRequest,
  ReplicateProviderError,
  type ReplicatePredictionStatus,
} from "@/lib/ai/providers/replicate";

type HunyuanPrediction = {
  id?: string;
  status?: ReplicatePredictionStatus;
  // tencent/hunyuan3d-2mv returns a bare GLB URI; tencent/hunyuan3d-2 returns { mesh }.
  output?: string | { mesh?: string } | null;
  error?: string | null;
};

export class HunyuanMultiViewProvider implements AIProvider {
  key = "hunyuan3d" as const;
  modelName = "tencent/hunyuan3d-2mv";

  constructor(
    private readonly apiToken: string,
    private readonly modelVersion: string,
  ) {}

  async supports(input: GenerationInput) {
    return Boolean(input.frontImageUrl) && input.outputFormat === "glb";
  }

  async estimate() {
    return {
      estimatedCost: null,
      estimatedSeconds: 150,
    };
  }

  async createJob(input: GenerationInput) {
    const predictionInput: Record<string, unknown> = {
      front_image: input.frontImageUrl,
      file_type: "glb",
      randomize_seed: true,
      remove_background: true,
      // Default target_face_num=10000 is meant for generic assets; heads need denser
      // geometry to keep facial features readable. Stays far below the 50MB GLB cap.
      target_face_num: 40000,
    };

    // The model exposes orthogonal view slots (left/right), so map each optional photo
    // by its direction. angle45 is assigned first so a true profile (side) photo wins
    // the slot when both were taken from the same direction.
    if (input.angle45ImageUrl) {
      predictionInput[directionSlot(input.angle45Direction)] = input.angle45ImageUrl;
    }

    if (input.sideImageUrl) {
      predictionInput[directionSlot(input.sideDirection)] = input.sideImageUrl;
    }

    const prediction = await replicateApiRequest<HunyuanPrediction>(
      this.apiToken,
      "/predictions",
      {
        method: "POST",
        body: JSON.stringify({
          version: this.modelVersion,
          input: predictionInput,
        }),
      },
    );

    if (!prediction.id) {
      throw new ReplicateProviderError(
        "Replicate did not return a prediction ID.",
        502,
        prediction,
      );
    }

    return {
      providerJobId: prediction.id,
      raw: prediction,
    };
  }

  async getJob(providerJobId: string): Promise<ProviderJobStatus> {
    const prediction = await replicateApiRequest<HunyuanPrediction>(
      this.apiToken,
      `/predictions/${encodeURIComponent(providerJobId)}`,
    );

    return {
      status: normalizeReplicateStatus(prediction.status),
      outputUrl: extractOutputUrl(prediction.output),
      errorCode: prediction.status === "failed" ? "REPLICATE_PREDICTION_FAILED" : undefined,
      errorMessage: prediction.error ?? undefined,
      raw: prediction,
    };
  }

  async cancelJob(providerJobId: string) {
    await replicateApiRequest(
      this.apiToken,
      `/predictions/${encodeURIComponent(providerJobId)}/cancel`,
      { method: "POST" },
    );
  }
}

function directionSlot(direction: GenerationInput["sideDirection"]) {
  return direction === "right" ? "right_image" : "left_image";
}

function extractOutputUrl(output: HunyuanPrediction["output"]) {
  if (typeof output === "string") {
    return output;
  }

  return output?.mesh;
}
