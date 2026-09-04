import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import {
  MockTamperCheckClient,
  setTamperCheckClient,
  type MockOutcome,
} from "../lib/tamperCheck";
import { recoverInterruptedChecks } from "../services/tamperCheckService";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** Checks run in the background, so tests wait for the package to settle. */
async function waitForStatus(packageId: string, statuses: string[], timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: packageId } });
    if (statuses.includes(pkg.workflowStatus)) return pkg;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`package ${packageId} never reached ${statuses.join(" or ")}`);
}

/**
 * `delayMs` matters when a test asserts on the in-flight CHECKING state: with
 * an instant client the check can resolve before the route reads the package
 * back, which never happens against the real ~1.8s service.
 */
function useClient(outcome: MockOutcome, delayMs = 0) {
  setTamperCheckClient(new MockTamperCheckClient(() => outcome, delayMs));
}

/** A delivery with one shipped package carrying four pre-ship photos. */
async function shippedPackage() {
  const res = await request(app)
    .post("/api/deliveries")
    .field("direction", "EXPORT")
    .field("reference_number", "SHP-70001")
    .field("packages", JSON.stringify([{ label: 1 }]))
    .attach("package_1", PNG, "a.png")
    .attach("package_1", PNG, "b.png")
    .attach("package_1", PNG, "c.png")
    .attach("package_1", PNG, "d.png");

  expect(res.status).toBe(201);
  return res.body.packages[0].id as string;
}

function uploadReceivePhotos(packageId: string, count = 4) {
  const req = request(app).post(`/api/packages/${packageId}/post-receive-photos`);
  for (let i = 0; i < count; i++) req.attach("photos", PNG, `receive-${i}.png`);
  return req;
}

afterEach(() => {
  setTamperCheckClient(new MockTamperCheckClient());
});

describe("POST /api/packages/:id/post-receive-photos", () => {
  it("stores the photos, returns CHECKING immediately, then lands on a verdict", async () => {
    useClient("OPENED", 200);
    const packageId = await shippedPackage();

    const res = await uploadReceivePhotos(packageId);

    // 202: the check is still running, the client polls for the outcome.
    expect(res.status).toBe(202);
    expect(res.body.workflowStatus).toBe("CHECKING");
    expect(res.body.images.filter((i: { phase: string }) => i.phase === "POST_RECEIVE")).toHaveLength(4);

    const settled = await waitForStatus(packageId, ["RECEIVED"]);
    expect(settled.verdict).toBe("OPENED");
    expect(settled.verdictSource).toBe("API");

    const check = await prisma.tamperCheck.findFirstOrThrow({ where: { packageId } });
    expect(check.status).toBe("COMPLETE");
    expect(check.verdict).toBe("OPENED");
    expect(check.completedAt).not.toBeNull();
  });

  it("lands on CHECK_FAILED, with no verdict, when the call itself fails", async () => {
    useClient("CALL_FAILED");
    const packageId = await shippedPackage();

    await uploadReceivePhotos(packageId).expect(202);

    const settled = await waitForStatus(packageId, ["CHECK_FAILED"]);
    // A failed call is an operational problem, not evidence about the package.
    expect(settled.verdict).toBeNull();

    const check = await prisma.tamperCheck.findFirstOrThrow({ where: { packageId } });
    expect(check.status).toBe("ERROR");
    expect(check.verdict).toBeNull();
  });

  it("rejects fewer than four photos", async () => {
    const packageId = await shippedPackage();

    const res = await uploadReceivePhotos(packageId, 3);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 4/);
  });

  it("rejects a package that is not awaiting receipt", async () => {
    useClient("INTACT");
    const packageId = await shippedPackage();
    await uploadReceivePhotos(packageId).expect(202);
    await waitForStatus(packageId, ["RECEIVED"]);

    const res = await uploadReceivePhotos(packageId);

    expect(res.status).toBe(409);
  });

  it("returns 404 for an unknown package", async () => {
    const res = await uploadReceivePhotos("2b6b2f6e-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
  });

  it("lets only one of two simultaneous uploads through", async () => {
    useClient("INTACT", 100);
    const packageId = await shippedPackage();

    // Both requests see SHIPPED before either writes, so only the atomic claim
    // stops them both attaching photos and racing to set a verdict.
    const results = await Promise.all([uploadReceivePhotos(packageId), uploadReceivePhotos(packageId)]);
    const statuses = results.map((r) => r.status).sort();

    expect(statuses).toEqual([202, 409]);

    await waitForStatus(packageId, ["RECEIVED"]);
    const images = await prisma.packageImage.count({ where: { packageId, phase: "POST_RECEIVE" } });
    expect(images).toBe(4);
  });
});

describe("POST /api/packages/:id/tamper-check", () => {
  it("re-runs the check against the stored photos, with no re-upload", async () => {
    useClient("CALL_FAILED");
    const packageId = await shippedPackage();
    await uploadReceivePhotos(packageId).expect(202);
    await waitForStatus(packageId, ["CHECK_FAILED"]);

    useClient("INTACT");
    const res = await request(app).post(`/api/packages/${packageId}/tamper-check`);

    expect(res.status).toBe(202);
    expect(res.body.workflowStatus).toBe("CHECKING");

    const settled = await waitForStatus(packageId, ["RECEIVED"]);
    expect(settled.verdict).toBe("INTACT");

    // The retry didn't duplicate the photos it was re-checking.
    const images = await prisma.packageImage.count({ where: { packageId, phase: "POST_RECEIVE" } });
    expect(images).toBe(4);

    // Both attempts are kept, so the failure isn't erased by the retry.
    const checks = await prisma.tamperCheck.findMany({ where: { packageId } });
    expect(checks).toHaveLength(2);
  });

  it("refuses to retry a package whose check did not fail", async () => {
    const packageId = await shippedPackage();

    const res = await request(app).post(`/api/packages/${packageId}/tamper-check`);

    expect(res.status).toBe(409);
  });
});

describe("recoverInterruptedChecks", () => {
  it("frees a package stranded in CHECKING by a restart", async () => {
    const packageId = await shippedPackage();
    // A check that started but whose process died before it could resolve.
    await prisma.package.update({ where: { id: packageId }, data: { workflowStatus: "CHECKING" } });
    await prisma.tamperCheck.create({ data: { packageId, status: "PENDING" } });

    await recoverInterruptedChecks();

    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: packageId } });
    // CHECK_FAILED rather than stuck, so the existing retry button applies.
    expect(pkg.workflowStatus).toBe("CHECK_FAILED");
    const check = await prisma.tamperCheck.findFirstOrThrow({ where: { packageId } });
    expect(check.status).toBe("ERROR");
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
