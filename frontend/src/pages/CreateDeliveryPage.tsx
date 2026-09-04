import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createDelivery, type Direction, type DraftPackage } from "../api/client";
import { DeliveryDetailsCard } from "../components/DeliveryDetailsCard";
import { PackagesCard } from "../components/PackagesCard";

export function CreateDeliveryPage() {
  const navigate = useNavigate();
  const [direction, setDirection] = useState<Direction>("EXPORT");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [referenceValid, setReferenceValid] = useState(false);
  const [packages, setPackages] = useState<DraftPackage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canSubmit = referenceValid && packages.length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createDelivery(direction, referenceNumber, packages);
      navigate("/deliveries");
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
          <PackagesCard enabled={referenceValid} packages={packages} onChange={setPackages} />

          <div className="flex flex-col items-end gap-2">
            <button type="button" className="btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? "שולח…" : "שליחת המשלוח"}
            </button>
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
