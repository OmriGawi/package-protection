import { useEffect, useState } from "react";
import { listDeliveries, type Delivery } from "../api/client";

export function DeliveriesList({ refreshKey }: { refreshKey: number }) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    listDeliveries()
      .then(setDeliveries)
      .catch(() => setError("טעינת המשלוחים נכשלה"));
  }, [refreshKey]);

  return (
    <div>
      <div className="text-[13.5px] font-bold mb-3">המשלוחים שלי</div>
      <div className="rounded-2xl bg-white shadow-sm overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        {error ? (
          <p className="px-6 py-5 text-[13px]" style={{ color: "var(--red)" }}>
            {error}
          </p>
        ) : deliveries.length === 0 ? (
          <p className="px-6 py-5 text-[13px]" style={{ color: "var(--text-secondary)" }}>
            אין עדיין משלוחים. לחצו &quot;שליחה&quot; כדי ליצור את הראשון.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th className="text-right font-semibold px-6 py-3.5 text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
                    מספר פנימי
                  </th>
                  <th className="text-right font-semibold px-6 py-3.5 text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
                    כיוון
                  </th>
                  <th className="text-right font-semibold px-6 py-3.5 text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
                    מספר אסמכתא
                  </th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="row-hover" style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="px-6 py-3.5 font-mono">#{d.internalNumber}</td>
                    <td className="px-6 py-3.5">{d.direction === "EXPORT" ? "ייצוא" : "יבוא"}</td>
                    <td className="px-6 py-3.5" dir="ltr" style={{ textAlign: "right" }}>
                      {d.referenceNumber}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
