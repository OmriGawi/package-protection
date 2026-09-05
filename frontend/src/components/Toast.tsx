import { useEffect, useRef } from "react";

const AUTO_DISMISS_MS = 9000;

type ToastProps = {
  title: string;
  detail?: string;
  onDismiss: () => void;
};

/** A floating confirmation, pinned to the top-left of the viewport.
 *
 * Physically left, not inline-start: this app is RTL, so its content begins at
 * the right edge and the message sits opposite it.
 *
 * role="status" rather than "alert": this reports something that succeeded, so
 * a screen reader should finish its current sentence before announcing it. */
export function Toast({ title, detail, onDismiss }: ToastProps) {
  // The countdown is armed once, on mount. Depending on `onDismiss` directly
  // would re-arm it on every parent render — and the caller passes an inline
  // arrow, so typing in the search box would keep the toast alive forever.
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });

  useEffect(() => {
    const timer = setTimeout(() => dismiss.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="toast card flex items-start gap-3.5 px-5 py-4"
      style={{
        position: "fixed",
        // Physical top-left, not logical: in this RTL app the inline-start
        // edge is the right one, and this is meant to sit opposite the
        // content that starts there.
        top: 24,
        left: 24,
        zIndex: 50,
        maxWidth: 460,
        boxShadow: "0 6px 24px rgba(0,0,0,.10)",
      }}
    >
      <span
        className="inline-flex items-center justify-center rounded-full shrink-0"
        style={{ width: 28, height: 28, background: "var(--green-soft)", color: "var(--green)" }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>

      <div className="flex-1">
        <div className="text-[15px] font-semibold">{title}</div>
        {detail && (
          <div className="text-[12.5px] mt-1" style={{ color: "var(--text-secondary)" }}>
            {detail}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="סגירת ההודעה"
        className="shrink-0"
        style={{ color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
