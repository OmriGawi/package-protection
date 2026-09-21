import { useEffect, useRef } from "react";

/**
 * A modal confirmation, in place of `window.confirm`.
 *
 * The native dialog asks a Hebrew question under English browser buttons,
 * docks at the top of the window away from what it is asking about, and blocks
 * the thread — on the packages page that stops the check polling dead.
 *
 * Both callers guard the same thing: photos picked but not yet saved live only
 * in memory (`usePhotoDraft`), so losing them means photographing a box again.
 * That is why the cancelling button holds focus rather than the destructive
 * one — a stray Enter should not cost real work.
 */
export function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  cancelLabel = "ביטול",
  onConfirm,
  onCancel,
}: {
  title: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Where focus was, so it can go back there when the dialog closes: the row
    // or thumbnail the user was working on, not the top of the document.
    const opener = document.activeElement as HTMLElement | null;
    cancelButton.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;

      // Trapped: outside the dialog is a page the user has already been asked
      // to stop interacting with, and Tab is the one key that escapes on its own.
      const focusable = panel.current.querySelectorAll<HTMLElement>("button");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const moving = event.shiftKey ? first : last;
      if (document.activeElement === moving) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        ref={panel}
        className="dialog card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={detail ? "confirm-dialog-detail" : undefined}
        // The backdrop cancels; a click that lands on the panel itself is not a
        // click past it.
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-[15px] font-bold">
          {title}
        </h2>
        {detail && (
          <p id="confirm-dialog-detail" className="mt-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
            {detail}
          </p>
        )}
        <div className="mt-5 flex items-center gap-2.5">
          <button type="button" ref={cancelButton} className="btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
