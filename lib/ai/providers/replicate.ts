import type {
  AIProvider,
  GenerationInput,
  ProviderJobStatus,
} from "@/lib/ai/interface";

const REPLICATE_API_URL = "https://api.replicate.com/v1";

export type ReplicatePredictionStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

type ReplicatePrediction = {
  id?: string;
  status?: ReplicatePredictionStatus;
  output?: {
    model_file?: string;
  } | null;
  error?: string | null;
};

export class ReplicateProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ReplicateProviderError";
  }
}

export async function replicateApiRequest<T = unknown>(
  apiToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${REPLICATE_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });

  const body = (await response.json().catch(() => null)) as T | null;

  if (!response.ok) {
    throw new ReplicateProviderError(
      `Replicate API request failed with status ${response.status}.`,
      response.status,
      body,
    );
  }

  return body as T;
}

export function normalizeReplicateStatus(
  status: ReplicatePrediction["status"],
): ProviderJobStatus["status"] {
  switch (status) {
    case "starting":
      return "queued";
    case "processing":
      return "generating";
    case "succeeded":
      return "completed";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      return "queued";
  }
}

export class ReplicateHumanMeshProvider implements AIProvider {
  key = "replicate" as const;
  modelName = "firtoz/trellis";

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
      estimatedSeconds: 180,
    };
  }

  async createJob(input: GenerationInput) {
    const images = [
      input.frontImageUrl,
      input.sideImageUrl,
      input.angle45ImageUrl,
    ].filter((url): url is string => Boolean(url));

    const prediction = await this.request<ReplicatePrediction>("/predictions", {
      method: "POST",
      body: JSON.stringify({
        version: this.modelVersion,
        input: {
          images,
          generate_model: true,
          generate_color: true,
          randomize_seed: true,
          // TRELLIS defaults (mesh_simplify=0.95, texture_size=1024, 12 sampling steps) are
          // tuned for generic 3D assets and discard most facial/hair detail. These values trade
          // longer generation time and larger GLBs (still well under the 50MB cap) for more
          // retained geometry and texture resolution; they do not fix TRELLIS's lack of true
          // face-identity fitting — see docs/hybrid-head-reconstruction.md for the actual fix.
          texture_size: 2048,
          mesh_simplify: 0.8,
          ss_sampling_steps: 25,
          slat_sampling_steps: 25,
        },
      }),
    });

    if (!prediction.id) {
      throw new ReplicateProviderError("Replicate did not return a prediction ID.", 502, prediction);
    }

    return {
      providerJobId: prediction.id,
      raw: prediction,
    };
  }

  async getJob(providerJobId: string): Promise<ProviderJobStatus> {
    const prediction = await this.request<ReplicatePrediction>(
      `/predictions/${encodeURIComponent(providerJobId)}`,
    );

    return {
      status: normalizeReplicateStatus(prediction.status),
      outputUrl: prediction.output?.model_file,
      errorCode: prediction.status === "failed" ? "REPLICATE_PREDICTION_FAILED" : undefined,
      errorMessage: prediction.error ?? undefined,
      raw: prediction,
    };
  }

  async cancelJob(providerJobId: string) {
    await this.request(`/predictions/${encodeURIComponent(providerJobId)}/cancel`, {
      method: "POST",
    });
  }

  private request<T = unknown>(path: string, init: RequestInit = {}) {
    return replicateApiRequest<T>(this.apiToken, path, init);
  }
}
