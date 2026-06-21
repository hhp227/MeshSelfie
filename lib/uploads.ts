export type ImageRole = "front" | "side" | "angle45";
export type ImageDirection = "left" | "right";
export type QualityGrade = "B" | "A" | "A+";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
export const MIN_IMAGE_DIMENSION = 512;
export const RECOMMENDED_IMAGE_DIMENSION = 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

export type ImageDimensions = {
  width: number;
  height: number;
};

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

export async function readImageDimensions(file: File): Promise<ImageDimensions | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (file.type === "image/png") {
    return readPngDimensions(bytes);
  }

  if (file.type === "image/jpeg") {
    return readJpegDimensions(bytes);
  }

  return null;
}

export function validateImageDimensions(dimensions: ImageDimensions, label: string) {
  if (
    dimensions.width < MIN_IMAGE_DIMENSION ||
    dimensions.height < MIN_IMAGE_DIMENSION
  ) {
    return `${label}은 가로와 세로가 모두 ${MIN_IMAGE_DIMENSION}px 이상이어야 합니다. 현재 ${dimensions.width}×${dimensions.height}px입니다.`;
  }

  return null;
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

function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.byteLength < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 3 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }

    if (marker === 0xda) {
      break;
    }

    if (offset + 2 > bytes.byteLength) {
      return null;
    }

    const segmentLength = view.getUint16(offset);

    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      return null;
    }

    if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
      return {
        width: view.getUint16(offset + 5),
        height: view.getUint16(offset + 3),
      };
    }

    offset += segmentLength;
  }

  return null;
}

function isJpegStartOfFrame(marker: number) {
  return [
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf,
  ].includes(marker);
}
