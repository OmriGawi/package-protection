import { Navigate, Route, Routes } from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
import { CreateDeliveryPage } from "./pages/CreateDeliveryPage";
import { DeliveriesPage } from "./pages/DeliveriesPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DeliveryPackagesPage } from "./pages/DeliveryPackagesPage";

export default function App() {
  return (
    <div dir="rtl" className="min-h-screen">
      {/* First stop for a keyboard user on every page, so the header's links
          are not a toll paid before reaching the table. Hidden until focused. */}
      <a href="#main" className="sr-only skip-link">
        דילוג לתוכן הראשי
      </a>
      <AppHeader />
      <main id="main" aria-label="תוכן ראשי" className="max-w-7xl mx-auto px-8 py-10">
        <Routes>
          <Route path="/" element={<Navigate to="/deliveries" replace />} />
          <Route path="/deliveries" element={<DeliveriesPage />} />
          <Route path="/deliveries/new" element={<CreateDeliveryPage />} />
          <Route path="/deliveries/:id" element={<DeliveryPackagesPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
        </Routes>
      </main>
    </div>
  );
}
