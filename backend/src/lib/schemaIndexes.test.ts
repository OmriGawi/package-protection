import { describe, expect, it } from "vitest";
import { prisma } from "./prisma";

/**
 * The indexes the query layer depends on, asserted against the live schema.
 *
 * Prisma does not create indexes for foreign keys on PostgreSQL, so these exist
 * only because a migration added them deliberately — and nothing else would
 * notice if one were dropped. A plan-based test would be worse than useless
 * here: on a table of a few hundred test rows Postgres correctly prefers a
 * sequential scan, so asserting on `EXPLAIN` would fail while the index is
 * doing its job in production.
 *
 * Each entry names why it exists, so a future reader can tell a deliberate
 * index from a speculative one (docs/production-readiness.md, P16).
 */
const REQUIRED_INDEXES: { table: string; index: string; why: string }[] = [
  {
    table: "Package",
    index: "Package_workflowStatus_idx",
    why: "dashboard CHECK_FAILED filter, and the startup recovery scan",
  },
  {
    table: "Package",
    index: "Package_verdict_workflowStatus_idx",
    why: "dashboard verdict filters, which always pair a verdict with a workflow predicate",
  },
  {
    table: "PackageImage",
    index: "PackageImage_packageId_sequence_idx",
    why: "every read of a package's photos: filter by package, order by sequence",
  },
  {
    table: "TamperCheck",
    index: "TamperCheck_packageId_idx",
    why: "the cascade when a delivery is deleted, and the audit-trail read",
  },
  {
    table: "TamperCheck",
    index: "TamperCheck_status_idx",
    why: "the boot-time scan for PENDING, on the one table that grows per attempt and is never pruned",
  },
];

describe("schema indexes", () => {
  it.each(REQUIRED_INDEXES)("keeps $index on $table — $why", async ({ table, index }) => {
    const found = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = ${table}
        AND indexname = ${index}
    `;

    expect(found).toHaveLength(1);
  });
});
