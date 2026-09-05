import { NavLink } from "react-router-dom";
import { Logo } from "./Logo";

/** Both destinations are reachable by anyone: there is no login (DESIGN.md §6,
 *  §9), so role-gating the manager view would be theatre. Real Employee vs
 *  Inventory-Manager access is a Keycloak realm-role concern in production. */
const NAV = [
  { to: "/deliveries", label: "המשלוחים שלי" },
  { to: "/dashboard", label: "לוח בקרה" },
];

export function AppHeader() {
  return (
    <header
      className="sticky top-0 z-10"
      style={{ background: "#ffffffd9", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--border)" }}
    >
      <div className="max-w-7xl mx-auto px-8 h-16 flex items-center gap-8">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="font-extrabold text-[15px]" style={{ color: "var(--navy)" }}>
            Package Protector
          </span>
        </div>

        <nav className="flex items-center gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className="px-3.5 py-2 rounded-lg text-[13px] font-semibold transition"
              style={({ isActive }) =>
                isActive
                  ? { background: "var(--blue-soft)", color: "var(--navy)" }
                  : { color: "var(--text-secondary)" }
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
