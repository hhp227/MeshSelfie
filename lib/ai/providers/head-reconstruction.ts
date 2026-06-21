import type {
  AIProvider,
  GenerationInput,
  ProviderJobStatus,
} from "@/lib/ai/interface";

type WorkerJob = {
  id?: string;
  status?: string;
  output?: {
    glbUrl?: string;
  } | null;
  error?: {
    code?: string;
    message?: string;
  } | null;
};

export class HeadReconstructionProvider implements AIProvider {
  key = "self_hosted" as const;

  constructor(
    readonly modelName: string,
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {}

  async supports(input: GenerationInput) {
    return Boolean(input.frontImageUrl) && input.outputFormat === "glb";
  }

  async estimate() {
    return {
      estimatedCost: null,
      estimatedSeconds: 300,
    };
  }

  async createJob(input: GenerationInput) {
    const images = [
      { role: "front", url: input.frontImageUrl },
      input.sideImageUrl
        ? { role: "side", url: input.sideImageUrl, direction: input.sideDirection }
        : null,
      input.angle45ImageUrl
        ? {
            role: "angle45",
            url: input.angle45ImageUrl,
            direction: input.angle45Direction,
          }
        : null,
    ].filter((image) => image !== null);

    const job = await this.request<WorkerJob>("/v1/jobs", {
      method: "POST",
      body: JSON.stringify({
        clientJobId: input.jobId,
        userId: input.userId,
        model: this.modelName,
        input: {
          images,
          targetRegion: input.targetRegion ?? "head_neck",
          faceDetail: input.faceDetail ?? "high",
          hairDetail: input.hairDetail ?? "low",
          outputFormat: input.outputFormat,
        },
      }),
    });

    if (!job.id) {
      throw new Error("Head reconstruction worker did not return a job ID.");
    }

    return {
      providerJobId: job.id,
      raw: job,
    };
  }

  async getJob(providerJobId: string): Promise<ProviderJobStatus> {
    const job = await this.request<WorkerJob>(`/v1/jobs/${encodeURIComponent(providerJobId)}`);

    return {
      status: normalizeStatus(job.status),
      outputUrl: job.output?.glbUrl,
      errorCode: job.error?.code,
      errorMessage: job.error?.message,
      raw: job,
    };
  }

  async cancelJob(providerJobId: string) {
    await this.request(`/v1/jobs/${encodeURIComponent(providerJobId)}/cancel`, {
      method: "POST",
    });
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json().catch(() => null)) as T | null;

    if (!response.ok) {
      throw new Error(`Head reconstruction worker request failed with status ${response.status}.`);
    }

    return body as T;
  }
}

function normalizeStatus(status: string | undefined): ProviderJobStatus["status"] {
  switch (status) {
    case "succeeded":
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "canceled":
    case "cancelled":
      return "canceled";
    case "queued":
      return "queued";
    default:
      return "generating";
  }
}
