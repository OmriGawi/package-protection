import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { PAGE_SIZE, escapeLikeWildcards } from "./deliveryQuery";

/**
 * The Inventory Manager's dashboard (DESIGN.md §4.4).
 *
 * The mirror image of §4.3: that view is one employee's deliveries, this one is
 * every package across every delivery, flattened, because triage happens across
 * the whole operation rather than inside any one delivery.
 */
export const PACKAGE_FILTERS = [
  "OPENED", // נפתחה
  "CHECK_FAILED", // שגיאה בבדיקה — the call failed, not a verdict
  "INCONCLUSIVE", // דורש בדיקה
  "PENDING", // ממתין — no verdict yet
  "INTACT", // תקינה
] as const;

export type PackageFilterKey = (typeof PACKAGE_FILTERS)[number];

export function isPackageFilter(value: string): value is PackageFilterKey {
  return (PACKAGE_FILTERS as readonly string[]).includes(value);
}

export interface PackageListRow {
  packageId: string;
  label: number;
  workflowStatus: string;
  verdict: string | null;
  verdictSource: string | null;
  needsManagerReview: boolean;
  deliveryId: string;
  deliveryInternalNumber: number;
  deliveryReference: string;
  direction: "EXPORT" | "IMPORT";
}

export interface PackageStats {
  total: number;
  opened: number;
  inconclusive: number;
  checkFailed: number;
  pending: number;
}

export interface PackagePage {
  items: PackageListRow[];
  stats: PackageStats;
  total: number;
  page: number;
  pageSize: number;
}

/**
 * §4.4.4: the review action exists only where there is a verdict a human can
 * still change. A failed call is excluded explicitly rather than relying on it
 * having no verdict: nothing today can leave a verdict on a CHECK_FAILED row,
 * but the filters and the stat cards both exclude it by workflow state, and
 * three parts of one response must not disagree if that ever changes.
 *
 * Defined once and used twice: the sort below ranks by it, and each row carries
 * it so the UI does not re-derive the same rule in TypeScript and drift.
 */
const NEEDS_REVIEW = Prisma.sql`
  p."workflowStatus" <> 'CHECK_FAILED'
  AND p."verdict" IN ('OPENED', 'INCONCLUSIVE')
  AND p."verdictSource" IS DISTINCT FROM 'MANUAL'
`;

/**
 * §4.4.3: priority, not date.
 *
 * An unreviewed OPENED outranks everything — that is where a real tamper may be
 * sitting unexamined. A failed call is an operational problem rather than a
 * verdict, so it sits just under. Anything already reviewed sinks to the bottom
 * whatever its verdict: once a human has been through it there is nothing left
 * to do, and this is what makes "all" a usable default view instead of noise.
 */
const PRIORITY_CASE = Prisma.sql`
  CASE
    WHEN p."verdict" = 'OPENED' AND ${NEEDS_REVIEW} THEN 0
    WHEN p."workflowStatus" = 'CHECK_FAILED' THEN 1
    WHEN p."verdict" = 'INCONCLUSIVE' AND ${NEEDS_REVIEW} THEN 2
    WHEN p."verdict" IS NULL THEN 3
    WHEN p."verdict" IN ('OPENED', 'INCONCLUSIVE') THEN 4
    ELSE 5
  END
`;

/**
 * A filter names the state a row is in, and those states are not all read from
 * the same column: CHECK_FAILED is a workflow state, the rest are verdicts. A
 * failed call is excluded from the verdict filters even if a stale verdict is
 * still on the row — the call is what failed, so that is what the row is.
 */
function filterClause(filter: PackageFilterKey): Prisma.Sql {
  if (filter === "CHECK_FAILED") {
    return Prisma.sql`AND p."workflowStatus" = 'CHECK_FAILED'`;
  }
  if (filter === "PENDING") {
    return Prisma.sql`AND p."verdict" IS NULL AND p."workflowStatus" <> 'CHECK_FAILED'`;
  }
  return Prisma.sql`AND p."verdict" = ${filter}::"Verdict" AND p."workflowStatus" <> 'CHECK_FAILED'`;
}

interface QueryRow extends Omit<PackageListRow, "deliveryInternalNumber"> {
  deliveryInternalNumber: number;
}

/**
 * The five stat cards (§4.4.1).
 *
 * Counted over every package, never over the returned page: the cards are a
 * fixed overview of the operation, so narrowing them with the search and filter
 * below them would make them describe the page instead of the operation.
 *
 * One pass with FILTER rather than five COUNT queries.
 */
export async function findPackageStats(
  // Accepts a transaction client so a caller can read the cards and the rows
  // under one snapshot — otherwise a package created between the two reads
  // gives cards that disagree with the table beneath them.
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<PackageStats> {
  const [row] = await client.$queryRaw<
    {
      total: bigint;
      opened: bigint;
      inconclusive: bigint;
      checkFailed: bigint;
      pending: bigint;
    }[]
  >(Prisma.sql`
    SELECT
      COUNT(*) AS "total",
      COUNT(*) FILTER (WHERE p."workflowStatus" <> 'CHECK_FAILED' AND p."verdict" = 'OPENED') AS "opened",
      COUNT(*) FILTER (WHERE p."workflowStatus" <> 'CHECK_FAILED' AND p."verdict" = 'INCONCLUSIVE') AS "inconclusive",
      COUNT(*) FILTER (WHERE p."workflowStatus" = 'CHECK_FAILED') AS "checkFailed",
      COUNT(*) FILTER (WHERE p."workflowStatus" <> 'CHECK_FAILED' AND p."verdict" IS NULL) AS "pending"
    FROM "Package" p
  `);

  return {
    total: Number(row.total),
    opened: Number(row.opened),
    inconclusive: Number(row.inconclusive),
    checkFailed: Number(row.checkFailed),
    pending: Number(row.pending),
  };
}

/** One page of packages, most urgent first. */
export async function findPackagePage({
  search,
  filter,
  page,
}: {
  search?: string;
  filter?: PackageFilterKey;
  page: number;
}): Promise<PackagePage> {
  const offset = (page - 1) * PAGE_SIZE;

  // Bound parameters stop SQL injection but not pattern injection: LIKE reads
  // % and _ inside the data as syntax, so an unescaped "%" returns everything.
  const pattern = search ? `%${escapeLikeWildcards(search)}%` : undefined;
  const searchFilter = pattern
    ? Prisma.sql`AND (
        d."referenceNumber" ILIKE ${pattern} ESCAPE '\\'
        OR CAST(d."internalNumber" AS TEXT) LIKE ${pattern} ESCAPE '\\'
      )`
    : Prisma.empty;

  const stateFilter = filter ? filterClause(filter) : Prisma.empty;

  const where = Prisma.sql`
    FROM "Package" p
    JOIN "Delivery" d ON d."id" = p."deliveryId"
    WHERE TRUE ${searchFilter} ${stateFilter}
  `;

  // Total counted separately rather than with COUNT(*) OVER(): a window
  // function rides on the returned rows, so a page past the end would report 0
  // exactly when the pager still needs the total to get back.
  // One transaction, not three independent connections: a row created between
  // the reads would otherwise produce "מציג 1–20 מתוך 19", or cards that
  // contradict the table. Same reason findDeliveryPage brackets its two reads.
  const [rows, totals, stats] = await prisma.$transaction(
    async (tx) =>
      [
        await tx.$queryRaw<QueryRow[]>(Prisma.sql`
      SELECT
        p."id" AS "packageId",
        p."label",
        p."workflowStatus"::TEXT AS "workflowStatus",
        p."verdict"::TEXT AS "verdict",
        p."verdictSource"::TEXT AS "verdictSource",
        -- COALESCE because the predicate is three-valued: a package with no
        -- verdict yet makes "verdict IN (...)" NULL, not FALSE, and the row
        -- would carry null where the API promises a boolean.
        COALESCE((${NEEDS_REVIEW}), FALSE) AS "needsManagerReview",
        d."id" AS "deliveryId",
        d."internalNumber" AS "deliveryInternalNumber",
        d."referenceNumber" AS "deliveryReference",
        d."direction"::TEXT AS "direction"
      ${where}
      ORDER BY ${PRIORITY_CASE}, d."internalNumber" DESC, p."label" ASC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `),
        await tx.$queryRaw<{ total: bigint }[]>(
          Prisma.sql`SELECT COUNT(*) AS total ${where}`,
        ),
        await findPackageStats(tx),
      ] as const,
    // RepeatableRead: the default READ COMMITTED takes a fresh snapshot per
    // statement, which is exactly the inconsistency this transaction is here to
    // prevent.
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  return {
    items: rows,
    stats,
    total: Number(totals[0].total),
    page,
    pageSize: PAGE_SIZE,
  };
}
