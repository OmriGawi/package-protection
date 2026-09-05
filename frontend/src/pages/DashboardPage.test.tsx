import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";
import * as apiClient from "../api/client";

beforeEach(() => {
  vi.restoreAllMocks();
});

function row(overrides: Partial<apiClient.PackageListItem> = {}): apiClient.PackageListItem {
  return {
    packageId: "p1",
    label: 2,
    workflowStatus: "RECEIVED",
    verdict: "OPENED",
    verdictSource: "API",
    needsManagerReview: true,
    deliveryId: "d1",
    deliveryInternalNumber: 1042,
    deliveryReference: "SHP-88291",
    direction: "EXPORT",
    ...overrides,
  };
}

function page(
  items: apiClient.PackageListItem[],
  overrides: Partial<apiClient.PackagePage> = {}
): apiClient.PackagePage {
  return {
    items,
    stats: { total: 1700, opened: 12, inconclusive: 4, checkFailed: 7, pending: 900 },
    total: items.length,
    page: 1,
    pageSize: 20,
    ...overrides,
  };
}

function renderPage(entry = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <DashboardPage />
    </MemoryRouter>
  );
}

describe("DashboardPage", () => {
  it("renders a package with the delivery it belongs to", async () => {
    vi.spyOn(apiClient, "listPackages").mockResolvedValue(page([row()]));

    renderPage();

    await waitFor(() => expect(screen.getByText("SHP-88291")).toBeInTheDocument());
    const table = within(screen.getByRole("table"));
    expect(table.getByText("#1042")).toBeInTheDocument();
    expect(table.getByText("ייצוא")).toBeInTheDocument();
    expect(table.getByText("נפתחה")).toBeInTheDocument();
    // Where the verdict came from — §4.4's "מקור" column.
    expect(table.getByText("אוטומטי")).toBeInTheDocument();
  });

  it("counts the operation in the stat cards, not the rows on screen", async () => {
    // One row returned, but the cards describe 1700 packages (DESIGN.md §4.4.1).
    vi.spyOn(apiClient, "listPackages").mockResolvedValue(page([row()]));

    renderPage();

    await waitFor(() => expect(screen.getByText("1700")).toBeInTheDocument());
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("900")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows an em dash for a source that does not exist yet", async () => {
    vi.spyOn(apiClient, "listPackages").mockResolvedValue(
      page([row({ workflowStatus: "SHIPPED", verdict: null, verdictSource: null })])
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("SHP-88291")).toBeInTheDocument());
    expect(within(screen.getByRole("table")).getByText("—")).toBeInTheDocument();
  });

  it("asks the server for a filter rather than narrowing on the client", async () => {
    const list = vi.spyOn(apiClient, "listPackages").mockResolvedValue(page([row()]));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(list).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "שגיאה בבדיקה" }));

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ filter: "CHECK_FAILED" }))
    );
  });

  it("searches server-side after a debounce, not per keystroke", async () => {
    const list = vi.spyOn(apiClient, "listPackages").mockResolvedValue(page([row()]));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await user.type(screen.getByRole("textbox", { name: "חיפוש חבילות" }), "SHP-88");

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: "SHP-88" }))
    );
    // One call per keystroke would be six more.
    expect(list.mock.calls.length).toBeLessThan(5);
  });

  it("restores search, filter and page from the URL", async () => {
    const list = vi.spyOn(apiClient, "listPackages").mockResolvedValue(page([row()], { total: 100 }));

    renderPage("/dashboard?search=SHP-9&filter=OPENED&page=3");

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith({ search: "SHP-9", filter: "OPENED", page: 3 })
    );
  });

  it.each(["NOPE", "ALL"])(
    "shows everything for %s rather than asking the server for a filter it rejects",
    async (value) => {
      const list = vi.spyOn(apiClient, "listPackages").mockResolvedValue(page([row()]));

      renderPage(`/dashboard?filter=${value}`);

      // ALL is the chip for "no filter", not a value the API accepts — sending
      // it produces a 400 and an error message instead of the whole list.
      await waitFor(() =>
        expect(list).toHaveBeenCalledWith({ search: undefined, filter: undefined, page: 1 })
      );
      expect(screen.queryByText("טעינת החבילות נכשלה")).not.toBeInTheDocument();
    }
  );

  it("renders no source for a verdict that has none recorded", async () => {
    vi.spyOn(apiClient, "listPackages").mockResolvedValue(
      page([row({ verdict: "OPENED", verdictSource: null })])
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("SHP-88291")).toBeInTheDocument());
    // Not "אוטומטי": no API said so, and guessing puts a claim on screen that
    // nothing in the database supports.
    expect(within(screen.getByRole("table")).getByText("—")).toBeInTheDocument();
  });

  it("sends a row to that package's evidence, not to a second photo viewer", async () => {
    vi.spyOn(apiClient, "listPackages").mockResolvedValue(page([row({ label: 3, deliveryId: "d7" })]));
    const user = userEvent.setup();

    function LocationProbe() {
      const location = useLocation();
      return <pre>{location.pathname + location.search}</pre>;
    }

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/deliveries/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("SHP-88291")).toBeInTheDocument());
    await user.click(screen.getByText("SHP-88291"));

    // The label and the origin both ride in the URL, so a refresh keeps them.
    await waitFor(() =>
      expect(screen.getByText("/deliveries/d7?package=3&from=dashboard")).toBeInTheDocument()
    );
  });

  it("offers the review action only where a verdict can still change", async () => {
    vi.spyOn(apiClient, "listPackages").mockResolvedValue(
      page([
        row({ packageId: "a", needsManagerReview: true }),
        row({ packageId: "b", verdict: "INTACT", needsManagerReview: false }),
        // A failed call has no verdict to override — retrying is what that
        // state offers, and it lives on the employee's own row (§4.2).
        row({ packageId: "c", workflowStatus: "CHECK_FAILED", verdict: null, needsManagerReview: false }),
      ])
    );

    renderPage();

    await waitFor(() => expect(screen.getAllByText("SHP-88291").length).toBe(3));
    expect(screen.getAllByRole("button", { name: "סקירה" })).toHaveLength(1);
  });

  it("sends the review action to the same evidence the row does", async () => {
    vi.spyOn(apiClient, "listPackages").mockResolvedValue(
      page([row({ label: 4, deliveryId: "d3", needsManagerReview: true })])
    );
    const user = userEvent.setup();

    function LocationProbe() {
      const location = useLocation();
      return <pre>{location.pathname + location.search}</pre>;
    }

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/deliveries/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "סקירה" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "סקירה" }));

    await waitFor(() =>
      expect(screen.getByText("/deliveries/d3?package=4&from=dashboard")).toBeInTheDocument()
    );
  });

  it("keeps the pager when a page is past the end, and drops it when there is nothing", async () => {
    const list = vi.spyOn(apiClient, "listPackages").mockResolvedValue(
      page([], { total: 100, page: 9 })
    );

    const { unmount } = renderPage("/dashboard?page=9");
    await waitFor(() => expect(screen.getByText("אין חבילות בעמוד זה.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "הקודם" })).toBeEnabled();
    unmount();

    list.mockResolvedValue(page([], { total: 0 }));
    renderPage();
    await waitFor(() => expect(screen.getByText("לא נמצאו חבילות תואמות.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "הבא" })).not.toBeInTheDocument();
  });
});
