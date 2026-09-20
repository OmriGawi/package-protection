/**
 * Light, dark, or whatever the operating system says.
 *
 * "system" is the default and stays the default: someone who has never touched
 * the toggle follows their OS, including when it switches at dusk. Choosing
 * light or dark pins it and outlasts a reload — `index.css` keys the dark
 * tokens off both `prefers-color-scheme` and `data-theme`, so an explicit
 * choice wins in either direction.
 */
export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "package-protection.theme";

export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Storage can be denied outright (private mode, blocked cookies). Following
    // the system is the right answer when we cannot remember a choice.
    return "system";
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }

  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The theme still applies for this session; it just will not be remembered.
  }
}

/** What the toggle would switch to: away from whatever is on screen now. */
export function nextTheme(current: Theme, systemPrefersDark: boolean): Theme {
  const showingDark = current === "dark" || (current === "system" && systemPrefersDark);
  return showingDark ? "light" : "dark";
}
