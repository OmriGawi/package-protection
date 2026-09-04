import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DeliveryDetailsCard } from "./DeliveryDetailsCard";
import * as apiClient from "../api/client";

/** Mirrors how CreateDeliveryPage drives the card, so typing actually works. */
function Harness({ onValidityChange = () => {} }: { onValidityChange?: (valid: boolean) => void }) {
  const [direction, setDirection] = useState<apiClient.Direction>("EXPORT");
  const [referenceNumber, setReferenceNumber] = useState("");
  return (
    <DeliveryDetailsCard
      direction={direction}
      referenceNumber={referenceNumber}
      onDirectionChange={setDirection}
      onReferenceNumberChange={setReferenceNumber}
      onValidityChange={onValidityChange}
    />
  );
}

describe("DeliveryDetailsCard", () => {
  it("reports a validated reference and shows the ERP-linked PO number", async () => {
    vi.spyOn(apiClient, "validateReference").mockResolvedValue({ valid: true, linked_po_number: "PO-84213" });
    const onValidityChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValidityChange={onValidityChange} />);

    await user.type(screen.getByPlaceholderText("SHP-88291"), "SHP-84213");

    await waitFor(() => expect(screen.getByText("אומת מול ה-ERP")).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText("PO-84213")).toBeInTheDocument();
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });

  it("reports an invalid reference", async () => {
    vi.spyOn(apiClient, "validateReference").mockResolvedValue({ valid: false });
    const onValidityChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValidityChange={onValidityChange} />);

    await user.type(screen.getByPlaceholderText("SHP-88291"), "XYZ");

    await waitFor(() => expect(screen.getByText("לא נמצא ב-ERP — בדקו את המספר")).toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("ignores a stale validation response for a reference the user has since changed", async () => {
    let resolveFirst!: (value: apiClient.ValidateReferenceResult) => void;
    const firstCall = new Promise<apiClient.ValidateReferenceResult>((resolve) => {
      resolveFirst = resolve;
    });
    vi.spyOn(apiClient, "validateReference")
      .mockImplementationOnce(() => firstCall)
      .mockResolvedValueOnce({ valid: false });

    const onValidityChange = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<Harness onValidityChange={onValidityChange} />);
    const input = screen.getByPlaceholderText("SHP-88291");

    await user.type(input, "SHP-11111");
    await waitFor(() => expect(screen.getByText("בודק מול ה-ERP…")).toBeInTheDocument(), { timeout: 2000 });

    await user.clear(input);
    await user.type(input, "SHP-99999");
    await waitFor(() => expect(screen.getByText("לא נמצא ב-ERP — בדקו את המספר")).toBeInTheDocument(), {
      timeout: 2000,
    });

    resolveFirst({ valid: true, linked_po_number: "PO-11111" });
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByText("לא נמצא ב-ERP — בדקו את המספר")).toBeInTheDocument();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });
});
