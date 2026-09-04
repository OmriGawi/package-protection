import { useState } from "react";
import { CreateDelivery } from "./pages/CreateDelivery";
import { DeliveriesList } from "./pages/DeliveriesList";

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div dir="rtl" className="min-h-screen bg-[#f7fafc] p-8 space-y-8">
      <h1 className="text-2xl font-extrabold text-[var(--navy,#004370)]">Package Protector</h1>
      <div className="flex flex-wrap gap-8 items-start">
        <CreateDelivery onCreated={() => setRefreshKey((k) => k + 1)} />
        <DeliveriesList refreshKey={refreshKey} />
      </div>
    </div>
  );
}
