import { Navigate, Route, Routes } from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
import { CreateDeliveryPage } from "./pages/CreateDeliveryPage";
import { DeliveriesPage } from "./pages/DeliveriesPage";
import { DeliveryPackagesPage } from "./pages/DeliveryPackagesPage";

export default function App() {
  return (
    <div dir="rtl" className="min-h-screen">
      <AppHeader />
      <main className="max-w-7xl mx-auto px-8 py-10">
        <Routes>
          <Route path="/" element={<Navigate to="/deliveries" replace />} />
          <Route path="/deliveries" element={<DeliveriesPage />} />
          <Route path="/deliveries/new" element={<CreateDeliveryPage />} />
          <Route path="/deliveries/:id" element={<DeliveryPackagesPage />} />
        </Routes>
      </main>
    </div>
  );
}
