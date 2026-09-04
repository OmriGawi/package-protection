import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeliveriesList } from "./DeliveriesList";
import * as apiClient from "../api/client";

describe("DeliveriesList", () => {
  it("renders deliveries returned by the API", async () => {
    vi.spyOn(apiClient, "listDeliveries").mockResolvedValue([
      {
        id: "1",
        internalNumber: 1,
        direction: "EXPORT",
        referenceNumber: "SHP-84213",
        status: "SUBMITTED",
        createdBy: "local-dev-user",
        createdAt: new Date().toISOString(),
      },
    ]);

    render(<DeliveriesList refreshKey={0} />);

    await waitFor(() => expect(screen.getByText("SHP-84213")).toBeInTheDocument());
  });

  it("shows an error message instead of a silent empty list when the fetch fails", async () => {
    vi.spyOn(apiClient, "listDeliveries").mockRejectedValue(new Error("network error"));

    render(<DeliveriesList refreshKey={0} />);

    await waitFor(() => expect(screen.getByText("טעינת המשלוחים נכשלה")).toBeInTheDocument());
    expect(screen.queryByText("אין עדיין משלוחים.")).not.toBeInTheDocument();
  });
});
