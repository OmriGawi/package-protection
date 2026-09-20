import { useEffect, useRef, useState } from "react";
import { validateReference, type Direction } from "../api/client";

type RefStatus = "idle" | "checking" | "valid" | "invalid";

export function DeliveryDetailsCard({
  direction,
  referenceNumber,
  onDirectionChange,
  onReferenceNumberChange,
  onValidityChange,
}: {
  direction: Direction;
  referenceNumber: string;
  onDirectionChange: (direction: Direction) => void;
  onReferenceNumberChange: (referenceNumber: string) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  /**
   * What was validated, and what came back. Tagged with the input it describes
   * rather than reset when that input changes: clearing it from an effect meant
   * a render showing the old reference's tick before the reset landed, and it
   * is the same fact stored twice — the answer, and whether the answer is still
   * about what is on screen.
   */
  const [result, setResult] = useState<{
    key: string;
    status: Exclude<RefStatus, "idle">;
    linkedPoNumber: string | null;
  } | null>(null);

  const key = `${direction}:${referenceNumber.trim()}`;
  const refStatus: RefStatus = result?.key === key ? result.status : "idle";
  const linkedPoNumber = result?.key === key ? result.linkedPoNumber : null;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Written from an effect, not during render: the only readers are the timer
  // and the awaited continuation below, both of which run after commit.
  const onValidityChangeRef = useRef(onValidityChange);
  useEffect(() => {
    onValidityChangeRef.current = onValidityChange;
  }, [onValidityChange]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const value = referenceNumber.trim();
    if (!value) return;

    // One flag rather than a request counter. A counter only advanced when the
    // *next* debounce fired, which left the 550ms after a keystroke uncovered:
    // a call already in flight could resolve in that window and report a
    // superseded reference as valid — the tick would be gone from the screen
    // while the parent had just been told to enable Submit.
    let superseded = false;

    debounceRef.current = setTimeout(async () => {
      setResult({ key, status: "checking", linkedPoNumber: null });
      const validated = await validateReference(direction, value);
      if (superseded) return;
      setResult({
        key,
        status: validated.valid ? "valid" : "invalid",
        linkedPoNumber: validated.linked_po_number ?? null,
      });
      onValidityChangeRef.current(validated.valid);
    }, 550);

    return () => {
      superseded = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [referenceNumber, direction, key]);

  return (
    <div className="card" style={{ padding: "26px 28px", height: "fit-content" }}>
      <h2 className="text-[13.5px] font-bold mb-5">פרטי המשלוח</h2>

      <div className="inline-flex rounded-lg overflow-hidden mb-6" style={{ border: "1px solid var(--border-field)" }}>
        {(["EXPORT", "IMPORT"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              // Nothing changes when the active direction is clicked again, so
              // React skips the re-render and the validation effect never runs
              // — reporting invalid here would strand the form with a green
              // tick on screen and Submit dead.
              if (value === direction) return;
              onValidityChange(false);
              onDirectionChange(value);
            }}
            className="px-6 py-2.5 text-sm font-semibold transition"
            style={
              direction === value
                ? { background: "var(--blue)", color: "var(--on-accent)" }
                : { background: "var(--surface)", color: "var(--text-secondary)" }
            }
          >
            {value === "EXPORT" ? "ייצוא" : "יבוא"}
          </button>
        ))}
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
          onChange={(e) => {
            // Told here rather than from an effect watching the prop: this is
            // the event that invalidated the previous answer.
            onValidityChange(false);
            onReferenceNumberChange(e.target.value);
          }}
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
      <p
        className="mt-2 text-[12px]"
        style={{
          minHeight: 16,
          color: refStatus === "valid" ? "var(--green)" : refStatus === "invalid" ? "var(--red)" : "var(--text-secondary)",
        }}
      >
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
    </div>
  );
}
