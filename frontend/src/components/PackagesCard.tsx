import { useEffect, useState } from "react";
import type { DraftPackage } from "../api/client";
import { nextPackageLabel } from "../lib/packageLabels";
import { usePhotoDraft } from "../lib/usePhotoDraft";
import { PhotoDraftThumbs, PhotoDropzone } from "./PhotoPicker";

export type DraftState = "none" | "new" | "editing";

export function PackagesCard({
  enabled,
  packages,
  onChange,
  onDraftChange,
}: {
  enabled: boolean;
  packages: DraftPackage[];
  onChange: (packages: DraftPackage[]) => void;
  /** What is sitting in the upload area: "new" for photos belonging to no
   *  package yet, "editing" for a saved package reopened for changes, "none"
   *  when it is empty. The submit button needs this — without it, pressing
   *  Send drops unsaved work in silence. */
  onDraftChange?: (state: DraftState) => void;
}) {
  const draft = usePhotoDraft();
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingPackage = packages.find((p) => p.id === editingId) ?? null;

  // Editing loads a saved package's photos into this same draft area, so a
  // non-empty draft does not on its own mean something is unsaved.
  const draftState: DraftState =
    draft.photos.length === 0 ? "none" : editingId ? "editing" : "new";
  useEffect(() => {
    onDraftChange?.(draftState);
  }, [draftState, onDraftChange]);
  const currentLabel = editingPackage ? editingPackage.label : nextPackageLabel(packages);
  const canSavePackage = enabled && draft.hasEnough;

  function cancelEdit() {
    draft.clear();
    setEditingId(null);
  }

  function savePackage() {
    if (!canSavePackage) return;
    const photos = draft.valid.map((p) => p.file);

    if (editingPackage) {
      onChange(packages.map((p) => (p.id === editingPackage.id ? { ...p, photos } : p)));
    } else {
      onChange([
        ...packages,
        { id: `pkg-${Date.now()}-${Math.random().toString(36).slice(2)}`, label: currentLabel, photos },
      ]);
    }
    cancelEdit();
  }

  function editPackage(pkg: DraftPackage) {
    if (pkg.id === editingId) return;
    // Opening a package replaces whatever is in the upload area, so a mis-click
    // here would silently bin photos the employee just picked for the next box.
    if (draft.photos.length > 0 && !window.confirm("התמונות שטרם נשמרו יימחקו. להמשיך?")) return;

    draft.replace(pkg.photos);
    setEditingId(pkg.id);
  }

  function removePackage(pkg: DraftPackage, event: React.MouseEvent) {
    event.stopPropagation();
    if (pkg.id === editingId) cancelEdit();
    onChange(packages.filter((p) => p.id !== pkg.id));
  }

  return (
    <div className="card" style={{ padding: "26px 28px" }}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[13.5px] font-bold">חבילות</div>
        <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
          {packages.length} חבילות נוספו
        </span>
      </div>

      {!enabled && (
        <p className="text-[12.5px] mt-1 mb-4" style={{ color: "var(--text-secondary)" }}>
          אמתו את מספר האסמכתא כדי להתחיל להוסיף חבילות.
        </p>
      )}
      {enabled && packages.length > 0 && (
        <p className="text-[11px] mt-1 mb-4" style={{ color: "var(--text-secondary)" }}>
          לחצו על חבילה ברשימה כדי לערוך את התמונות שלה.
        </p>
      )}

      <div className="mb-1" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {packages.map((pkg) => {
          const isEditing = pkg.id === editingId;
          return (
            <div
              key={pkg.id}
              onClick={() => editPackage(pkg)}
              className="flex items-center justify-between rounded-lg px-4 py-3 cursor-pointer"
              style={{
                border: `1px solid ${isEditing ? "var(--blue)" : "var(--border)"}`,
                background: isEditing ? "var(--blue-soft)" : "transparent",
              }}
            >
              <div>
                <div className="font-semibold text-[13px]">
                  חבילה {pkg.label}
                  {isEditing ? " — בעריכה" : ""}
                </div>
                <div className="text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
                  {pkg.photos.length} תמונות
                </div>
              </div>
              <button
                type="button"
                aria-label={`מחיקת חבילה ${pkg.label}`}
                onClick={(e) => removePackage(pkg, e)}
                style={{ color: "var(--text-secondary)" }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: "1px solid var(--border)", marginTop: 18, paddingTop: 18 }}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <span className="text-[12.5px] font-semibold">{editingPackage ? "עריכת חבילה מספר" : "חבילה מספר"}</span>
            <span
              className="inline-flex items-center justify-center rounded-lg font-bold"
              style={{ background: "var(--blue-soft)", color: "var(--blue)", width: 32, height: 32, fontSize: 13.5 }}
            >
              {currentLabel}
            </span>
            {!editingPackage && (
              <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                — כתבו את המספר הזה על הקרטון
              </span>
            )}
          </div>
          {editingPackage && (
            <button type="button" onClick={cancelEdit} className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              ביטול עריכה
            </button>
          )}
        </div>

        <label className="block text-[12.5px] font-semibold mb-2.5">
          תמונות — {draft.valid.length} מתוך 4+ מינימום
        </label>

        <PhotoDropzone disabled={!enabled} onPick={draft.add} />
        <PhotoDraftThumbs photos={draft.photos} onRemove={draft.remove} />

        <div className="flex justify-end mt-5">
          <button type="button" className="btn-primary" disabled={!canSavePackage} onClick={savePackage}>
            {editingPackage ? "עדכון חבילה" : "שמירת חבילה והוספת הבאה"}
          </button>
        </div>
      </div>
    </div>
  );
}
