import type {
  DeliveryStatusKey,
  Direction,
  Package,
  Verdict,
  WorkflowStatus,
} from "../api/client";

// Copy taken verbatim from ui/index.html's DIRECTION_TEXT / WORKFLOW_TEXT /
// VERDICT_INFO, mapped onto the schema's enum values.
export const DIRECTION_TEXT: Record<Direction, string> = {
  EXPORT: "ייצוא",
  IMPORT: "יבוא",
};

export const WORKFLOW_TEXT: Record<WorkflowStatus, string> = {
  // Not reachable yet — submitting goes straight to SHIPPED. Kept so the map
  // is total; revisit the copy if the state ever becomes user-visible.
  PRE_SHIP_UPLOADED: "תמונות שליחה הועלו",
  SHIPPED: "ממתינה לתמונות קבלה",
  CHECKING: "מבצע בדיקה…",
  RECEIVED: "התקבלה",
  CHECK_FAILED: "שגיאה בבדיקה",
};

export interface BadgeInfo {
  text: string;
  color: string;
  bg: string;
}

export const VERDICT_INFO: Record<Verdict | "PENDING", BadgeInfo> = {
  INTACT: { text: "תקינה", color: "var(--green)", bg: "var(--green-soft)" },
  OPENED: { text: "נפתחה", color: "var(--red)", bg: "var(--red-soft)" },
  INCONCLUSIVE: { text: "דורש בדיקה", color: "var(--amber)", bg: "var(--amber-soft)" },
  PENDING: { text: "ממתין", color: "var(--text-secondary)", bg: "#00000010" },
};

/** A package's result cell means the same thing everywhere it appears. */
export function verdictInfo(pkg: Pick<Package, "workflowStatus" | "verdict">): BadgeInfo {
  if (pkg.workflowStatus === "CHECK_FAILED") {
    return { text: "שגיאה בבדיקה", color: "var(--purple)", bg: "var(--purple-soft)" };
  }
  return VERDICT_INFO[pkg.verdict ?? "PENDING"];
}

/** DD.MM.YYYY, matching the mockup's fmtDate — rendered in the viewer's own timezone. */
export function formatDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * The one status a delivery row shows (DESIGN.md §4.3). Colors follow the
 * package-level meanings — including CHECK_FAILED as purple, not red, since a
 * failed call is an operational hiccup and not evidence of tampering.
 */
export const DELIVERY_STATUS_INFO: Record<DeliveryStatusKey, BadgeInfo> = {
  OPENED: { text: "חבילה נפתחה", color: "var(--red)", bg: "var(--red-soft)" },
  CHECK_FAILED: { text: "שגיאה בבדיקה", color: "var(--purple)", bg: "var(--purple-soft)" },
  INCONCLUSIVE: { text: "דורש בדיקה", color: "var(--amber)", bg: "var(--amber-soft)" },
  AWAITING_RECEIPT: { text: "ממתין לתמונות קבלה", color: "var(--blue)", bg: "var(--blue-soft)" },
  COMPLETE: { text: "הושלם", color: "var(--green)", bg: "var(--green-soft)" },
};

/** Chip order matches the priority ladder, worst first. */
export const STATUS_FILTERS: { key: DeliveryStatusKey | "ALL"; label: string }[] = [
  { key: "ALL", label: "הכל" },
  { key: "OPENED", label: DELIVERY_STATUS_INFO.OPENED.text },
  { key: "CHECK_FAILED", label: DELIVERY_STATUS_INFO.CHECK_FAILED.text },
  { key: "INCONCLUSIVE", label: DELIVERY_STATUS_INFO.INCONCLUSIVE.text },
  { key: "AWAITING_RECEIPT", label: DELIVERY_STATUS_INFO.AWAITING_RECEIPT.text },
  { key: "COMPLETE", label: DELIVERY_STATUS_INFO.COMPLETE.text },
];
