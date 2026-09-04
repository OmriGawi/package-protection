import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreateDelivery } from "./CreateDelivery";
import * as apiClient from "../api/client";

describe("CreateDelivery", () => {
  it("shows the valid state and enables submit once the reference validates", async () => {
    vi.spyOn(apiClient, "validateReference").mockResolvedValue({ valid: true, linked_po_number: "PO-84213" });
    const user = userEvent.setup();
    render(<CreateDelivery onCreated={() => {}} />);

    await user.type(screen.getByPlaceholderText(/מספר משלוח/), "SHP-84213");

    await waitFor(() => expect(screen.getByText("אומת מול ה-ERP")).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByRole("button", { name: "שליחה" })).toBeEnabled();
    expect(screen.getByText(/PO-84213/)).toBeInTheDocument();
  });

  it("shows the invalid state and keeps submit disabled for a bad reference", async () => {
    vi.spyOn(apiClient, "validateReference").mockResolvedValue({ valid: false });
    const user = userEvent.setup();
    render(<CreateDelivery onCreated={() => {}} />);

    await user.type(screen.getByPlaceholderText(/מספר משלוח/), "XYZ");

    await waitFor(
      () => expect(screen.getByText("לא נמצא ב-ERP — בדקו את המספר")).toBeInTheDocument(),
      { timeout: 2000 }
    );
    expect(screen.getByRole("button", { name: "שליחה" })).toBeDisabled();
  });

  it("submits and notifies the parent once validated", async () => {
    vi.spyOn(apiClient, "validateReference").mockResolvedValue({ valid: true });
    const createSpy = vi.spyOn(apiClient, "createDelivery").mockResolvedValue({
      id: "1",
      internalNumber: 1,
      direction: "EXPORT",
      referenceNumber: "SHP-84213",
      status: "SUBMITTED",
      createdBy: "local-dev-user",
      createdAt: new Date().toISOString(),
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<CreateDelivery onCreated={onCreated} />);

    await user.type(screen.getByPlaceholderText(/מספר משלוח/), "SHP-84213");
    await waitFor(() => expect(screen.getByRole("button", { name: "שליחה" })).toBeEnabled(), {
      timeout: 2000,
    });

    await user.click(screen.getByRole("button", { name: "שליחה" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(createSpy).toHaveBeenCalledWith("EXPORT", "SHP-84213");
  });
});
