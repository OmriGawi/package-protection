import { describe, expect, it } from "vitest";
import { validateReference } from "./erpMock";

describe("validateReference", () => {
  it("accepts a well-formed export shipment number", async () => {
    const result = await validateReference("EXPORT", "SHP-84213");
    expect(result.valid).toBe(true);
  });

  it("rejects an export reference missing the SHP- prefix", async () => {
    const result = await validateReference("EXPORT", "PO-84213");
    expect(result.valid).toBe(false);
  });

  it("auto-populates the linked PO number for a valid export reference", async () => {
    const result = await validateReference("EXPORT", "shp-84213");
    expect(result.linkedPoNumber).toBe("PO-84213");
  });

  it("accepts a well-formed import PO number", async () => {
    const result = await validateReference("IMPORT", "PO-90001");
    expect(result.valid).toBe(true);
  });

  it("does not attach a linked PO number for import references", async () => {
    const result = await validateReference("IMPORT", "PO-90001");
    expect(result.linkedPoNumber).toBeUndefined();
  });

  it("rejects an import reference missing the PO- prefix", async () => {
    const result = await validateReference("IMPORT", "SHP-90001");
    expect(result.valid).toBe(false);
  });
});
