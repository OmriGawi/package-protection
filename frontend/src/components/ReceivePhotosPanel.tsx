import { useEffect, useState } from "react";
import { submitPostReceivePhotos } from "../api/client";
import { usePhotoDraft } from "../lib/usePhotoDraft";
import { PhotoDraftThumbs, PhotoDropzone } from "./PhotoPicker";

/**
 * Receiving happens inline on the package you're already looking at, rather
 * than on a separate pick-a-delivery-then-pick-a-package screen — this is
 * necessarily the right package, since it's the row that was clicked
 * (DESIGN.md §4.2).
 */
export function ReceivePhotosPanel({
  packageId,
  label,
  onSubmitted,
  onCancel,
  onDirtyChange,
}: {
  packageId: string;
  label: number;
  onSubmitted: () => void;
  onCancel: () => void;
  /** Lets the page know photos are picked but unsent, so nothing closes this panel from under them. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const draft = usePhotoDraft();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = draft.photos.length > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  async function submit() {
    if (!draft.hasEnough || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitPostReceivePhotos(packageId, draft.valid.map((p) => p.file));
      draft.clear();
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שליחת התמונות נכשלה, נסו שוב");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="text-[12.5px] font-semibold mb-3">
        תמונות קבלה לחבילה {label} — {draft.valid.length} מתוך 4+ מינימום
      </div>

      <PhotoDropzone maxWidth={420} onPick={draft.add} />
      <PhotoDraftThumbs photos={draft.photos} maxWidth={420} onRemove={draft.remove} />

      <div className="flex items-center gap-3 mt-4">
        <button type="button" className="btn-primary" disabled={!draft.hasEnough || submitting} onClick={submit}>
          {submitting ? "שולח…" : "שליחה לבדיקה"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12.5px] font-semibold"
          style={{ color: "var(--text-secondary)" }}
        >
          ביטול
        </button>
      </div>

      {error && (
        <p role="alert" className="text-[12px] mt-2" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}
    </>
  );
}
