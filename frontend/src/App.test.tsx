import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as apiClient from "./api/client";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(apiClient, "listDeliveries").mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
});

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/deliveries"]}>
      <App />
    </MemoryRouter>
  );
}

describe("App shell", () => {
  it("offers a skip link that lands on the main landmark", async () => {
    renderApp();

    await waitFor(() => expect(screen.getByRole("main")).toBeInTheDocument());

    // The link is the first thing a keyboard user reaches, and its target has
    // to exist or the skip goes nowhere.
    const skip = screen.getByRole("link", { name: "דילוג לתוכן הראשי" });
    expect(skip).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });

  it("marks the page the header nav is on", async () => {
    renderApp();

    const current = await screen.findByRole("link", { name: "המשלוחים שלי" });
    // The sliding pill is measured from the DOM and never appears under jsdom,
    // so the class is what says which link it would be sitting on.
    expect(current.className).toContain("is-active");
    expect(screen.getByRole("link", { name: "לוח בקרה" }).className).not.toContain("is-active");
  });

  it("names the main landmark", async () => {
    renderApp();

    await waitFor(() =>
      expect(screen.getByRole("main", { name: "תוכן ראשי" })).toBeInTheDocument()
    );
  });
});
