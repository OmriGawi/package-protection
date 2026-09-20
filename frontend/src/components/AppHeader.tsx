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
            Package Protection
          </span>
        </div>

        <nav className="flex items-center gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              // Styled by class rather than inline, so :hover has something it
              // can override — an inline style outranks the stylesheet.
              className={({ isActive }) => (isActive ? "nav-link is-active" : "nav-link")}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
