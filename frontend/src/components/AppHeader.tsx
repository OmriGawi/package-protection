import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Logo } from "./Logo";

/** Both destinations are reachable by anyone: there is no login (DESIGN.md §6,
 *  §9), so role-gating the manager view would be theatre. Real Employee vs
 *  Inventory-Manager access is a Keycloak realm-role concern in production. */
const NAV = [
  { to: "/deliveries", label: "המשלוחים שלי" },
  { to: "/dashboard", label: "לוח בקרה" },
];

/** The Dock's falloff: what the pointer is on grows most, its neighbour grows a
 *  little, everything further away stays put. With two links only the first two
 *  steps are ever reached, but the rule is written for the row rather than for
 *  today's two items. */
const SCALE_BY_DISTANCE = [1.12, 1.04];

function scaleFor(index: number, focused: number | null): number {
  if (focused === null) return 1;
  return SCALE_BY_DISTANCE[Math.abs(index - focused)] ?? 1;
}

export function AppHeader() {
  const [focused, setFocused] = useState<number | null>(null);

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

        {/* Dock behaviour: the item under the pointer swells and its neighbours
            follow at a smaller scale, so the row reacts as a group rather than
            one item lighting up alone. */}
        <nav className="nav" onMouseLeave={() => setFocused(null)}>
          {NAV.map((item, index) => {
            const scale = scaleFor(index, focused);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? "nav-link is-active" : "nav-link")}
                // Per-item and computed from which item the pointer is on, so
                // it cannot live in the stylesheet with the rest of the styling.
                style={{ transform: `scale(${scale}) translateY(${scale > 1 ? -2 : 0}px)` }}
                onMouseEnter={() => setFocused(index)}
                // Keyboard focus swells the link too, or tabbing through the
                // nav would move a highlight nothing else reflects.
                onFocus={() => setFocused(index)}
                onBlur={() => setFocused(null)}
              >
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
