import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listDeliveries, type DeliveryListItem } from "../api/client";
import { Logo } from "../components/Logo";
import { formatDate } from "../lib/display";

export function DeliveriesPage() {
  const navigate = useNavigate();
  const [deliveries, setDeliveries] = useState<DeliveryListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDeliveries()
      .then(setDeliveries)
      .catch(() => setError("טעינת המשלוחים נכשלה"));
  }, []);

  return (
    <>
      <div className="flex flex-col items-center mb-12">
        <Logo size="hero" />
        <div className="text-center" style={{ marginTop: 14 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#12384c" }}>מערכת להגנה על אריזות</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#2b7fae", marginTop: 6, letterSpacing: ".02em" }}>
            אבטחת אריזות מקצה לקצה
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <h1 className="text-[26px] font-extrabold tracking-tight" style={{ color: "var(--navy)" }}>
          המשלוחים שלי
        </h1>
        <button type="button" className="btn-primary" onClick={() => navigate("/deliveries/new")}>
          משלוח חדש
        </button>
      </div>

      <div className="rounded-2xl bg-white shadow-sm overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        {error ? (
          <p className="px-6 py-5 text-[13px]" style={{ color: "var(--red)" }}>
            {error}
          </p>
        ) : deliveries && deliveries.length === 0 ? (
          <p className="px-6 py-5 text-[13px]" style={{ color: "var(--text-secondary)" }}>
            עדיין לא נוצרו משלוחים. לחצו על &quot;משלוח חדש&quot; כדי להתחיל.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["מס' משלוח", "מס' הזמנה / תעודת משלוח", "חבילות", "נוצר בתאריך"].map((heading) => (
                    <th
                      key={heading}
                      className="text-right font-semibold px-6 py-3.5 text-[11.5px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(deliveries ?? []).map((delivery) => (
                  <tr
                    key={delivery.id}
                    className="row-hover cursor-pointer"
                    style={{ borderBottom: "1px solid var(--border)" }}
                    onClick={() => navigate(`/deliveries/${delivery.id}`)}
                  >
                    <td className="px-6 py-3.5 font-semibold">#{delivery.internalNumber}</td>
                    <td className="px-6 py-3.5" style={{ direction: "ltr", textAlign: "right" }}>
                      {delivery.referenceNumber}
                    </td>
                    <td className="px-6 py-3.5">{delivery.packageCount}</td>
                    <td className="px-6 py-3.5" style={{ color: "var(--text-secondary)" }}>
                      {formatDate(delivery.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* Search, status filter and pagination land in Slice 4, together with
          the per-delivery status column they exist to narrow down. */}
    </>
  );
}
