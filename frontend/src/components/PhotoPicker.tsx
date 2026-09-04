import { ALLOWED_TYPES, type DraftPhoto } from "../lib/usePhotoDraft";

export function PhotoDropzone({
  disabled = false,
  maxWidth,
  onPick,
}: {
  disabled?: boolean;
  maxWidth?: number;
  onPick: (files: File[]) => void;
}) {
  return (
    <label className={`dropzone${disabled ? " is-disabled" : ""}`} style={maxWidth ? { maxWidth } : undefined}>
      <input
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        multiple
        disabled={disabled}
        onChange={(event) => {
          onPick(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
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
  );
}

export function PhotoDraftThumbs({
  photos,
  maxWidth,
  onRemove,
}: {
  photos: DraftPhoto[];
  maxWidth?: number;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="grid gap-2.5 mt-3.5" style={{ gridTemplateColumns: "repeat(6,1fr)", maxWidth }}>
      {photos.map((photo) => (
        <div key={photo.id} className="thumb">
          <img src={photo.url} alt="" />
          <span
            className="thumb-flag"
            title={photo.reason}
            style={{ background: photo.valid ? "var(--green)" : "var(--red)" }}
          >
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
          <button type="button" aria-label="הסרת תמונה" className="thumb-remove" onClick={() => onRemove(photo.id)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
