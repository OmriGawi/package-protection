import { useState } from "react";
import { CreateDelivery } from "./pages/CreateDelivery";
import { DeliveriesList } from "./pages/DeliveriesList";

function Logo() {
  return (
    <svg width="24" height="26" viewBox="0 0 110 120" fill="none">
      <path
        d="M55 6 L98 22 V60 C98 88 80 106 55 116 C30 106 12 88 12 60 V22 Z"
        stroke="#2b7fae"
        strokeWidth="7"
        strokeLinejoin="round"
        fill="#eaf6fc"
      />
      <rect x="35" y="48" width="40" height="34" rx="3" stroke="#12384c" strokeWidth="6" fill="none" />
      <line x1="35" y1="61" x2="75" y2="61" stroke="#12384c" strokeWidth="6" />
      <line x1="55" y1="61" x2="55" y2="82" stroke="#12384c" strokeWidth="6" />
    </svg>
  );
}

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div dir="rtl" className="min-h-screen">
      <header
        className="sticky top-0 z-10"
        style={{ background: "#ffffffd9", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center gap-2">
          <Logo />
          <span className="font-extrabold text-[15px]" style={{ color: "var(--navy)" }}>
            Package Protector
          </span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-10">
        <h1 className="text-2xl font-extrabold mb-7" style={{ color: "var(--navy)" }}>
          משלוח חדש
        </h1>
        <div className="grid gap-6" style={{ gridTemplateColumns: "380px 1fr" }}>
          <CreateDelivery onCreated={() => setRefreshKey((k) => k + 1)} />
          <DeliveriesList refreshKey={refreshKey} />
        </div>
      </main>
    </div>
  );
}
