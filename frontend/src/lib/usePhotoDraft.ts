import { useEffect, useRef, useState } from "react";

export const MIN_PHOTOS = 4;

// Must stay in step with the backend's allowlist (backend/src/lib/imageTypes.ts):
// anything the server would reject should be flagged here first, rather than
// failing the whole submit after the employee has assembled the delivery.
export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export interface DraftPhoto {
  id: string;
  file: File;
  url: string;
  valid: boolean;
  reason: string;
}

export function toDraftPhoto(file: File): DraftPhoto {
  const isAllowed = ALLOWED_TYPES.includes(file.type);
  return {
    id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    file,
    url: URL.createObjectURL(file),
    valid: isAllowed,
    reason: isAllowed ? "" : "לא קובץ תמונה",
  };
}

/**
 * The photos picked but not yet saved, shared by the pre-ship and post-receive
 * upload panels — they behave identically, and the object-URL bookkeeping is
 * the part worth having in exactly one place.
 *
 * Every thumbnail holds a blob URL the browser keeps alive until it's revoked;
 * without that, a few packages of phone photos leak hundreds of MB for as long
 * as the tab stays open.
 */
export function usePhotoDraft() {
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);

  // Written from an effect rather than during render: the unmount cleanup below
  // is the only reader, and it runs after commit, so a render-time write bought
  // nothing and is the pattern React warns about.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  function add(files: File[]) {
    setPhotos((current) => [...current, ...files.map(toDraftPhoto)]);
  }

  function remove(id: string) {
    setPhotos((current) => {
      const going = current.find((p) => p.id === id);
      if (going) URL.revokeObjectURL(going.url);
      return current.filter((p) => p.id !== id);
    });
  }

  function clear() {
    setPhotos((current) => {
      current.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
  }

  /** Replaces the draft wholesale, e.g. when reopening a saved package to edit it. */
  function replace(files: File[]) {
    setPhotos((current) => {
      current.forEach((p) => URL.revokeObjectURL(p.url));
      return files.map(toDraftPhoto);
    });
  }

  const valid = photos.filter((p) => p.valid);

  return { photos, valid, hasEnough: valid.length >= MIN_PHOTOS, add, remove, clear, replace };
}
