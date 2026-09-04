// Stands in for the real ERP validation view (DESIGN.md §5, §9) — not
// reachable from local dev. Mirrors ui/index.html's checkErp(): format-only
// validation, plus the export-side shipment -> PO linkage auto-populate.

export type Direction = "EXPORT" | "IMPORT";

export interface ErpValidationResult {
  valid: boolean;
  linkedPoNumber?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function validateReference(
  direction: Direction,
  referenceNumber: string
): Promise<ErpValidationResult> {
  await sleep(400);

  const value = referenceNumber.trim().toUpperCase();
  const valid =
    direction === "EXPORT"
      ? value.startsWith("SHP-") && value.length >= 7
      : value.startsWith("PO-") && value.length >= 6;

  if (!valid) return { valid: false };

  if (direction === "EXPORT") {
    return { valid: true, linkedPoNumber: "PO-" + value.slice(4) };
  }
  return { valid: true };
}
