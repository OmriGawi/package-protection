import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../lib/prisma";
import { claimForCheck, startCheck } from "./tamperCheckService";
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
