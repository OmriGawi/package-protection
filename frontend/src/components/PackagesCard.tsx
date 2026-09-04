import { useEffect, useRef, useState } from "react";
import type { DraftPackage } from "../api/client";
import { nextPackageLabel } from "../lib/packageLabels";

const MIN_PHOTOS = 4;

// Must stay in step with the backend's allowlist (backend/src/lib/imageTypes.ts):
// anything the server would reject should be flagged here first, rather than
// failing the whole submit after the employee has assembled the delivery.
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

interface DraftPhoto {
  id: string;
  file: File;
  url: string;
  valid: boolean;
  reason: string;
}

function toDraftPhoto(file: File): DraftPhoto {
  const isAllowed = ALLOWED_TYPES.includes(file.type);
  return {
    id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    file,
    url: URL.createObjectURL(file),
    valid: isAllowed,
    reason: isAllowed ? "" : "לא קובץ תמונה",
  };
}

export function PackagesCard({
  enabled,
  packages,
  onChange,
}: {
  enabled: boolean;
  packages: DraftPackage[];
  onChange: (packages: DraftPackage[]) => void;
}) {
  const [photoDraft, setPhotoDraft] = useState<DraftPhoto[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Navigating away mid-draft (e.g. the back link) would otherwise strand
  // every blob URL still held by the thumbnails.
  const photoDraftRef = useRef(photoDraft);
  photoDraftRef.current = photoDraft;
  useEffect(() => () => photoDraftRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const validPhotos = photoDraft.filter((p) => p.valid);
  const editingPackage = packages.find((p) => p.id === editingId) ?? null;
  const currentLabel = editingPackage ? editingPackage.label : nextPackageLabel(packages);
  const canSavePackage = enabled && validPhotos.length >= MIN_PHOTOS;

  function handleFilesPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    setPhotoDraft((current) => [...current, ...picked.map(toDraftPhoto)]);
    event.target.value = "";
  }

  // Every thumbnail holds a blob URL the browser keeps alive until it's
  // revoked — without this, a few packages of phone photos leak hundreds of MB
  // for as long as the tab stays open.
  function removeDraftPhoto(id: string) {
    setPhotoDraft((current) => {
      const going = current.find((p) => p.id === id);
      if (going) URL.revokeObjectURL(going.url);
      return current.filter((p) => p.id !== id);
    });
  }

  function resetDraft() {
    setPhotoDraft((current) => {
      current.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
    setEditingId(null);
  }

  function savePackage() {
    if (!canSavePackage) return;
    const photos = validPhotos.map((p) => p.file);

    if (editingPackage) {
      onChange(packages.map((p) => (p.id === editingPackage.id ? { ...p, photos } : p)));
    } else {
      onChange([
        ...packages,
        { id: `pkg-${Date.now()}-${Math.random().toString(36).slice(2)}`, label: currentLabel, photos },
      ]);
    }
    resetDraft();
  }

  function editPackage(pkg: DraftPackage) {
    if (pkg.id === editingId) return;
    // Opening a package replaces whatever is in the upload area, so a mis-click
    // here would silently bin photos the employee just picked for the next box.
    if (photoDraft.length > 0 && !window.confirm("התמונות שטרם נשמרו יימחקו. להמשיך?")) return;

    setPhotoDraft((current) => {
      current.forEach((p) => URL.revokeObjectURL(p.url));
      return pkg.photos.map(toDraftPhoto);
    });
    setEditingId(pkg.id);
  }

  function removePackage(pkg: DraftPackage, event: React.MouseEvent) {
    event.stopPropagation();
    if (pkg.id === editingId) resetDraft();
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
            <button type="button" onClick={resetDraft} className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              ביטול עריכה
            </button>
          )}
        </div>

        <label className="block text-[12.5px] font-semibold mb-2.5">
          תמונות — {validPhotos.length} מתוך 4+ מינימום
        </label>

        <label className={`dropzone${enabled ? "" : " is-disabled"}`}>
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_TYPES.join(",")}
            multiple
            onChange={handleFilesPicked}
            disabled={!enabled}
            style={{ display: "none" }}
          />
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00000055" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 18a4 4 0 01-1-7.87A5.5 5.5 0 0116.9 8H17a4 4 0 011 7.87" />
            <path d="M12 12v7" />
            <path d="M9 15l3-3 3 3" />
          </svg>
          <span className="text-[12.5px] font-semibold">לחצו להעלאת תמונות</span>
          <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
            JPG או PNG — לפחות 4 תמונות של החבילה
          </span>
        </label>

        <div className="grid gap-2.5 mt-3.5" style={{ gridTemplateColumns: "repeat(6,1fr)" }}>
          {photoDraft.map((photo) => (
            <div key={photo.id} className="thumb">
              <img src={photo.url} alt="" />
              <span className="thumb-flag" title={photo.reason} style={{ background: photo.valid ? "var(--green)" : "var(--red)" }}>
                {photo.valid ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                )}
              </span>
              <button type="button" aria-label="הסרת תמונה" className="thumb-remove" onClick={() => removeDraftPhoto(photo.id)}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div className="flex justify-end mt-5">
          <button type="button" className="btn-primary" disabled={!canSavePackage} onClick={savePackage}>
            {editingPackage ? "עדכון חבילה" : "שמירת חבילה והוספת הבאה"}
          </button>
        </div>
      </div>
    </div>
  );
}
