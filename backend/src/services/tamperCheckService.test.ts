import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../lib/prisma";
import { claimForCheck, startCheck } from "./tamperCheckService";
import { MockTamperCheckClient, type TamperCheckClient } from "../lib/tamperCheck";

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
