import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import {
  MockTamperCheckClient,
  setTamperCheckClient,
  type MockOutcome,
} from "../lib/tamperCheck";
import { reclaimExpiredChecks } from "../services/tamperCheckService";

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

describe("reclaiming an abandoned check", () => {
  it("frees a package whose check died with its process", async () => {
    const packageId = await shippedPackage();
    // A check that started, took its lease, and whose process then died.
    await prisma.package.update({ where: { id: packageId }, data: { workflowStatus: "CHECKING" } });
    await prisma.tamperCheck.create({
      data: {
        packageId,
        status: "PENDING",
        leaseOwner: "an-instance-that-is-gone",
        leaseExpiresAt: new Date(Date.now() - 1_000),
      },
    });

    await reclaimExpiredChecks(new MockTamperCheckClient(() => "INTACT", 0));

    // Reclaimed and finished rather than handed to a human to press retry.
    const pkg = await waitForStatus(packageId, ["RECEIVED"]);
    expect(pkg.verdict).toBe("INTACT");
  });
});

describe("POST /api/packages/:id/review (DESIGN.md §4.4.5)", () => {
  /** A package that has been through a check and carries a verdict. */
  async function reviewablePackage(verdict: "OPENED" | "INCONCLUSIVE" | "INTACT") {
    const packageId = await shippedPackage();
    await prisma.package.update({
      where: { id: packageId },
      data: { workflowStatus: "RECEIVED", verdict, verdictSource: "API" },
    });
    return packageId;
  }

  it("resolves an inconclusive result in either direction", async () => {
    // The whole reason INCONCLUSIVE exists is that the algorithm could not
    // decide, so the physical check has to be able to land on either verdict.
    for (const verdict of ["INTACT", "OPENED"] as const) {
      const packageId = await reviewablePackage("INCONCLUSIVE");

      const response = await request(app)
        .post(`/api/packages/${packageId}/review`)
        .send({ verdict, note: "נבדק פיזית במחסן" })
        .expect(200);

      expect(response.body.verdict).toBe(verdict);
      expect(response.body.verdictSource).toBe("MANUAL");
      expect(response.body.overrideNote).toBe("נבדק פיזית במחסן");
      expect(response.body.overriddenAt).not.toBeNull();
      expect(response.body.verdictOverriddenBy).toBeTruthy();
    }
  });

  it("requires a note, since it is the only record of what was found", async () => {
    const packageId = await reviewablePackage("OPENED");

    await request(app)
      .post(`/api/packages/${packageId}/review`)
      .send({ verdict: "INTACT" })
      .expect(400);

    // Whitespace is not a note.
    await request(app)
      .post(`/api/packages/${packageId}/review`)
      .send({ verdict: "INTACT", note: "   " })
      .expect(400);

    const unchanged = await prisma.package.findUniqueOrThrow({ where: { id: packageId } });
    expect(unchanged.verdictSource).toBe("API");
  });

  it("rejects a verdict that is not one of the two outcomes", async () => {
    const packageId = await reviewablePackage("OPENED");

    // INCONCLUSIVE is what a human is resolving, not something they can choose.
    await request(app)
      .post(`/api/packages/${packageId}/review`)
      .send({ verdict: "INCONCLUSIVE", note: "n" })
      .expect(400);
  });

  it("refuses a package with no verdict to override", async () => {
    // Still in transit: never checked, so there is nothing to correct.
    const shipped = await shippedPackage();
    await request(app)
      .post(`/api/packages/${shipped}/review`)
      .send({ verdict: "INTACT", note: "n" })
      .expect(409);

    // A failed call has no verdict either — that state offers a retry (§4.2).
    const failed = await shippedPackage();
    await prisma.package.update({
      where: { id: failed },
      data: { workflowStatus: "CHECK_FAILED" },
    });
    await request(app)
      .post(`/api/packages/${failed}/review`)
      .send({ verdict: "INTACT", note: "n" })
      .expect(409);
  });

  it("404s for a package that does not exist", async () => {
    await request(app)
      .post("/api/packages/00000000-0000-0000-0000-000000000000/review")
      .send({ verdict: "INTACT", note: "n" })
      .expect(404);
  });

  it("takes the reviewed package out of the dashboard's review queue", async () => {
    const packageId = await reviewablePackage("OPENED");
    const created = await prisma.package.findUniqueOrThrow({
      where: { id: packageId },
      include: { delivery: true },
    });

    await request(app)
      .post(`/api/packages/${packageId}/review`)
      .send({ verdict: "OPENED", note: "אכן נפתחה" })
      .expect(200);

    // Searched by internal number rather than read off page 1: a reviewed
    // package deliberately sinks to the bottom of the priority ladder, so
    // scanning the first page finds nothing and asserts nothing. The reference
    // is no good either — several deliveries share one, so the match spills
    // past a page.
    const dashboard = await request(app)
      .get(`/api/packages?search=${created.delivery.internalNumber}`)
      .expect(200);

    const row = dashboard.body.items.find(
      (item: { packageId: string }) => item.packageId === packageId
    );
    // Confirming the verdict rather than reversing it still ends the review:
    // a human has been through it, so there is nothing left to do (§4.4.3).
    expect(row).toBeDefined();
    expect(row.needsManagerReview).toBe(false);
    expect(row.verdictSource).toBe("MANUAL");
  });

  it("refuses a second review rather than overwriting the first note", async () => {
    const packageId = await reviewablePackage("OPENED");

    await request(app)
      .post(`/api/packages/${packageId}/review`)
      .send({ verdict: "INTACT", note: "הבדיקה הראשונה" })
      .expect(200);

    await request(app)
      .post(`/api/packages/${packageId}/review`)
      .send({ verdict: "OPENED", note: "ניסיון לדרוס" })
      .expect(409);

    // The note is the only record of what the first physical check found.
    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: packageId } });
    expect(pkg.overrideNote).toBe("הבדיקה הראשונה");
    expect(pkg.verdict).toBe("INTACT");
  });

  it("refuses to review a result that is already resolved", async () => {
    // INTACT has nothing left to decide (§4.4.3), and the dashboard offers no
    // review action for it — the API must not accept one either.
    const packageId = await reviewablePackage("INTACT");

    await request(app)
      .post(`/api/packages/${packageId}/review`)
      .send({ verdict: "OPENED", note: "n" })
      .expect(409);
  });
});

describe("GET /api/packages (dashboard, DESIGN.md §4.4)", () => {
  it("returns a page of packages with the operation-wide stats beside it", async () => {
    const response = await request(app).get("/api/packages").expect(200);

    expect(response.body).toMatchObject({
      page: 1,
      pageSize: 20,
      total: expect.any(Number),
      stats: {
        total: expect.any(Number),
        opened: expect.any(Number),
        inconclusive: expect.any(Number),
        checkFailed: expect.any(Number),
        pending: expect.any(Number),
      },
    });
    expect(Array.isArray(response.body.items)).toBe(true);

    // The cards describe the operation, so they cannot be smaller than a page.
    expect(response.body.stats.total).toBeGreaterThanOrEqual(response.body.items.length);
  });

  it("carries the delivery each package belongs to, since the row links there", async () => {
    const response = await request(app).get("/api/packages").expect(200);
    if (response.body.items.length === 0) return;

    expect(response.body.items[0]).toMatchObject({
      packageId: expect.any(String),
      label: expect.any(Number),
      deliveryId: expect.any(String),
      deliveryInternalNumber: expect.any(Number),
      deliveryReference: expect.any(String),
      needsManagerReview: expect.any(Boolean),
    });
  });

  it("rejects a filter it does not have, rather than serving everything", async () => {
    // Silently ignoring a typo'd filter looks exactly like one that matched
    // nothing — a wrong answer that reads as a right one.
    const response = await request(app).get("/api/packages?filter=NOPE").expect(400);
    expect(response.body.error).toMatch(/filter must be one of/);
  });

  it("answers a repeated query parameter with 400, not 500", async () => {
    // Express 5 hands back an array here; .trim() on it would throw.
    await request(app).get("/api/packages?search=a&search=b").expect(400);
    await request(app).get("/api/packages?page=1&page=2").expect(400);
  });

  it("rejects a page that is not a positive integer", async () => {
    await request(app).get("/api/packages?page=abc").expect(400);
    await request(app).get("/api/packages?page=0").expect(400);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
