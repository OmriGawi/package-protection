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

  it("names the main landmark", async () => {
    renderApp();

    await waitFor(() =>
      expect(screen.getByRole("main", { name: "תוכן ראשי" })).toBeInTheDocument()
    );
  });
});
