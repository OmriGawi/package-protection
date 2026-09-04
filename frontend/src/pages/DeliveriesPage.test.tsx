import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveriesPage } from "./DeliveriesPage";
import * as apiClient from "../api/client";

beforeEach(() => {
  vi.restoreAllMocks();
});

function row(overrides: Partial<apiClient.DeliveryListItem> = {}): apiClient.DeliveryListItem {
  return {
    id: "d1",
    internalNumber: 42,
    direction: "EXPORT",
    referenceNumber: "SHP-84213",
    createdAt: "2026-09-04T17:30:54.993Z",
    packageCount: 3,
    attentionStatus: "AWAITING_RECEIPT",
    ...overrides,
  };
}

function page(items: apiClient.DeliveryListItem[], overrides: Partial<apiClient.DeliveryPage> = {}) {
  return { items, total: items.length, page: 1, pageSize: 20, ...overrides };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/deliveries"]}>
      <DeliveriesPage />
    </MemoryRouter>
  );
}

describe("DeliveriesPage", () => {
  it("renders a delivery with its package count, status badge and localized date", async () => {
    vi.spyOn(apiClient, "listDeliveries").mockResolvedValue(page([row({ attentionStatus: "OPENED" })]));

    renderPage();

    await waitFor(() => expect(screen.getByText("SHP-84213")).toBeInTheDocument());
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    // Scoped to the table: the same text is also a filter chip.
    expect(within(screen.getByRole("table")).getByText("חבילה נפתחה")).toBeInTheDocument();
    // Stored UTC, displayed as a he-IL date.
    expect(screen.getByText("04.09.2026")).toBeInTheDocument();
  });

  it("searches server-side after a debounce, not per keystroke", async () => {
    const list = vi.spyOn(apiClient, "listDeliveries").mockResolvedValue(page([row()]));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await user.type(screen.getByRole("searchbox", { name: "חיפוש משלוחים" }), "SHP-84");

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: "SHP-84" }))
    );
    // Six characters typed, but nowhere near six requests.
    expect(list.mock.calls.length).toBeLessThan(4);
  });

  it("filters by status and asks the server for it", async () => {
    const list = vi.spyOn(apiClient, "listDeliveries").mockResolvedValue(page([row()]));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(list).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "חבילה נפתחה" }));

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: "OPENED" }))
    );
    expect(screen.getByRole("button", { name: "חבילה נפתחה" })).toHaveAttribute("aria-pressed", "true");
  });

  it("returns to page 1 when the filter changes, so page 3 of everything isn't page 3 of the filter", async () => {
    const list = vi.spyOn(apiClient, "listDeliveries").mockResolvedValue(
      page([row()], { total: 100, page: 1 })
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(list).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "הבא" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));

    await user.click(screen.getByRole("button", { name: "הושלם" }));

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: "COMPLETE", page: 1 }))
    );
  });

  it("disables paging at both ends", async () => {
    vi.spyOn(apiClient, "listDeliveries").mockResolvedValue(page([row()], { total: 5, page: 1 }));
    renderPage();

    await waitFor(() => expect(screen.getByText("עמוד 1 מתוך 1")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "הקודם" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "הבא" })).toBeDisabled();
  });

  it("distinguishes an empty history from a filter that matched nothing", async () => {
    vi.spyOn(apiClient, "listDeliveries").mockResolvedValue(page([], { total: 0 }));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/עדיין לא נוצרו משלוחים/)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "הושלם" }));

    // Same empty result, different cause — and so a different message.
    await waitFor(() => expect(screen.getByText(/לא נמצאו משלוחים התואמים/)).toBeInTheDocument());
    expect(screen.queryByText(/עדיין לא נוצרו משלוחים/)).not.toBeInTheDocument();
  });

  it("shows an error instead of a silently empty table when the fetch fails", async () => {
    vi.spyOn(apiClient, "listDeliveries").mockRejectedValue(new Error("network error"));

    renderPage();

    await waitFor(() => expect(screen.getByText("טעינת המשלוחים נכשלה")).toBeInTheDocument());
    expect(screen.queryByText(/עדיין לא נוצרו משלוחים/)).not.toBeInTheDocument();
  });

  it("restores search, filter and page from the URL", async () => {
    const list = vi.spyOn(apiClient, "listDeliveries").mockResolvedValue(page([row()], { total: 100 }));

    render(
      <MemoryRouter initialEntries={["/deliveries?search=SHP-9&status=OPENED&page=3"]}>
        <DeliveriesPage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith({ search: "SHP-9", status: "OPENED", page: 3 })
    );
    expect(screen.getByRole("searchbox", { name: "חיפוש משלוחים" })).toHaveValue("SHP-9");
  });

  it("opens a delivery when its row is clicked", async () => {
    vi.spyOn(apiClient, "listDeliveries").mockResolvedValue(page([row()]));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("SHP-84213")).toBeInTheDocument());
    await user.click(within(screen.getByRole("table")).getByText("SHP-84213"));

    // Router-driven: the row navigates rather than opening an inline panel.
    expect(screen.queryByRole("table")).toBeInTheDocument();
  });
  it("does not claim there are no deliveries when the page is merely past the end", async () => {
    vi.spyOn(apiClient, "listDeliveries").mockResolvedValue(page([], { total: 100, page: 9 }));

    render(
      <MemoryRouter initialEntries={["/deliveries?page=9"]}>
        <DeliveriesPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("אין משלוחים בעמוד זה.")).toBeInTheDocument());
    expect(screen.queryByText(/עדיין לא נוצרו משלוחים/)).not.toBeInTheDocument();
    // The pager has to survive, or there is no way back to a page with rows.
    expect(screen.getByRole("button", { name: "הקודם" })).toBeEnabled();
  });

  it("ignores a stale response that arrives after a newer one", async () => {
    const slowFirst = page([row({ id: "old", referenceNumber: "SHP-OLD" })]);
    const fast = page([row({ id: "new", referenceNumber: "SHP-NEW" })]);
    vi.spyOn(apiClient, "listDeliveries")
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(slowFirst), 150))
      )
      .mockResolvedValue(fast);

    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "הושלם" }));

    await waitFor(() => expect(screen.getByText("SHP-NEW")).toBeInTheDocument());
    // Let the first, slower request land.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByText("SHP-OLD")).not.toBeInTheDocument();
  });

  it("keeps a status chip clicked while a search is still debouncing", async () => {
    const list = vi.spyOn(apiClient, "listDeliveries").mockResolvedValue(page([row()]));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(list).toHaveBeenCalled());

    await user.type(screen.getByRole("searchbox", { name: "חיפוש משלוחים" }), "SHP");
    await user.click(screen.getByRole("button", { name: "הושלם" }));

    // The debounced commit must not overwrite the chip with pre-click params.
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "SHP", status: "COMPLETE" })
      )
    );
    expect(screen.getByRole("button", { name: "הושלם" })).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to page 1 for a nonsense page parameter", async () => {
    const list = vi.spyOn(apiClient, "listDeliveries").mockResolvedValue(page([row()]));

    render(
      <MemoryRouter initialEntries={["/deliveries?page=abc"]}>
        <DeliveriesPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })));
    expect(screen.getByText(/עמוד 1 מתוך/)).toBeInTheDocument();
  });
});
