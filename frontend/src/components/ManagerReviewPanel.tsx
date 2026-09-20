import { useState } from "react";
import { reviewPackage, type Package } from "../api/client";
import { formatDate } from "../lib/display";

/**
 * The manager's verdict override (DESIGN.md §4.4.5).
 *
 * Deliberately here, under the photos, and not on the dashboard row: this is a
 * decision about evidence, so it belongs next to the evidence.
 *
 * Two outcomes, not one. INCONCLUSIVE exists because the algorithm could not
 * decide, so the physical check has to be able to resolve it either way — an
 * earlier wireframe offered only "confirm intact", which assumed every override
 * is a false positive being corrected.
 */
export function ManagerReviewPanel({
  pkg,
  onReviewed,
}: {
  pkg: Package;
  onReviewed: () => void;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<"INTACT" | "OPENED" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Once reviewed the note is permanent, read-only history — not a transient
  // confirmation that disappears on the next load.
  if (pkg.verdictSource === "MANUAL") {
    return (
      <div className="mt-5 rounded-lg px-4 py-3" style={{ background: "var(--surface-sunken)", border: "1px solid var(--border)" }}>
        <div className="text-[12px] font-semibold mb-1">
          נבדק ידנית · {pkg.verdict === "OPENED" ? "אושר כנפתחה" : "אושר כתקינה"}
        </div>
        <div className="text-[12.5px]" style={{ color: "var(--text-secondary)" }}>
          {pkg.overrideNote}
        </div>
        {pkg.overriddenAt && (
          <div className="text-[11px] mt-1.5" style={{ color: "var(--text-secondary)" }}>
            {pkg.verdictOverriddenBy} · {formatDate(pkg.overriddenAt)}
          </div>
        )}
      </div>
    );
  }

  // The same rule the dashboard sorts and labels by, and the same one the API
  // enforces. An INTACT result is already resolved (§4.4.3): offering a form
  // here would let a package be flipped to OPENED through a path triage never
  // surfaces.
  const reviewable =
    pkg.workflowStatus === "RECEIVED" &&
    (pkg.verdict === "OPENED" || pkg.verdict === "INCONCLUSIVE");
  if (!reviewable) return null;

  async function submit(verdict: "INTACT" | "OPENED") {
    if (!note.trim() || submitting) return;
    setSubmitting(verdict);
    setError(null);
    try {
      await reviewPackage(pkg.id, verdict, note.trim());
      onReviewed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שמירת הבדיקה נכשלה");
    } finally {
      // Cleared even on success: the refetch normally replaces this panel with
      // the read-only branch, but if that refetch fails the panel stays mounted
      // and would sit on a disabled "שומר…" with no way out.
      setSubmitting(null);
    }
  }

  return (
    <div className="mt-5 rounded-lg px-4 py-4" style={{ background: "var(--surface-sunken)", border: "1px solid var(--border)" }}>
      <div className="text-[12.5px] font-semibold mb-1">בדיקה ידנית</div>
      <p className="text-[11.5px] mb-3" style={{ color: "var(--text-secondary)" }}>
        מה נמצא בבדיקה הפיזית? ההערה נשמרת לצמיתות לצד התמונות.
      </p>

      <textarea
        className="field"
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        aria-label="הערת בדיקה"
        placeholder="לדוגמה: הקרטון נבדק במחסן, הסרט מקורי ואין סימני פתיחה"
        style={{ resize: "vertical", maxWidth: 520 }}
      />

      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <button
          type="button"
          className="px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold disabled:opacity-35 disabled:cursor-not-allowed"
          style={{ border: "1px solid var(--green)", color: "var(--green)" }}
          disabled={!note.trim() || submitting !== null}
          onClick={() => submit("INTACT")}
        >
          {submitting === "INTACT" ? "שומר…" : "אישור כתקינה"}
        </button>
        <button
          type="button"
          className="px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold disabled:opacity-35 disabled:cursor-not-allowed"
          style={{ border: "1px solid var(--red)", color: "var(--red)" }}
          disabled={!note.trim() || submitting !== null}
          onClick={() => submit("OPENED")}
        >
          {submitting === "OPENED" ? "שומר…" : "אישור כנפתחה"}
        </button>

        {!note.trim() && (
          <span className="text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
            נדרשת הערה לפני אישור.
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[12px] mt-2" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
