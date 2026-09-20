import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

/** jsdom's matchMedia is not implemented, so every test states what the OS says. */
function mockSystem(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  window.matchMedia = vi.fn().mockReturnValue({
    matches: prefersDark,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
  });
  return {
    change(nowPrefersDark: boolean) {
      for (const listener of listeners) {
        listener({ matches: nowPrefersDark } as MediaQueryListEvent);
      }
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ThemeToggle", () => {
  it("follows the system until someone chooses", () => {
    mockSystem(true);
    render(<ThemeToggle />);

    // Nothing pinned: the stylesheet's prefers-color-scheme block is in charge.
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(screen.getByRole("button", { name: "מעבר למצב בהיר" })).toBeInTheDocument();
  });

  it("pins light when the system is dark, and remembers it", async () => {
    mockSystem(true);
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "מעבר למצב בהיר" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("package-protection.theme")).toBe("light");
    expect(screen.getByRole("button", { name: "מעבר למצב כהה" })).toBeInTheDocument();
  });

  it("pins dark when the system is light", async () => {
    mockSystem(false);
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "מעבר למצב כהה" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("package-protection.theme")).toBe("dark");
  });

  it("starts from the stored choice rather than the system", () => {
    mockSystem(true);
    localStorage.setItem("package-protection.theme", "light");

    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "מעבר למצב כהה" })).toBeInTheDocument();
  });

  it("keeps up with the OS switching under it while following the system", () => {
    const system = mockSystem(false);
    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "מעבר למצב כהה" })).toBeInTheDocument();

    // Wrapped: the listener sets state outside React's own event handling.
    act(() => system.change(true));

    // Still following the system — only the label has to move.
    expect(screen.getByRole("button", { name: "מעבר למצב בהיר" })).toBeInTheDocument();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
