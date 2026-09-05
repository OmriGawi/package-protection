import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createDelivery, type Direction, type DraftPackage } from "../api/client";
import { DeliveryDetailsCard } from "../components/DeliveryDetailsCard";
import { PackagesCard, type DraftState } from "../components/PackagesCard";

export function CreateDeliveryPage() {
  const navigate = useNavigate();
  const [direction, setDirection] = useState<Direction>("EXPORT");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [referenceValid, setReferenceValid] = useState(false);
  const [packages, setPackages] = useState<DraftPackage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<DraftState>("none");

  // Work in the upload area is not part of `packages`, so sending now would
  // drop it without a word. Both cases block, but they are different mistakes
  // and get different instructions: an unsaved package needs saving, a package
  // being edited needs the edit finished or abandoned.
  const canSubmit = referenceValid && packages.length > 0 && !submitting && draftState === "none";

  // Stable, so PackagesCard's reporting effect doesn't re-run every render.
  const handleDraftChange = useCallback((next: DraftState) => setDraftState(next), []);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createDelivery(direction, referenceNumber, packages);
      // Handed over in history state rather than a query parameter: this is a
      // one-time confirmation, not part of the address of the list.
      navigate("/deliveries", {
        state: {
          created: {
            id: created.id,
            internalNumber: created.internalNumber,
            referenceNumber: created.referenceNumber,
            packageCount: created.packages.length,
          },
        },
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "השליחה נכשלה, נסו שוב");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Link to="/deliveries" className="inline-flex items-center gap-1.5 text-sm font-semibold mb-5" style={{ color: "var(--blue)" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 6l6 6-6 6" />
        </svg>
        חזרה למשלוחים
      </Link>

      <div className="mb-7">
        <h1 className="text-2xl font-extrabold" style={{ color: "var(--navy)" }}>
          משלוח חדש
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
          מלאו את פרטי המשלוח והוסיפו את החבילות — הכל בעמוד אחד.
        </p>
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: "380px 1fr" }}>
        <DeliveryDetailsCard
          direction={direction}
          referenceNumber={referenceNumber}
          onDirectionChange={setDirection}
          onReferenceNumberChange={setReferenceNumber}
          onValidityChange={setReferenceValid}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <PackagesCard
            enabled={referenceValid}
            packages={packages}
            onChange={setPackages}
            onDraftChange={handleDraftChange}
          />

          <div className="flex flex-col items-end gap-2">
            <button type="button" className="btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? "שולח…" : "שליחת המשלוח"}
            </button>
            {draftState !== "none" && (
              <p className="text-[12px] flex items-center gap-1.5" style={{ color: "var(--amber)" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                  <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
                </svg>
                {draftState === "editing"
                  ? "חבילה נמצאת בעריכה — שמרו את השינויים או בטלו את העריכה."
                  : "יש חבילה שטרם נשמרה — שמרו אותה או הסירו את התמונות."}
              </p>
            )}
            {submitError && (
              <p className="text-[12px]" style={{ color: "var(--red)" }}>
                {submitError}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
