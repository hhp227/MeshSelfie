const MAX_ADMIN_MODEL_BYTES = 100 * 1024 * 1024;

export const ADMIN_UPLOAD_PURPOSES = [
  "replace_failed",
  "external_tool",
  "test_data",
  "sample",
  "quality_replacement",
] as const;

export type AdminUploadPurpose = (typeof ADMIN_UPLOAD_PURPOSES)[number];

export type ValidatedAdminModel = {
  bytes: Uint8Array;
  extension: "glb" | "gltf";
  contentType: "model/gltf-binary" | "model/gltf+json";
};

export class AdminModelValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AdminModelValidationError";
  }
}

export function isAdminUploadPurpose(value: string): value is AdminUploadPurpose {
  return ADMIN_UPLOAD_PURPOSES.includes(value as AdminUploadPurpose);
}

export async function validateAdminModelFile(file: File): Promise<ValidatedAdminModel> {
  if (file.size <= 0) {
    throw new AdminModelValidationError("EMPTY_MODEL_FILE", "빈 모델 파일은 업로드할 수 없습니다.");
  }

  if (file.size > MAX_ADMIN_MODEL_BYTES) {
    throw new AdminModelValidationError(
      "MODEL_FILE_TOO_LARGE",
      "모델 파일은 100MB 이하여야 합니다.",
      413,
    );
  }

  const extension = file.name.toLowerCase().split(".").pop();

  if (extension !== "glb" && extension !== "gltf") {
    throw new AdminModelValidationError(
      "UNSUPPORTED_MODEL_TYPE",
      "GLB 또는 GLTF 파일만 업로드할 수 있습니다.",
      415,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (extension === "glb") {
    validateGlb(bytes);
    return { bytes, extension, contentType: "model/gltf-binary" };
  }

  validateSelfContainedGltf(bytes);
  return { bytes, extension, contentType: "model/gltf+json" };
}

function validateGlb(bytes: Uint8Array) {
  if (bytes.byteLength < 12) {
    throw invalidModel("GLB 헤더가 없습니다.");
  }

  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = header.getUint32(0, true);
  const version = header.getUint32(4, true);
  const declaredLength = header.getUint32(8, true);

  if (magic !== 0x46546c67 || version !== 2 || declaredLength !== bytes.byteLength) {
    throw invalidModel("GLB v2 헤더 또는 파일 길이가 올바르지 않습니다.");
  }
}

function validateSelfContainedGltf(bytes: Uint8Array) {
  let gltf: {
    asset?: { version?: string };
    buffers?: Array<{ uri?: string }>;
    images?: Array<{ uri?: string }>;
  };

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    gltf = JSON.parse(text) as typeof gltf;
  } catch {
    throw invalidModel("GLTF JSON을 읽을 수 없습니다.");
  }

  if (gltf.asset?.version !== "2.0") {
    throw invalidModel("GLTF 2.0 파일만 지원합니다.");
  }

  const externalUris = [...(gltf.buffers ?? []), ...(gltf.images ?? [])]
    .map((item) => item.uri)
    .filter((uri): uri is string => typeof uri === "string" && !uri.startsWith("data:"));

  if (externalUris.length > 0) {
    throw invalidModel("외부 bin 또는 이미지 파일을 참조하는 GLTF는 지원하지 않습니다.");
  }
}

function invalidModel(message: string) {
  return new AdminModelValidationError("INVALID_MODEL_FILE", message);
}
