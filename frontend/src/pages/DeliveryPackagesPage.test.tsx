import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryPackagesPage } from "./DeliveryPackagesPage";
import * as apiClient from "../api/client";

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock");
});

beforeEach(() => {
  vi.restoreAllMocks();
});

function pkg(overrides: Partial<apiClient.Package> = {}): apiClient.Package {
  return {
    id: "p1",
    label: 1,
    workflowStatus: "SHIPPED",
    verdict: null,
    verdictSource: null,
    images: [
      { id: "i1", phase: "PRE_SHIP", sequence: 1 },
      { id: "i2", phase: "PRE_SHIP", sequence: 2 },
    ],
    ...overrides,
  };
}

function delivery(packages: apiClient.Package[]): apiClient.DeliveryDetail {
  return {
    id: "d1",
    internalNumber: 7,
    direction: "EXPORT",
    referenceNumber: "SHP-84213",
    status: "SUBMITTED",
    createdBy: "local-dev-user",
    createdAt: "2026-09-04T17:30:54.993Z",
    packages,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/deliveries/d1"]}>
      <Routes>
        <Route path="/deliveries/:id" element={<DeliveryPackagesPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const imageFiles = (count: number) =>
  Array.from({ length: count }, (_, i) => new File(["x"], `r-${i}.png`, { type: "image/png" }));

describe("DeliveryPackagesPage", () => {
  it("offers the receive-photos action only for a shipped package", async () => {
    vi.spyOn(apiClient, "getDelivery").mockResolvedValue(
      delivery([pkg(), pkg({ id: "p2", label: 2, workflowStatus: "RECEIVED", verdict: "INTACT" })])
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("חבילה 1")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "העלאת תמונות קבלה" })).toHaveLength(1);
    expect(screen.getByText("תקינה")).toBeInTheDocument();
  });

  it("gates the receive upload at four photos, then submits and shows the check running", async () => {
    const checking = pkg({ workflowStatus: "CHECKING" });
    vi.spyOn(apiClient, "getDelivery")
      .mockResolvedValueOnce(delivery([pkg()]))
      .mockResolvedValue(delivery([checking]));
    const submitSpy = vi.spyOn(apiClient, "submitPostReceivePhotos").mockResolvedValue(checking);

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("חבילה 1")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "העלאת תמונות קבלה" }));

    const submit = screen.getByRole("button", { name: "שליחה לבדיקה" });
    expect(submit).toBeDisabled();

    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, imageFiles(4));
    await waitFor(() => expect(submit).toBeEnabled());

    await user.click(submit);

    await waitFor(() => expect(submitSpy).toHaveBeenCalledWith("p1", expect.arrayContaining([expect.any(File)])));
    // The verdict isn't known yet — the row says the check is running. The
    // text appears twice by design (workflow column and result badge), matching
    // the mockup, so this asserts presence rather than uniqueness.
    await waitFor(() => expect(screen.getAllByText("מבצע בדיקה…").length).toBeGreaterThan(0));
  });

  it("polls while a check is running and opens the photos once a verdict lands", async () => {
    const getDelivery = vi
      .spyOn(apiClient, "getDelivery")
      .mockResolvedValueOnce(delivery([pkg({ workflowStatus: "CHECKING" })]))
      .mockResolvedValue(
        delivery([
          pkg({
            workflowStatus: "RECEIVED",
            verdict: "OPENED",
            images: [
              { id: "i1", phase: "PRE_SHIP", sequence: 1 },
              { id: "i3", phase: "POST_RECEIVE", sequence: 1 },
            ],
          }),
        ])
      );

    renderPage();

    await waitFor(() => expect(screen.getAllByText("מבצע בדיקה…").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText("נפתחה")).toBeInTheDocument(), { timeout: 4000 });

    // The panel opens itself, so the verdict and its evidence arrive together.
    await waitFor(() => expect(screen.getByText("תמונות בקבלה")).toBeInTheDocument());

    // Polling stops once nothing is in flight.
    const callsAfterResolve = getDelivery.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(getDelivery.mock.calls.length).toBe(callsAfterResolve);
  });

  it("retries a failed check without asking for the photos again", async () => {
    vi.spyOn(apiClient, "getDelivery").mockResolvedValue(delivery([pkg({ workflowStatus: "CHECK_FAILED" })]));
    const retrySpy = vi.spyOn(apiClient, "retryTamperCheck").mockResolvedValue(pkg({ workflowStatus: "CHECKING" }));

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getAllByText("שגיאה בבדיקה").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("button", { name: "ניסיון חוזר" }));

    expect(retrySpy).toHaveBeenCalledWith("p1");
    // No upload panel — the stored photos are re-checked as they are.
    expect(screen.queryByRole("button", { name: "שליחה לבדיקה" })).not.toBeInTheDocument();
  });

  it("does not bin photos picked for one package when another package's check resolves", async () => {
    const shipped = pkg({ id: "p1", label: 1 });
    const checking = pkg({ id: "p2", label: 2, workflowStatus: "CHECKING" });
    const resolved = pkg({ id: "p2", label: 2, workflowStatus: "RECEIVED", verdict: "INTACT" });
    vi.spyOn(apiClient, "getDelivery")
      .mockResolvedValueOnce(delivery([shipped, checking]))
      .mockResolvedValue(delivery([shipped, resolved]));

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "העלאת תמונות קבלה" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "העלאת תמונות קבלה" }));
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, imageFiles(4));
    await waitFor(() => expect(screen.getByText(/4 מתוך 4\+ מינימום/)).toBeInTheDocument());

    // Package 2's verdict lands while package 1's photos are sitting unsent.
    await waitFor(() => expect(screen.getByText("תקינה")).toBeInTheDocument(), { timeout: 4000 });

    // The upload panel is still open, with the photos still in it.
    expect(screen.getByText(/4 מתוך 4\+ מינימום/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שליחה לבדיקה" })).toBeEnabled();
  });

  it("shows both photo sets, and says so when receiving photos don't exist yet", async () => {
    vi.spyOn(apiClient, "getDelivery").mockResolvedValue(delivery([pkg()]));

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("חבילה 1")).toBeInTheDocument());
    await user.click(screen.getByText("חבילה 1"));

    expect(screen.getByText("תמונות לפני משלוח")).toBeInTheDocument();
    expect(screen.getByText("טרם הועלו תמונות קבלה")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("img")).toHaveLength(2);
  });
});
