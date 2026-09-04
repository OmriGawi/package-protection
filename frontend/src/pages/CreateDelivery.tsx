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
    <div className="max-w-xl bg-white rounded-xl shadow p-6 space-y-5">
      <h2 className="text-lg font-bold">משלוח חדש</h2>

      <div className="flex gap-2">
        <button
          className={`px-4 py-2 rounded-lg border ${direction === "EXPORT" ? "bg-[var(--navy,#004370)] text-white border-transparent" : "border-gray-300"}`}
          onClick={() => setDirection("EXPORT")}
        >
          יצוא
        </button>
        <button
          className={`px-4 py-2 rounded-lg border ${direction === "IMPORT" ? "bg-[var(--navy,#004370)] text-white border-transparent" : "border-gray-300"}`}
          onClick={() => setDirection("IMPORT")}
        >
          יבוא
        </button>
      </div>

      <div>
        <input
          className="w-full border border-gray-300 rounded-lg px-3 py-2"
          placeholder={direction === "EXPORT" ? "מספר משלוח (SHP-...)" : "מספר הזמנה (PO-...)"}
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
          autoComplete="off"
          data-lpignore="true"
        />
        <div className="text-sm mt-1">
          {refStatus === "checking" && <span className="text-gray-500">בודק מול ה-ERP…</span>}
          {refStatus === "valid" && <span className="text-green-600">אומת מול ה-ERP</span>}
          {refStatus === "invalid" && <span className="text-red-600">לא נמצא ב-ERP — בדקו את המספר</span>}
        </div>
        {linkedPoNumber && (
          <div className="text-sm text-gray-600 mt-1">מספר הזמנה מקושר: {linkedPoNumber}</div>
        )}
      </div>

      <div>
        <button
          className="px-5 py-2 rounded-full bg-[var(--navy,#004370)] text-white disabled:opacity-40"
          disabled={refStatus !== "valid" || submitting}
          onClick={handleSubmit}
        >
          {submitting ? "שולח…" : "שליחה"}
        </button>
        {submitError && <div className="text-sm text-red-600 mt-2">{submitError}</div>}
      </div>
    </div>
  );
}
