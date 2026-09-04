import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getDelivery, imageUrl, type DeliveryDetail } from "../api/client";
import { DIRECTION_TEXT, WORKFLOW_TEXT, formatDate, verdictInfo } from "../lib/display";

export function DeliveryPackagesPage() {
  const { id } = useParams<{ id: string }>();
  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedLabel, setExpandedLabel] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    getDelivery(id)
      .then(setDelivery)
      .catch(() => setError("טעינת המשלוח נכשלה"));
  }, [id]);

  return (
    <>
      <Link to="/deliveries" className="inline-flex items-center gap-1.5 text-sm font-semibold mb-5" style={{ color: "var(--blue)" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 6l6 6-6 6" />
        </svg>
        חזרה למשלוחים
      </Link>

      {error && (
        <p className="text-[13px]" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}

      {delivery && (
        <>
          <div className="mb-6">
            <h1 className="text-2xl font-extrabold" style={{ color: "var(--navy)" }} dir="ltr">
              {delivery.referenceNumber}
            </h1>
            <p className="mt-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
              מס&apos; משלוח #{delivery.internalNumber} · {DIRECTION_TEXT[delivery.direction]} · נוצר ב-
              {formatDate(delivery.createdAt)}
            </p>
          </div>

          <div className="rounded-2xl bg-white shadow-sm overflow-hidden" style={{ border: "1px solid var(--border)", maxWidth: 900 }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["חבילה", "סטטוס תהליך", "תוצאה"].map((heading) => (
                    <th key={heading} className="text-right font-semibold px-6 py-3.5 text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {delivery.packages.map((pkg) => {
                  const badge = verdictInfo(pkg);
                  const isExpanded = expandedLabel === pkg.label;
                  const preShipImages = pkg.images.filter((image) => image.phase === "PRE_SHIP");

                  return [
                    <tr
                      key={pkg.id}
                      className="row-hover cursor-pointer"
                      style={{ borderBottom: isExpanded ? "none" : "1px solid var(--border)" }}
                      onClick={() => setExpandedLabel(isExpanded ? null : pkg.label)}
                    >
                      <td className="px-6 py-4 font-semibold">חבילה {pkg.label}</td>
                      <td className="px-6 py-4" style={{ color: "var(--text-secondary)" }}>
                        {WORKFLOW_TEXT[pkg.workflowStatus]}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className="inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-semibold"
                          style={{ color: badge.color, background: badge.bg }}
                        >
                          {badge.text}
                        </span>
                      </td>
                    </tr>,
                    isExpanded && (
                      <tr key={`${pkg.id}-photos`} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td colSpan={3} className="px-6 pb-5">
                          <div className="text-[12.5px] font-semibold mb-2.5">תמונות שליחה</div>
                          <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(6,1fr)", maxWidth: 520 }}>
                            {preShipImages.map((image) => (
                              <a key={image.id} className="thumb" href={imageUrl(image.id)} target="_blank" rel="noreferrer">
                                <img src={imageUrl(image.id)} alt={`תמונה ${image.sequence} של חבילה ${pkg.label}`} />
                              </a>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
