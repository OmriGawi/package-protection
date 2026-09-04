import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DeliveriesPage } from "./DeliveriesPage";
import * as apiClient from "../api/client";

function deliveryListItem(overrides: Partial<apiClient.DeliveryListItem> = {}): apiClient.DeliveryListItem {
  return {
    id: "d1",
    internalNumber: 42,
    direction: "EXPORT",
    referenceNumber: "SHP-84213",
    status: "SUBMITTED",
    createdBy: "local-dev-user",
    createdAt: "2026-09-04T17:30:54.993Z",
    packageCount: 3,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DeliveriesPage />
    </MemoryRouter>
  );
}

describe("DeliveriesPage", () => {
  it("renders a delivery with its package count and a localized date", async () => {
    vi.spyOn(apiClient, "listDeliveries").mockResolvedValue([deliveryListItem()]);

    renderPage();

    await waitFor(() => expect(screen.getByText("SHP-84213")).toBeInTheDocument());
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    // Stored UTC, displayed as a he-IL date (DD.MM.YYYY).
    expect(screen.getByText("04.09.2026")).toBeInTheDocument();
  });

  it("shows a first-time message when no deliveries exist yet", async () => {
    vi.spyOn(apiClient, "listDeliveries").mockResolvedValue([]);

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/עדיין לא נוצרו משלוחים/)).toBeInTheDocument()
    );
  });

  it("shows an error instead of a silently empty table when the fetch fails", async () => {
    vi.spyOn(apiClient, "listDeliveries").mockRejectedValue(new Error("network error"));

    renderPage();

    await waitFor(() => expect(screen.getByText("טעינת המשלוחים נכשלה")).toBeInTheDocument());
    expect(screen.queryByText(/עדיין לא נוצרו משלוחים/)).not.toBeInTheDocument();
  });
});
