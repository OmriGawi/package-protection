import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateDeliveryPage } from "./CreateDeliveryPage";
import * as apiClient from "../api/client";

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock");
});

beforeEach(() => {
  vi.spyOn(apiClient, "validateReference").mockResolvedValue({ valid: true, linked_po_number: "PO-84213" });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <CreateDeliveryPage />
    </MemoryRouter>
  );
}

const submitButton = () => screen.getByRole("button", { name: "שליחת המשלוח" });

async function validateReferenceNumber(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("SHP-88291"), "SHP-84213");
  await waitFor(() => expect(screen.getByText("אומת מול ה-ERP")).toBeInTheDocument(), { timeout: 2000 });
}

async function addPackage(user: ReturnType<typeof userEvent.setup>) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(
    input,
    Array.from({ length: 4 }, (_, i) => new File(["x"], `photo-${i}.png`, { type: "image/png" }))
  );
  await user.click(screen.getByRole("button", { name: "שמירת חבילה והוספת הבאה" }));
}

describe("CreateDeliveryPage", () => {
  it("keeps submit disabled until the reference is valid and at least one package exists", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(submitButton()).toBeDisabled();

    await validateReferenceNumber(user);
    // A validated reference alone isn't a delivery — it needs packages.
    expect(submitButton()).toBeDisabled();

    await addPackage(user);
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  it("submits the delivery with its packages and their photos", async () => {
    const createSpy = vi.spyOn(apiClient, "createDelivery").mockResolvedValue({
      id: "d1",
      internalNumber: 1,
      direction: "EXPORT",
      referenceNumber: "SHP-84213",
      status: "SUBMITTED",
      createdBy: "local-dev-user",
      createdAt: new Date().toISOString(),
      packages: [],
    });
    const user = userEvent.setup();
    renderPage();

    await validateReferenceNumber(user);
    await addPackage(user);
    await user.click(submitButton());

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    const [direction, reference, packages] = createSpy.mock.calls[0];
    expect(direction).toBe("EXPORT");
    expect(reference).toBe("SHP-84213");
    expect(packages).toHaveLength(1);
    expect(packages[0].label).toBe(1);
    expect(packages[0].photos).toHaveLength(4);
  });

  it("surfaces a failed submit instead of silently doing nothing", async () => {
    vi.spyOn(apiClient, "createDelivery").mockRejectedValue(new Error("package 1 needs at least 4 photos"));
    const user = userEvent.setup();
    renderPage();

    await validateReferenceNumber(user);
    await addPackage(user);
    await user.click(submitButton());

    await waitFor(() => expect(screen.getByText("package 1 needs at least 4 photos")).toBeInTheDocument());
  });

  // The failure this guards: a slow upload commits on the server and still
  // fails on the way back. A fresh key on the retry would file the same
  // physical boxes twice.
  it("retries a failed submit under the same idempotency key", async () => {
    const createSpy = vi
      .spyOn(apiClient, "createDelivery")
      .mockRejectedValue(new Error("הרשת נכשלה"));
    const user = userEvent.setup();
    renderPage();

    await validateReferenceNumber(user);
    await addPackage(user);

    await user.click(submitButton());
    await waitFor(() => expect(screen.getByText("הרשת נכשלה")).toBeInTheDocument());
    await user.click(submitButton());
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(2));

    const [firstKey, secondKey] = createSpy.mock.calls.map((call) => call[3]);
    expect(firstKey).toEqual(expect.any(String));
    expect(secondKey).toBe(firstKey);
  });

  it("hands the new delivery to the list so it can be pointed out there", async () => {
    vi.spyOn(apiClient, "createDelivery").mockResolvedValue({
      id: "d9",
      internalNumber: 353,
      direction: "EXPORT",
      referenceNumber: "SHP-84213",
      status: "SUBMITTED",
      createdBy: "local-dev-user",
      createdAt: new Date().toISOString(),
      packages: [
        {
          id: "p1",
          label: 1,
          workflowStatus: "SHIPPED",
          verdict: null,
          verdictSource: null,
          verdictOverriddenBy: null,
          overriddenAt: null,
          overrideNote: null,
          images: [],
        },
        {
          id: "p2",
          label: 2,
          workflowStatus: "SHIPPED",
          verdict: null,
          verdictSource: null,
          verdictOverriddenBy: null,
          overriddenAt: null,
          overrideNote: null,
          images: [],
        },
      ],
    });

    function StateProbe() {
      const location = useLocation();
      return <pre>{JSON.stringify(location.state)}</pre>;
    }

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/deliveries/new"]}>
        <Routes>
          <Route path="/deliveries/new" element={<CreateDeliveryPage />} />
          <Route path="/deliveries" element={<StateProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await validateReferenceNumber(user);
    await addPackage(user);
    await user.click(submitButton());

    await waitFor(() =>
      expect(screen.getByText(/"id":"d9"/)).toBeInTheDocument()
    );
    // The count comes from what the server actually persisted, not the draft.
    expect(screen.getByText(/"packageCount":2/)).toBeInTheDocument();
    expect(screen.getByText(/"internalNumber":353/)).toBeInTheDocument();
  });

  it("refuses to send while photos sit unsaved, rather than dropping them", async () => {
    const createSpy = vi.spyOn(apiClient, "createDelivery");
    const user = userEvent.setup();
    renderPage();

    await validateReferenceNumber(user);
    await addPackage(user);
    expect(submitButton()).toBeEnabled();

    // A second package photographed but never saved — the exact case that used
    // to submit one package and bin the other four photos.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(
      input,
      Array.from({ length: 4 }, (_, i) => new File(["x"], `second-${i}.png`, { type: "image/png" }))
    );

    expect(await screen.findByText(/יש חבילה שטרם נשמרה/)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    await user.click(submitButton());
    expect(createSpy).not.toHaveBeenCalled();

    // Saving it clears the block and the package goes with the delivery.
    await user.click(screen.getByRole("button", { name: "שמירת חבילה והוספת הבאה" }));
    await waitFor(() => expect(screen.queryByText(/יש חבילה שטרם נשמרה/)).not.toBeInTheDocument());
    expect(submitButton()).toBeEnabled();
  });

  it("tells an editing employee to finish the edit, not to save a new package", async () => {
    const user = userEvent.setup();
    renderPage();

    await validateReferenceNumber(user);
    await addPackage(user);
    expect(submitButton()).toBeEnabled();

    // Reopening a saved package loads its photos into the same upload area.
    await user.click(screen.getByText("חבילה 1"));

    expect(await screen.findByText(/חבילה נמצאת בעריכה/)).toBeInTheDocument();
    expect(screen.queryByText(/יש חבילה שטרם נשמרה/)).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "ביטול עריכה" }));
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });
});
