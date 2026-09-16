import { describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { storage } from "./storage";
import { detectImageType } from "./imageTypes";
import { SEED_MARK, seedDatabase } from "./seed";

const seededDeliveries = () =>
  prisma.delivery.findMany({
    where: { referenceNumber: { contains: SEED_MARK } },
    include: { packages: { include: { images: true, checks: true } } },
  });

describe("seedDatabase", () => {
  it("can be run repeatedly without stacking up duplicates", async () => {
    const first = await seedDatabase();
    const afterFirst = await seededDeliveries();

    const second = await seedDatabase();
    const afterSecond = await seededDeliveries();

    expect(second).toEqual(first);
    expect(afterSecond).toHaveLength(afterFirst.length);
    // The rows are new ones — re-running replaces rather than updates — so
    // compare what the data says, not the ids.
    expect(afterSecond.map((d) => d.referenceNumber).sort()).toEqual(
      afterFirst.map((d) => d.referenceNumber).sort()
    );
  });

  it("writes photos a browser could actually display", async () => {
    await seedDatabase();
    const [delivery] = await seededDeliveries();
    const image = delivery.packages[0].images[0];

    expect(detectImageType(await storage.read(image.storagePath))).toBe("image/png");
  });

  it("covers the states the screens are built around", async () => {
    await seedDatabase();
    const packages = (await seededDeliveries()).flatMap((d) => d.packages);

    expect(packages.some((p) => p.workflowStatus === "SHIPPED")).toBe(true);
    expect(packages.some((p) => p.verdict === "INTACT" && p.verdictSource === "API")).toBe(true);
    expect(packages.some((p) => p.verdict === "OPENED")).toBe(true);
    expect(packages.some((p) => p.verdictSource === "MANUAL" && p.overrideNote)).toBe(true);
    expect(packages.some((p) => p.workflowStatus === "CHECK_FAILED")).toBe(true);
  });

  it("gives a package past shipping both sets of photos, and one still in transit only its first", async () => {
    await seedDatabase();
    const packages = (await seededDeliveries()).flatMap((d) => d.packages);

    const inTransit = packages.find((p) => p.workflowStatus === "SHIPPED")!;
    const received = packages.find((p) => p.workflowStatus === "RECEIVED")!;

    expect(inTransit.images.every((i) => i.phase === "PRE_SHIP")).toBe(true);
    expect(received.images.some((i) => i.phase === "POST_RECEIVE")).toBe(true);
  });

  it("refuses to run against a production environment", async () => {
    await expect(seedDatabase(true)).rejects.toThrow(/production/);
  });
});
