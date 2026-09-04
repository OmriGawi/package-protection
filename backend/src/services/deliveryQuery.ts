import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

/**
 * The one status a delivery row shows (DESIGN.md §4.3).
 *
 * Deliberately a single value, not a workflow state plus a package-health
 * state: two badges force the reader to combine them mentally ("partially
 * received + needs review — is that worse than shipped + all good?"). This is
 * always the most urgent true thing about the delivery.
 */
export const DELIVERY_STATUSES = [
  "OPENED", // חבילה נפתחה — go inspect now
  "CHECK_FAILED", // שגיאה בבדיקה — the API call failed, not a verdict
  "INCONCLUSIVE", // דורש בדיקה — manual check needed
  "AWAITING_RECEIPT", // ממתין לתמונות קבלה — not every package received yet
  "COMPLETE", // הושלם — all checked, all intact
] as const;

export type DeliveryStatusKey = (typeof DELIVERY_STATUSES)[number];

export function isDeliveryStatus(value: string): value is DeliveryStatusKey {
  return (DELIVERY_STATUSES as readonly string[]).includes(value);
}

export const PAGE_SIZE = 20;

export interface DeliveryListRow {
  id: string;
  internalNumber: number;
  direction: "EXPORT" | "IMPORT";
  referenceNumber: string;
  createdAt: Date;
  packageCount: number;
  attentionStatus: DeliveryStatusKey;
}

export interface DeliveryPage {
  items: DeliveryListRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Raw shape from Postgres: COUNT() arrives as bigint, not number. */
interface QueryRow extends Omit<DeliveryListRow, "packageCount"> {
  packageCount: bigint;
}

/**
 * The §4.3 priority ladder, as SQL.
 *
 * Order matters and is not the same as "worst verdict": an OPENED or a failed
 * call outranks INCONCLUSIVE *even while other packages are still in transit*,
 * because an opened package doesn't wait for the rest of the delivery to
 * arrive before it matters.
 *
 * No branch for a delivery with zero packages: one cannot exist. Submitting is
 * what creates a delivery, and it rejects an empty one (§3, enforced in the
 * create route since Slice 2). A COUNT-based fallback here would invent a
 * sixth status for a state the domain doesn't have.
 */
const STATUS_CASE = Prisma.sql`
  CASE
    WHEN COUNT(*) FILTER (WHERE p."verdict" = 'OPENED') > 0 THEN 'OPENED'
    WHEN COUNT(*) FILTER (WHERE p."workflowStatus" = 'CHECK_FAILED') > 0 THEN 'CHECK_FAILED'
    WHEN COUNT(*) FILTER (WHERE p."verdict" = 'INCONCLUSIVE') > 0 THEN 'INCONCLUSIVE'
    -- Anything not yet RECEIVED counts here, CHECKING included. §4.3's trigger
    -- is literally "not every package received yet", and it defines exactly
    -- five statuses — adding a sixth for the ~2s a check is in flight would
    -- expand the design unilaterally. A mid-check package can't be uploaded
    -- to twice anyway: the detail page only offers upload on SHIPPED.
    WHEN COUNT(*) FILTER (WHERE p."workflowStatus" <> 'RECEIVED') > 0 THEN 'AWAITING_RECEIPT'
    ELSE 'COMPLETE'
  END
`;

/** Makes %, _ and the escape character itself literal inside a LIKE pattern. */
function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * One page of deliveries, newest first.
 *
 * Filtering, sorting and paging all happen in Postgres. The status is an
 * aggregate over each delivery's packages, so filtering by it means computing
 * it first — hence the derived table and the HAVING-style outer filter rather
 * than a plain WHERE.
 */
export async function findDeliveryPage({
  search,
  status,
  page,
}: {
  search?: string;
  status?: DeliveryStatusKey;
  page: number;
}): Promise<DeliveryPage> {
  const offset = (page - 1) * PAGE_SIZE;

  // Every value is a bound parameter. Interpolating `search` into the SQL text
  // would be an injection hole; Prisma.sql keeps it a placeholder.
  //
  // The wildcards still need escaping even so: a bound parameter is data, but
  // LIKE reads % and _ inside that data as pattern syntax, so searching "%"
  // would match every row and "_" would match far too many.
  const pattern = search ? `%${escapeLikeWildcards(search)}%` : undefined;
  const searchFilter = pattern
    ? Prisma.sql`AND (
        d."referenceNumber" ILIKE ${pattern} ESCAPE '\\'
        OR CAST(d."internalNumber" AS TEXT) LIKE ${pattern} ESCAPE '\\'
      )`
    : Prisma.empty;

  const statusFilter = status ? Prisma.sql`WHERE s."attentionStatus" = ${status}` : Prisma.empty;

  const summarized = Prisma.sql`
    SELECT
      d."id",
      d."internalNumber",
      d."direction",
      d."referenceNumber",
      d."createdAt",
      COUNT(p."id") AS "packageCount",
      ${STATUS_CASE} AS "attentionStatus"
    FROM "Delivery" d
    JOIN "Package" p ON p."deliveryId" = d."id"
    WHERE TRUE ${searchFilter}
    GROUP BY d."id"
  `;

  // Counted separately rather than with COUNT(*) OVER(): a window function
  // rides on the returned rows, so a page past the end returns none and the
  // total would come back 0 — exactly when the UI still needs it to say
  // "page 9 of 5" and disable Next.
  const [rows, totals] = await prisma.$transaction([
    prisma.$queryRaw<QueryRow[]>(Prisma.sql`
      WITH summarized AS (${summarized})
      SELECT s.* FROM summarized s
      ${statusFilter}
      ORDER BY s."internalNumber" DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `),
    prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      WITH summarized AS (${summarized})
      SELECT COUNT(*) AS total FROM summarized s
      ${statusFilter}
    `),
  ]);

  return {
    // COUNT() comes back as bigint, which JSON.stringify refuses to serialize.
    items: rows.map(({ packageCount, ...row }) => ({
      ...row,
      packageCount: Number(packageCount),
    })),
    total: Number(totals[0].total),
    page,
    pageSize: PAGE_SIZE,
  };
}
