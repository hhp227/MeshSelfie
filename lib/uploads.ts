export type ImageRole = "front" | "side" | "angle45";
export type ImageDirection = "left" | "right";
export type QualityGrade = "B" | "A" | "A+";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

export function validateImageFile(file: File, label: string) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return `${label}은 JPG 또는 PNG만 업로드할 수 있습니다.`;
  }

  if (file.size <= 0) {
    return `${label} 파일이 비어 있습니다.`;
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return `${label}은 10MB 이하만 업로드할 수 있습니다.`;
  }

  return null;
}

export function getImageExtension(contentType: string) {
  return contentType === "image/png" ? "png" : "jpg";
}

export function parseDirection(value: FormDataEntryValue | null): ImageDirection | null {
  return value === "left" || value === "right" ? value : null;
}

export function calculateQualityGrade(inputImageCount: number): QualityGrade {
  if (inputImageCount >= 3) {
    return "A+";
  }

  if (inputImageCount === 2) {
    return "A";
  }

  return "B";
}

export async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
