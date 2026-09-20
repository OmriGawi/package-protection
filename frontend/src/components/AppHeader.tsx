import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Logo } from "./Logo";

/** Both destinations are reachable by anyone: there is no login (DESIGN.md §6,
 *  §9), so role-gating the manager view would be theatre. Real Employee vs
 *  Inventory-Manager access is a Keycloak realm-role concern in production. */
const NAV = [
  { to: "/deliveries", label: "המשלוחים שלי" },
  { to: "/dashboard", label: "לוח בקרה" },
];

type PillBox = { left: number; width: number };

export function AppHeader() {
  const { pathname } = useLocation();
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  // Null until the first measurement. The pill is mounted already sitting on
  // the current page, and a transition does not run on an element's first
  // layout, so there is no flight in from the edge to suppress.
  const [pill, setPill] = useState<PillBox | null>(null);

  const activeIndex = NAV.findIndex((item) => pathname.startsWith(item.to));
  const target = hovered ?? (activeIndex === -1 ? null : activeIndex);

  const measure = useCallback(() => {
    const element = target === null ? null : linkRefs.current[target];
    // offsetWidth is 0 under jsdom and before fonts settle, and a zero-width
    // pill is worse than none: leave the previous box in place instead.
    if (!element || element.offsetWidth === 0) return;
    setPill({ left: element.offsetLeft, width: element.offsetWidth });
  }, [target]);

  useLayoutEffect(measure, [measure, pathname]);

  // The links move when the window does — the header is centred and the labels
  // wrap — so a pill measured once ends up pointing at empty space.
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

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

        {/* One pill for the whole nav rather than a background per link: it
            travels to whatever the pointer is on and glides back to the current
            page when the pointer leaves, so the nav reads as one control. */}
        <nav className="nav" onMouseLeave={() => setHovered(null)}>
          {pill && (
            <span
              aria-hidden="true"
              className="nav-pill"
              style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
            />
          )}
          {NAV.map((item, index) => (
            <NavLink
              key={item.to}
              to={item.to}
              ref={(element) => {
                linkRefs.current[index] = element;
              }}
              // Styled by class rather than inline, so the stylesheet can own
              // the hover and focus states — an inline style outranks it.
              className={({ isActive }) => (isActive ? "nav-link is-active" : "nav-link")}
              onMouseEnter={() => setHovered(index)}
              // Keyboard focus moves the pill too, or tabbing through the nav
              // would leave it pointing somewhere the user is not.
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
