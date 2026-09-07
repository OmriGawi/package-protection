import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import { findDeliveryPage } from "./deliveryQuery";
import type { Verdict, WorkflowStatus } from "@prisma/client";

// Every delivery this suite creates shares a reference prefix, so assertions
// can scope to them and ignore whatever else the dev database holds.
const TAG = `SHP-Q${Date.now() % 100000}`;

type PackageSpec = { workflowStatus: WorkflowStatus; verdict?: Verdict };

async function delivery(suffix: string, packages: PackageSpec[]) {
  return prisma.delivery.create({
    data: {
      direction: "EXPORT",
      referenceNumber: `${TAG}-${suffix}`,
      createdBy: "query-test",
      packages: {
        create: packages.map((p, index) => ({
          label: index + 1,
          workflowStatus: p.workflowStatus,
          verdict: p.verdict ?? null,
        })),
      },
    },
  });
}

async function statusOf(referenceSuffix: string) {
  // Search is a substring match, so "-opened" would also hit
  // "-opened-beats-failed". Pin to the exact reference.
  const reference = `${TAG}-${referenceSuffix}`;
  const page = await findDeliveryPage({ search: reference, page: 1 });
  const match = page.items.filter((d) => d.referenceNumber === reference);
  expect(match).toHaveLength(1);
  return match[0].attentionStatus;
}

describe("delivery status (DESIGN.md §4.3 priority ladder)", () => {
  beforeAll(async () => {
    await Promise.all([
      delivery("complete", [{ workflowStatus: "RECEIVED", verdict: "INTACT" }]),
      delivery("awaiting", [
        { workflowStatus: "RECEIVED", verdict: "INTACT" },
        { workflowStatus: "SHIPPED" },
      ]),
      delivery("inconclusive", [{ workflowStatus: "RECEIVED", verdict: "INCONCLUSIVE" }]),
      delivery("failed", [{ workflowStatus: "CHECK_FAILED" }]),
      delivery("opened", [{ workflowStatus: "RECEIVED", verdict: "OPENED" }]),
      // Precedence: a flagged package outranks everything, including packages
      // still in transit — it must not wait for the rest of the delivery.
      delivery("opened-beats-failed", [
        { workflowStatus: "RECEIVED", verdict: "OPENED" },
        { workflowStatus: "CHECK_FAILED" },
        { workflowStatus: "SHIPPED" },
      ]),
      delivery("failed-beats-inconclusive", [
        { workflowStatus: "CHECK_FAILED" },
        { workflowStatus: "RECEIVED", verdict: "INCONCLUSIVE" },
        { workflowStatus: "SHIPPED" },
      ]),
      delivery("inconclusive-beats-awaiting", [
        { workflowStatus: "RECEIVED", verdict: "INCONCLUSIVE" },
        { workflowStatus: "SHIPPED" },
      ]),
    ]);
  });

  it.each([
    ["complete", "COMPLETE"],
    ["awaiting", "AWAITING_RECEIPT"],
    ["inconclusive", "INCONCLUSIVE"],
    ["failed", "CHECK_FAILED"],
    ["opened", "OPENED"],
  ])("derives %s as %s", async (suffix, expected) => {
    expect(await statusOf(suffix)).toBe(expected);
  });

  it.each([
    ["opened-beats-failed", "OPENED"],
    ["failed-beats-inconclusive", "CHECK_FAILED"],
    ["inconclusive-beats-awaiting", "INCONCLUSIVE"],
  ])("%s resolves to %s", async (suffix, expected) => {
    expect(await statusOf(suffix)).toBe(expected);
  });
});

describe("search, filter and paging", () => {
  it("matches the reference number case-insensitively", async () => {
    const lower = await findDeliveryPage({ search: TAG.toLowerCase(), page: 1 });
    const upper = await findDeliveryPage({ search: TAG, page: 1 });

    expect(lower.total).toBe(upper.total);
    expect(lower.total).toBeGreaterThan(0);
  });

  it("matches the internal number", async () => {
    const created = await delivery("by-number", [{ workflowStatus: "SHIPPED" }]);

    const page = await findDeliveryPage({ search: String(created.internalNumber), page: 1 });

    expect(page.items.some((d) => d.id === created.id)).toBe(true);
  });

  it("treats a search value as text, not SQL", async () => {
    // Would drop the table if the value reached the query as SQL.
    const page = await findDeliveryPage({ search: "'; DROP TABLE \"Delivery\"; --", page: 1 });

    expect(page.items).toHaveLength(0);
    expect(await prisma.delivery.count()).toBeGreaterThan(0);
  });

  it("pages without dropping or repeating rows, and keeps the total stable", async () => {
    const all = await findDeliveryPage({ search: TAG, page: 1 });
    expect(all.pageSize).toBe(20);

    const second = await findDeliveryPage({ search: TAG, page: 2 });
    expect(second.total).toBe(all.total);

    const ids = new Set([...all.items, ...second.items].map((d) => d.id));
    expect(ids.size).toBe(all.items.length + second.items.length);
  });

  it("keeps the real total on a page past the last one", async () => {
    const first = await findDeliveryPage({ search: TAG, page: 1 });
    const far = await findDeliveryPage({ search: TAG, page: 999 });

    expect(far.items).toHaveLength(0);
    // The UI still needs the total here, to say "page 999 of 1" and to
    // disable Next rather than show an unexplained blank table.
    expect(far.total).toBe(first.total);
    expect(far.total).toBeGreaterThan(0);
  });

  it("narrows to one status", async () => {
    const page = await findDeliveryPage({ search: TAG, status: "OPENED", page: 1 });

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((d) => d.attentionStatus === "OPENED")).toBe(true);
  });

  it("sorts newest first", async () => {
    const page = await findDeliveryPage({ search: TAG, page: 1 });
    const numbers = page.items.map((d) => d.internalNumber);

    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  });
});

afterAll(async () => {
  await prisma.delivery.deleteMany({ where: { referenceNumber: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("LIKE wildcards in the search term", () => {
  it("treats % as a literal, not 'match everything'", async () => {
    const withPercent = await delivery("pct-100%-off", [{ workflowStatus: "SHIPPED" }]);
    const withoutPercent = await delivery("plain", [{ workflowStatus: "SHIPPED" }]);

    const literal = await findDeliveryPage({ search: "100%-off", page: 1 });
    const bare = await findDeliveryPage({ search: "%", page: 1 });
    const everything = await findDeliveryPage({ page: 1 });

    expect(literal.items.some((d) => d.id === withPercent.id)).toBe(true);
    // "%" finds the reference that literally contains one...
    expect(bare.items.some((d) => d.id === withPercent.id)).toBe(true);
    // ...and not the whole table, which is what an unescaped wildcard gives.
    expect(bare.total).toBeLessThan(everything.total);
    expect(bare.items.some((d) => d.id === withoutPercent.id)).toBe(false);
  });

  it("treats _ as a literal, not 'any character'", async () => {
    await delivery("underscore", [{ workflowStatus: "SHIPPED" }]);

    // Would match SHP-Qnnnnn-underscore if _ still meant "any character".
    const page = await findDeliveryPage({ search: `${TAG}_underscore`, page: 1 });

    expect(page.total).toBe(0);
  });
});
