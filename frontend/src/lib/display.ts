import type { Direction, Package, Verdict, WorkflowStatus } from "../api/client";

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
