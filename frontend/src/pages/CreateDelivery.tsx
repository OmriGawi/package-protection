import { useEffect, useRef, useState } from "react";
import { createDelivery, validateReference, type Direction } from "../api/client";

type RefStatus = "idle" | "checking" | "valid" | "invalid";

export function CreateDelivery({ onCreated }: { onCreated: () => void }) {
  const [direction, setDirection] = useState<Direction>("EXPORT");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [refStatus, setRefStatus] = useState<RefStatus>("idle");
  const [linkedPoNumber, setLinkedPoNumber] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against a slow-to-resolve validation call landing after the
  // input has already changed again — only the most recently fired
  // request's result is allowed to update state.
  const latestRequestId = useRef(0);

  useEffect(() => {
    setRefStatus("idle");
    setLinkedPoNumber(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const value = referenceNumber.trim();
    if (!value) return;

    debounceRef.current = setTimeout(async () => {
      const requestId = ++latestRequestId.current;
      setRefStatus("checking");
      const result = await validateReference(direction, value);
      if (requestId !== latestRequestId.current) return;
      setRefStatus(result.valid ? "valid" : "invalid");
      setLinkedPoNumber(result.linked_po_number ?? null);
    }, 550);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceNumber, direction]);

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createDelivery(direction, referenceNumber);
      setReferenceNumber("");
      setRefStatus("idle");
      setLinkedPoNumber(null);
      onCreated();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "השליחה נכשלה, נסו שוב");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card" style={{ padding: "26px 28px", height: "fit-content" }}>
      <div className="text-[13.5px] font-bold mb-5">פרטי המשלוח</div>

      <div className="inline-flex rounded-lg overflow-hidden mb-6" style={{ border: "1px solid #00000018" }}>
        <button
          type="button"
          onClick={() => setDirection("EXPORT")}
          className="px-6 py-2.5 text-sm font-semibold transition"
          style={
            direction === "EXPORT"
              ? { background: "var(--blue)", color: "#fff" }
              : { background: "#fff", color: "var(--text-secondary)" }
          }
        >
          ייצוא
        </button>
        <button
          type="button"
          onClick={() => setDirection("IMPORT")}
          className="px-6 py-2.5 text-sm font-semibold transition"
          style={
            direction === "IMPORT"
              ? { background: "var(--blue)", color: "#fff" }
              : { background: "#fff", color: "var(--text-secondary)" }
          }
        >
          יבוא
        </button>
      </div>

      <label htmlFor="reference-number" className="block text-[12.5px] font-semibold mb-2.5">
        {direction === "EXPORT" ? "מספר משלוח" : "מספר הזמנה"}
      </label>
      <div style={{ position: "relative" }}>
        <input
          id="reference-number"
          className="field"
          style={{ paddingLeft: 34 }}
          dir="ltr"
          placeholder={direction === "EXPORT" ? "SHP-88291" : "PO-88291"}
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          data-bwignore="true"
          data-form-type="other"
        />
        {refStatus === "checking" && (
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }}>
            <span
              className="inline-block w-3.5 h-3.5 rounded-full"
              style={{ border: "2px solid var(--blue-soft)", borderTopColor: "var(--blue)", animation: "spin .7s linear infinite" }}
            />
          </span>
        )}
        {refStatus === "valid" && (
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--green)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </span>
        )}
        {refStatus === "invalid" && (
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--red)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </span>
        )}
      </div>
      <p className="mt-2 text-[12px]" style={{ minHeight: 16, color: refStatus === "valid" ? "var(--green)" : refStatus === "invalid" ? "var(--red)" : "var(--text-secondary)" }}>
        {refStatus === "checking" && "בודק מול ה-ERP…"}
        {refStatus === "valid" && "אומת מול ה-ERP"}
        {refStatus === "invalid" && "לא נמצא ב-ERP — בדקו את המספר"}
      </p>

      {linkedPoNumber && (
        <div
          className="flex items-center gap-1.5"
          style={{ marginTop: 4, paddingTop: 14, borderTop: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-secondary)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 17H7A5 5 0 017 7h2M15 7h2a5 5 0 010 10h-2M8 12h8" />
          </svg>
          מספר הזמנה משויך ב-ERP:
          <span className="font-semibold" style={{ color: "var(--text)" }} dir="ltr">
            {linkedPoNumber}
          </span>
        </div>
      )}

      <div className="flex justify-end mt-6">
        <button className="btn-primary" disabled={refStatus !== "valid" || submitting} onClick={handleSubmit}>
          {submitting ? "שולח…" : "שליחה"}
        </button>
      </div>
      {submitError && (
        <p className="mt-2 text-[12px]" style={{ color: "var(--red)" }}>
          {submitError}
        </p>
      )}
    </div>
  );
}
