import multer from "multer";
import { storage } from "./storage";
import { ALLOWED_IMAGE_TYPES_LABEL, detectImageType, extensionForImageType } from "./imageTypes";

export const MIN_PHOTOS_PER_PACKAGE = 4;

export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_PHOTOS_PER_REQUEST = 200;

// Bounded because memoryStorage buffers every part in RAM before any of our
// own validation runs — without limits one oversized POST can take the process
// down. A real size/resolution floor is still open (DESIGN.md §9); these are
// blast-radius caps, not quality rules.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS_PER_REQUEST },
});

export const PHOTO_TYPE_ERROR = `every photo must be an image file (${ALLOWED_IMAGE_TYPES_LABEL})`;

/**
 * The real type of each file, sniffed from its bytes — or null if any of them
 * isn't a format we accept. The multipart part's own Content-Type is
 * client-supplied, so it is never trusted (DESIGN.md §3).
 */
export function detectPhotoTypes(
  files: Express.Multer.File[]
): Map<Express.Multer.File, string> | null {
  const detected = new Map<Express.Multer.File, string>();
  for (const file of files) {
    const type = detectImageType(file.buffer);
    if (!type) return null;
    detected.set(file, type);
  }
  return detected;
}

/** Writes the files through the storage client, returning their storage paths in order. */
export function savePhotos(
  files: Express.Multer.File[],
  detectedTypes: Map<Express.Multer.File, string>,
  keyPrefix: string
): Promise<string[]> {
  return Promise.all(
    files.map((file) => storage.save(file.buffer, extensionForImageType(detectedTypes.get(file)!), keyPrefix))
  );
}

// storagePath is deliberately absent: it's the storage backend's internal
// layout, which the StorageClient exists to keep private. Clients address an
// image by id via /api/images/:id and never need to know where it lives.
export const IMAGE_SELECT = {
  select: { id: true, phase: true, sequence: true, uploadedAt: true },
  orderBy: { sequence: "asc" },
} as const;
