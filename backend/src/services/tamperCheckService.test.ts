import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../lib/prisma";
import { claimForCheck, reclaimExpiredChecks, startCheck } from "./tamperCheckService";
import { MockTamperCheckClient, type TamperCheckClient } from "../lib/tamperCheck";
import { config } from "../lib/config";

async function shippedPackage() {
  const delivery = await prisma.delivery.create({
    data: {
      direction: "EXPORT",
      referenceNumber: "SHP-88888",
      createdBy: "test",
      packages: { create: { label: 1, workflowStatus: "SHIPPED" } },
    },
    include: { packages: true },
  });
  return delivery.packages[0].id;
}

async function waitForStatus(packageId: string, statuses: string[], timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: packageId } });
    if (statuses.includes(pkg.workflowStatus)) return pkg;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`package never reached ${statuses.join(" or ")}`);
}

describe("claimForCheck", () => {
  it("lets exactly one concurrent caller claim the package", async () => {
    const packageId = await shippedPackage();

    const claims = await Promise.all([
      claimForCheck(packageId, ["SHIPPED"]),
      claimForCheck(packageId, ["SHIPPED"]),
      claimForCheck(packageId, ["SHIPPED"]),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("refuses to claim from a status that isn't allowed", async () => {
    const packageId = await shippedPackage();

    expect(await claimForCheck(packageId, ["CHECK_FAILED"])).toBe(false);
  });
});

describe("startCheck", () => {
  it("keeps a verdict that arrived, even if recording it fails on the first try", async () => {
    const packageId = await shippedPackage();
    await claimForCheck(packageId, ["SHIPPED"]);

    // The call succeeds; recording it briefly fails. The verdict must not be
    // rewritten as a failed call — that would discard a real answer and send
    // the retry back to the external service for something it already said.
    const client: TamperCheckClient = new MockTamperCheckClient(() => "OPENED", 0);
    const transaction = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("database hiccup"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await startCheck(packageId, client);
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled(), { timeout: 2000 });

    const check = await prisma.tamperCheck.findFirstOrThrow({
      where: { packageId },
      orderBy: { requestedAt: "desc" },
    });
    // Still PENDING rather than mislabelled ERROR: the call itself never failed.
    expect(check.status).toBe("PENDING");

    transaction.mockRestore();
    consoleError.mockRestore();
  });

  it("records a failed call as ERROR with no verdict", async () => {
    const packageId = await shippedPackage();
    await claimForCheck(packageId, ["SHIPPED"]);

    await startCheck(packageId, new MockTamperCheckClient(() => "CALL_FAILED", 0));

    const pkg = await waitForStatus(packageId, ["CHECK_FAILED"]);
    expect(pkg.verdict).toBeNull();
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the call's deadline", () => {
  // Without this the package sits in CHECKING forever: retry is offered only
  // from CHECK_FAILED (DESIGN.md §4.2), so a hung vendor left no way out short
  // of restarting the process.
  it("fails a call that outlives the deadline, and offers the retry", async () => {
    const packageId = await shippedPackage();
    await claimForCheck(packageId, ["SHIPPED"]);

    const original = config.tamperCheckTimeoutMs;
    config.tamperCheckTimeoutMs = 40;
    try {
      // Far longer than the deadline, and it honours the signal — so this
      // exercises the abort as well as the caller giving up.
      await startCheck(packageId, new MockTamperCheckClient(() => "INTACT", 5_000));
      await waitForStatus(packageId, ["CHECK_FAILED"]);
    } finally {
      config.tamperCheckTimeoutMs = original;
    }

    const check = await prisma.tamperCheck.findFirstOrThrow({
      where: { packageId },
      orderBy: { requestedAt: "desc" },
    });
    expect(check.status).toBe("ERROR");
    expect(check.verdict).toBeNull();
    expect(JSON.stringify(check.rawResponse)).toMatch(/exceeded 40ms/);
  });

  it("leaves a call that finishes in time alone", async () => {
    const packageId = await shippedPackage();
    await claimForCheck(packageId, ["SHIPPED"]);

    await startCheck(packageId, new MockTamperCheckClient(() => "INTACT", 0));
    const pkg = await waitForStatus(packageId, ["RECEIVED"]);

    expect(pkg.verdict).toBe("INTACT");
  });
});

describe("an attempt that falls over outside the call", () => {
  // The deadline bounds the vendor call, but runCheck reads the package's
  // images first. If that read fails, nothing was marking the package
  // CHECK_FAILED — so it sat in CHECKING, which offers no retry (DESIGN.md
  // §4.2), until a restart cleared it.
  it("hands the package back rather than leaving it in CHECKING", async () => {
    const packageId = await shippedPackage();
    await claimForCheck(packageId, ["SHIPPED"]);

    const findMany = vi
      .spyOn(prisma.packageImage, "findMany")
      .mockRejectedValueOnce(new Error("connection reset during failover"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await startCheck(packageId, new MockTamperCheckClient(() => "INTACT", 0));
    await waitForStatus(packageId, ["CHECK_FAILED"]);

    const check = await prisma.tamperCheck.findFirstOrThrow({
      where: { packageId },
      orderBy: { requestedAt: "desc" },
    });
    expect(check.status).toBe("ERROR");
    expect(JSON.stringify(check.rawResponse)).toMatch(/connection reset/);

    findMany.mockRestore();
    logged.mockRestore();
  });
});

/** A check that started and whose owner then stopped running. */
async function abandonedCheck(options: { expiredAgoMs?: number; recoveryAttempts?: number } = {}) {
  const packageId = await shippedPackage();
  await prisma.package.update({ where: { id: packageId }, data: { workflowStatus: "CHECKING" } });
  const check = await prisma.tamperCheck.create({
    data: {
      packageId,
      status: "PENDING",
      leaseOwner: "an-instance-that-is-gone",
      leaseExpiresAt: new Date(Date.now() - (options.expiredAgoMs ?? 1_000)),
      recoveryAttempts: options.recoveryAttempts ?? 0,
    },
  });
  return { packageId, checkId: check.id };
}

const instant = () => new MockTamperCheckClient(() => "INTACT", 0);

/**
 * These assert on the rows each test created, never on what a sweep returned:
 * the sweep works across the whole table, and test files run in parallel
 * against one shared database (see CLAUDE.md), so any count is somebody else's
 * business too.
 */
describe("reclaimExpiredChecks", () => {
  // The sweep takes a bounded window of the oldest expired leases. Runs before
  // this one leave abandoned PENDING rows behind — that is what an abandoned
  // check is — and enough of them would fill the window before reaching the row
  // a test just created, so the test would fail on somebody else's leftovers.
  // Retiring them first is also what the sweep would eventually do to them.
  beforeAll(async () => {
    await prisma.tamperCheck.updateMany({
      where: { status: "PENDING", requestedAt: { lt: new Date() } },
      data: {
        status: "INTERRUPTED",
        rawResponse: { error: "left behind by an earlier test run" },
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  });

  it("finishes a check whose owner stopped running", async () => {
    const { packageId, checkId } = await abandonedCheck();

    await reclaimExpiredChecks(instant());

    const pkg = await waitForStatus(packageId, ["RECEIVED"]);
    expect(pkg.verdict).toBe("INTACT");
    const check = await prisma.tamperCheck.findUniqueOrThrow({ where: { id: checkId } });
    expect(check.status).toBe("COMPLETE");
    // Released, or the next sweep would pick up finished work.
    expect(check.leaseOwner).toBeNull();
    expect(check.leaseExpiresAt).toBeNull();
  });

  // The bug this whole change exists for: the old boot sweep took every package
  // in CHECKING, so a second instance starting declared a running check dead and
  // the two then wrote different answers for one package.
  it("leaves a check whose lease is still live alone", async () => {
    const packageId = await shippedPackage();
    await prisma.package.update({ where: { id: packageId }, data: { workflowStatus: "CHECKING" } });
    const check = await prisma.tamperCheck.create({
      data: {
        packageId,
        status: "PENDING",
        leaseOwner: "the-instance-still-running-it",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    await reclaimExpiredChecks(instant());

    const after = await prisma.tamperCheck.findUniqueOrThrow({ where: { id: check.id } });
    expect(after.status).toBe("PENDING");
    expect(after.leaseOwner).toBe("the-instance-still-running-it");
    expect(after.recoveryAttempts).toBe(0);
    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: packageId } });
    expect(pkg.workflowStatus).toBe("CHECKING");
  });

  it("is claimed by exactly one of two sweeps racing for it", async () => {
    const { checkId } = await abandonedCheck();

    await Promise.all([reclaimExpiredChecks(instant()), reclaimExpiredChecks(instant())]);

    // One increment, not two: the losing sweep found the row already taken.
    // Asserted on the row rather than on how many each sweep reclaimed — the
    // sweep counts every expired lease in the table, including rows other test
    // files are creating at the same time.
    const check = await prisma.tamperCheck.findUniqueOrThrow({ where: { id: checkId } });
    expect(check.recoveryAttempts).toBe(1);
  });

  // A check that takes its process down every time it runs would otherwise be
  // picked up forever by each instance in turn.
  it("gives up past the attempt cap, leaving the retry to a human", async () => {
    const { packageId, checkId } = await abandonedCheck({ recoveryAttempts: 3 });

    await reclaimExpiredChecks(instant());

    const check = await prisma.tamperCheck.findUniqueOrThrow({ where: { id: checkId } });
    expect(check.status).toBe("INTERRUPTED");
    expect(check.leaseOwner).toBeNull();
    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: packageId } });
    // CHECK_FAILED is the state the retry button already reaches (§4.2).
    expect(pkg.workflowStatus).toBe("CHECK_FAILED");
  });

  it("does not re-run a check for a package that has moved on", async () => {
    const { packageId, checkId } = await abandonedCheck();
    await prisma.package.update({
      where: { id: packageId },
      data: { workflowStatus: "RECEIVED", verdict: "INTACT", verdictSource: "API" },
    });

    await reclaimExpiredChecks(instant());

    const check = await prisma.tamperCheck.findUniqueOrThrow({ where: { id: checkId } });
    expect(check.status).toBe("INTERRUPTED");
    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: packageId } });
    expect(pkg.workflowStatus).toBe("RECEIVED");
  });

  it("leases the checks it starts, so an abandoned one is findable", async () => {
    const packageId = await shippedPackage();
    await claimForCheck(packageId, ["SHIPPED"]);

    await startCheck(packageId, new MockTamperCheckClient(() => "INTACT", 5_000));

    const check = await prisma.tamperCheck.findFirstOrThrow({
      where: { packageId },
      orderBy: { requestedAt: "desc" },
    });
    expect(check.leaseOwner).toEqual(expect.any(String));
    expect(check.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  // A lease that has run out is one thing; a lease that was never written is
  // another. Every check already in flight when the lease columns were added
  // has a NULL one, and NULL is not less-than anything in SQL — filtering on
  // the date alone would hide exactly the rows the deleted boot sweep rescued.
  it("reclaims a check that has no lease at all", async () => {
    const packageId = await shippedPackage();
    await prisma.package.update({ where: { id: packageId }, data: { workflowStatus: "CHECKING" } });
    await prisma.tamperCheck.create({
      data: { packageId, status: "PENDING", leaseOwner: null, leaseExpiresAt: null },
    });

    await reclaimExpiredChecks(instant());

    const pkg = await waitForStatus(packageId, ["RECEIVED"]);
    expect(pkg.verdict).toBe("INTACT");
  });
});

describe("a result from a superseded owner", () => {
  // The lease decides who starts work; this is what stops a process that was
  // paused past its lease from finishing it. Writing by id alone would bury a
  // manager's override — verdictSource back to API, note orphaned — which is
  // the two-writers-one-package outcome the lease exists to prevent.
  it("is discarded rather than written over a reclaimed package", async () => {
    const packageId = await shippedPackage();
    await claimForCheck(packageId, ["SHIPPED"]);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Slow enough that the reclaim below lands while the call is in flight.
    await startCheck(packageId, new MockTamperCheckClient(() => "INTACT", 300));
    const check = await prisma.tamperCheck.findFirstOrThrow({
      where: { packageId },
      orderBy: { requestedAt: "desc" },
    });

    // Another instance took it over and finished it, and a manager has since
    // ruled on the package by hand.
    await prisma.tamperCheck.update({
      where: { id: check.id },
      data: { leaseOwner: "another-instance" },
    });
    await prisma.package.update({
      where: { id: packageId },
      data: {
        workflowStatus: "RECEIVED",
        verdict: "OPENED",
        verdictSource: "MANUAL",
        overrideNote: "נבדק פיזית",
      },
    });

    await vi.waitFor(() => expect(warned).toHaveBeenCalled(), { timeout: 3000 });

    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: packageId } });
    expect(pkg.verdictSource).toBe("MANUAL");
    expect(pkg.verdict).toBe("OPENED");
    expect(pkg.overrideNote).toBe("נבדק פיזית");
    const after = await prisma.tamperCheck.findUniqueOrThrow({ where: { id: check.id } });
    expect(after.status).toBe("PENDING");

    warned.mockRestore();
  });
});
