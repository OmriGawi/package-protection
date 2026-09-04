/**
 * The photo formats we accept on upload AND can serve back.
 *
 * One list for both directions on purpose: accepting anything `image/*` let a
 * file store successfully and then render as a broken thumbnail, because the
 * serving side only knew a handful of content types.
 *
 * Deliberately excluded:
 * - SVG — it can carry script, and serving it from our own origin as
 *   image/svg+xml would be an XSS vector. Package photos are never vector art.
 * - HEIC/HEIF — what an iPhone shoots by default, but Chrome and Firefox can't
 *   render it, so storing it would mean unviewable evidence. Handling it needs
 *   server-side conversion, which waits on the tamper-detection API's actual
 *   format requirements (DESIGN.md §9).
 */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(ALLOWED_IMAGE_TYPES).map(([mimeType, extension]) => [extension, mimeType])
);

export function isAllowedImageType(mimeType: string): boolean {
  return mimeType in ALLOWED_IMAGE_TYPES;
}

/**
 * The real format of `buffer`, from its magic bytes, or null if it isn't one
 * we accept.
 *
 * The multipart part's own Content-Type is supplied by the client, so trusting
 * it would let an SVG (script-carrying) or a HEIC (unrenderable) through
 * simply by labelling itself image/png — and it would then be served back from
 * our origin under that lie. The bytes are the only trustworthy source.
 */
export function detectImageType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  const header = buffer.subarray(0, 6).toString("latin1");
  if (header === "GIF87a" || header === "GIF89a") {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function extensionForImageType(mimeType: string): string {
  return ALLOWED_IMAGE_TYPES[mimeType] ?? ".bin";
}

export function contentTypeForExtension(extension: string): string {
  return CONTENT_TYPE_BY_EXTENSION[extension.toLowerCase()] ?? "application/octet-stream";
}

export const ALLOWED_IMAGE_TYPES_LABEL = "JPEG, PNG, WebP או GIF";
