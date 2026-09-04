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

  it("shows an error and does not notify the parent when submit fails", async () => {
    vi.spyOn(apiClient, "validateReference").mockResolvedValue({ valid: true });
    vi.spyOn(apiClient, "createDelivery").mockRejectedValue(new Error("reference_number failed ERP validation"));
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<CreateDelivery onCreated={onCreated} />);

    await user.type(screen.getByPlaceholderText(/מספר משלוח/), "SHP-84213");
    await waitFor(() => expect(screen.getByRole("button", { name: "שליחה" })).toBeEnabled(), {
      timeout: 2000,
    });

    await user.click(screen.getByRole("button", { name: "שליחה" }));

    await waitFor(() =>
      expect(screen.getByText("reference_number failed ERP validation")).toBeInTheDocument()
    );
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("ignores a stale validation response for a reference the user has since changed", async () => {
    let resolveFirst!: (value: apiClient.ValidateReferenceResult) => void;
    const firstCall = new Promise<apiClient.ValidateReferenceResult>((resolve) => {
      resolveFirst = resolve;
    });
    vi.spyOn(apiClient, "validateReference")
      .mockImplementationOnce(() => firstCall)
      .mockResolvedValueOnce({ valid: false });

    const user = userEvent.setup({ delay: null });
    render(<CreateDelivery onCreated={() => {}} />);
    const input = screen.getByPlaceholderText(/מספר משלוח/);

    await user.type(input, "SHP-11111");
    await waitFor(() => expect(screen.getByText("בודק מול ה-ERP…")).toBeInTheDocument(), {
      timeout: 2000,
    });

    await user.clear(input);
    await user.type(input, "SHP-99999");
    await waitFor(() => expect(screen.getByText("לא נמצא ב-ERP — בדקו את המספר")).toBeInTheDocument(), {
      timeout: 2000,
    });

    // The first (stale) call now resolves as valid — it must not override
    // the already-rendered invalid state for the current input.
    resolveFirst({ valid: true, linked_po_number: "PO-11111" });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("לא נמצא ב-ERP — בדקו את המספר")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שליחה" })).toBeDisabled();
  });
});
