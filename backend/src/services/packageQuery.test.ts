import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import { findPackagePage, findPackageStats } from "./packageQuery";
import { Prisma } from "@prisma/client";
import type { Verdict, VerdictSource, WorkflowStatus } from "@prisma/client";

// Every delivery this suite creates shares a reference prefix, so assertions can
// scope to them and ignore whatever else the dev database holds.
const TAG = `SHP-P${Date.now() % 100000}`;

type PackageSpec = {
  workflowStatus: WorkflowStatus;
  verdict?: Verdict;
  verdictSource?: VerdictSource;
};

async function delivery(suffix: string, packages: PackageSpec[]) {
  return prisma.delivery.create({
    data: {
      direction: "EXPORT",
      referenceNumber: `${TAG}-${suffix}`,
      createdBy: "package-query-test",
      packages: {
        create: packages.map((p, index) => ({
          label: index + 1,
          workflowStatus: p.workflowStatus,
          verdict: p.verdict ?? null,
          verdictSource: p.verdictSource ?? null,
        })),
      },
    },
  });
}

/** Scoped to this suite's rows: the dev database holds plenty of others. */
async function rows(options: Parameters<typeof findPackagePage>[0] = { page: 1 }) {
  const result = await findPackagePage({ search: TAG, ...options });
  return result.items;
}

beforeAll(async () => {
  await Promise.all([
    delivery("opened", [{ workflowStatus: "RECEIVED", verdict: "OPENED" }]),
    delivery("failed", [{ workflowStatus: "CHECK_FAILED" }]),
    delivery("inconclusive", [{ workflowStatus: "RECEIVED", verdict: "INCONCLUSIVE" }]),
    delivery("pending", [{ workflowStatus: "SHIPPED" }]),
    delivery("intact", [{ workflowStatus: "RECEIVED", verdict: "INTACT" }]),
    // Already reviewed by a human: nothing left to do, whatever the verdict.
    delivery("reviewed", [
      { workflowStatus: "RECEIVED", verdict: "OPENED", verdictSource: "MANUAL" },
    ]),
  ]);
});

afterAll(async () => {
  await prisma.delivery.deleteMany({ where: { referenceNumber: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("dashboard priority order (DESIGN.md §4.4.3)", () => {
  it("ranks by urgency, not by date", async () => {
    const order = (await rows()).map((row) => row.deliveryReference.replace(`${TAG}-`, ""));

    expect(order).toEqual([
      "opened", // unreviewed OPENED — a real tamper may be sitting unexamined
      "failed", // an operational problem, not a verdict
      "inconclusive", // the algorithm could not decide
      "pending", // no verdict yet
      "reviewed", // a human has been through it
      "intact",
    ]);
  });

  it("sinks a reviewed OPENED below a package still waiting for its verdict", async () => {
    const order = (await rows()).map((row) => row.deliveryReference);

    // The whole point of the ladder: "already handled" outranks "worst verdict".
    expect(order.indexOf(`${TAG}-reviewed`)).toBeGreaterThan(order.indexOf(`${TAG}-pending`));
  });

  it("marks only unreviewed verdicts as needing the manager", async () => {
    const byReference = new Map((await rows()).map((row) => [row.deliveryReference, row]));

    expect(byReference.get(`${TAG}-opened`)?.needsManagerReview).toBe(true);
    expect(byReference.get(`${TAG}-inconclusive`)?.needsManagerReview).toBe(true);
    // Reviewed, intact, and a failed call are all outside the review action:
    // there is no verdict left for a human to change.
    expect(byReference.get(`${TAG}-reviewed`)?.needsManagerReview).toBe(false);
    expect(byReference.get(`${TAG}-intact`)?.needsManagerReview).toBe(false);
    expect(byReference.get(`${TAG}-failed`)?.needsManagerReview).toBe(false);
  });
});

describe("dashboard filters", () => {
  it.each([
    ["OPENED", "opened"],
    ["CHECK_FAILED", "failed"],
    ["INCONCLUSIVE", "inconclusive"],
    ["PENDING", "pending"],
    ["INTACT", "intact"],
  ] as const)("%s returns only its own rows", async (filter, suffix) => {
    const matches = await rows({ page: 1, filter });

    // "reviewed" is also verdict OPENED, so the OPENED filter returns two.
    const references = matches.map((row) => row.deliveryReference);
    expect(references).toContain(`${TAG}-${suffix}`);
    for (const row of matches) {
      if (filter === "CHECK_FAILED") expect(row.workflowStatus).toBe("CHECK_FAILED");
      else if (filter === "PENDING") expect(row.verdict).toBeNull();
      else expect(row.verdict).toBe(filter);
    }
  });

  it("keeps a failed call out of the verdict filters", async () => {
    for (const filter of ["OPENED", "INCONCLUSIVE", "INTACT", "PENDING"] as const) {
      const matches = await rows({ page: 1, filter });
      expect(matches.map((row) => row.workflowStatus)).not.toContain("CHECK_FAILED");
    }
  });
});

describe("dashboard search", () => {
  it("matches on the delivery's reference and internal number", async () => {
    const created = await prisma.delivery.findFirst({
      where: { referenceNumber: `${TAG}-opened` },
    });

    const byNumber = await findPackagePage({ search: String(created!.internalNumber), page: 1 });
    expect(byNumber.items.some((row) => row.deliveryId === created!.id)).toBe(true);
  });

  it("escapes LIKE wildcards instead of matching everything", async () => {
    // Bound parameters stop SQL injection but not pattern injection: unescaped,
    // this would return the whole table.
    //
    // Asserted as "finds the literal, and not everything" rather than "returns
    // nothing": the sibling delivery suite creates its own reference containing
    // a real % and runs in parallel, so a zero here was never true to begin
    // with — it only passed when this file happened to run first.
    const withPercent = await delivery("pct-50%-off", [{ workflowStatus: "SHIPPED" }]);

    const bare = await findPackagePage({ search: "%", page: 1 });
    const everything = await findPackagePage({ page: 1 });

    expect(bare.items.some((row) => row.deliveryId === withPercent.id)).toBe(true);
    expect(bare.total).toBeLessThan(everything.total);
    expect(bare.items.some((row) => row.deliveryReference === `${TAG}-opened`)).toBe(false);
  });
});

describe("dashboard stats (DESIGN.md §4.4.1)", () => {
  it("counts the operation, not the page", async () => {
    // Narrowed hard: this suite's own rows, and only the opened ones.
    const filtered = await findPackagePage({ search: TAG, filter: "OPENED", page: 1 });

    // Asserted as relationships within one response rather than by comparing
    // two separate reads: the suites run in parallel against one database, so
    // "these two snapshots are equal" is not a property this code has.
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.stats.total).toBeGreaterThan(filtered.total);
    expect(filtered.stats.total).toBeGreaterThan(filtered.items.length);

    // The cards count states the filter excluded entirely, which they could not
    // do if they described the page.
    expect(filtered.stats.pending).toBeGreaterThan(0);
    expect(filtered.stats.checkFailed).toBeGreaterThan(0);
  });

  it("counts each state once, with a failed call outside the verdict tallies", async () => {
    // Both reads inside one transaction. The suites run in parallel against the
    // same dev database, so two independent reads see different row counts and
    // the comparison fails perhaps half the time — which is exactly what it did.
    const [stats, packages] = await prisma.$transaction(
      async (tx) =>
        [
          await findPackageStats(tx),
          await tx.package.findMany({ select: { workflowStatus: true, verdict: true } }),
        ] as const,
      // RepeatableRead, not the default: READ COMMITTED takes a fresh snapshot
      // per statement, so the two reads still disagreed inside one transaction.
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );

    const failed = packages.filter((p) => p.workflowStatus === "CHECK_FAILED");
    const verdicts = packages.filter((p) => p.workflowStatus !== "CHECK_FAILED");

    expect(stats.total).toBe(packages.length);
    expect(stats.checkFailed).toBe(failed.length);
    expect(stats.opened).toBe(verdicts.filter((p) => p.verdict === "OPENED").length);
    expect(stats.inconclusive).toBe(verdicts.filter((p) => p.verdict === "INCONCLUSIVE").length);
    expect(stats.pending).toBe(verdicts.filter((p) => p.verdict === null).length);
  });
});

describe("failedAttempts", () => {
  // A package that has burned several calls is a different problem from one
  // that failed once, and nothing else on the row says so. Deliberately a
  // count and not a cap: CHECK_FAILED has no verdict for a manager to override
  // (§4.4.4), so blocking further retries would leave it nowhere to go.
  it("counts the attempts that ended in a failed call", async () => {
    const created = await delivery("attempts", [{ workflowStatus: "CHECK_FAILED" }]);
    const { id: packageId } = await prisma.package.findFirstOrThrow({
      where: { deliveryId: created.id },
    });

    await prisma.tamperCheck.createMany({
      data: [
        { packageId, status: "ERROR" },
        { packageId, status: "ERROR" },
        // None of these is a failed call: one is still running, one produced a
        // verdict, and the last was cut off by a restart — the vendor may well
        // have answered it.
        { packageId, status: "PENDING" },
        { packageId, status: "COMPLETE", verdict: "INTACT" },
        { packageId, status: "INTERRUPTED" },
      ],
    });

    const page = await findPackagePage({ search: `${TAG}-attempts`, page: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].failedAttempts).toBe(2);
  });

  it("reports zero for a package that has never failed a call", async () => {
    await delivery("clean", [{ workflowStatus: "RECEIVED", verdict: "INTACT", verdictSource: "API" }]);

    const page = await findPackagePage({ search: `${TAG}-clean`, page: 1 });

    expect(page.items[0].failedAttempts).toBe(0);
  });
});
