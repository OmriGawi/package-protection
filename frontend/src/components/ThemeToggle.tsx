import { useEffect, useState } from "react";
import { applyTheme, nextTheme, readStoredTheme, type Theme } from "../lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia?.(DARK_QUERY).matches ?? false
  );

  // The OS can change under us — at dusk, or from the settings app — and while
  // the theme is "system" that has to move the toggle's label with it.
  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY);
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const showingDark = theme === "dark" || (theme === "system" && systemPrefersDark);

  function toggle() {
    const next = nextTheme(theme, systemPrefersDark);
    setTheme(next);
    applyTheme(next);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      // The label says what the button does, not what it is — a screen reader
      // gets no help from "theme toggle, button".
      aria-label={showingDark ? "מעבר למצב בהיר" : "מעבר למצב כהה"}
      title={showingDark ? "מעבר למצב בהיר" : "מעבר למצב כהה"}
    >
      {showingDark ? (
        // Sun: what you would switch to.
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
