import { useEffect, useState } from "react";
import { listDeliveries, type Delivery } from "../api/client";

export function DeliveriesList({ refreshKey }: { refreshKey: number }) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);

  useEffect(() => {
    listDeliveries().then(setDeliveries);
  }, [refreshKey]);

  return (
    <div className="max-w-xl bg-white rounded-xl shadow p-6">
      <h2 className="text-lg font-bold mb-4">המשלוחים שלי</h2>
      {deliveries.length === 0 ? (
        <p className="text-gray-500">אין עדיין משלוחים.</p>
      ) : (
        <table className="w-full text-right">
          <thead>
            <tr className="text-gray-500 text-sm">
              <th className="py-2">מספר פנימי</th>
              <th className="py-2">כיוון</th>
              <th className="py-2">מספר אסמכתא</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id} className="border-t border-gray-100">
                <td className="py-2 font-mono">#{d.internalNumber}</td>
                <td className="py-2">{d.direction === "EXPORT" ? "יצוא" : "יבוא"}</td>
                <td className="py-2">{d.referenceNumber}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
