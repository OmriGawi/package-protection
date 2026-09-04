import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma";

// A tiny but real PNG, so mime-type checks and the image route have actual
// bytes to work with.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function submitDelivery(packages: { label: number; photos: number }[], overrides?: { direction?: string; reference?: string }) {
  const req = request(app)
    .post("/api/deliveries")
    .field("direction", overrides?.direction ?? "EXPORT")
    .field("reference_number", overrides?.reference ?? "SHP-31337")
    .field("packages", JSON.stringify(packages.map((p) => ({ label: p.label }))));

  for (const pkg of packages) {
    for (let i = 0; i < pkg.photos; i++) {
      req.attach(`package_${pkg.label}`, PNG, `photo-${i}.png`);
    }
  }
  return req;
}

describe("POST /api/deliveries/validate-reference", () => {
  it("returns valid: true for a well-formed export reference", async () => {
    const res = await request(app)
      .post("/api/deliveries/validate-reference")
      .send({ direction: "EXPORT", reference_number: "SHP-11111" });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.linked_po_number).toBe("PO-11111");
  });

  it("returns 400 when direction is missing", async () => {
    const res = await request(app)
      .post("/api/deliveries/validate-reference")
      .send({ reference_number: "SHP-11111" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/deliveries", () => {
  it("creates a delivery with its packages and pre-ship photos", async () => {
    const res = await submitDelivery([
      { label: 1, photos: 4 },
      { label: 2, photos: 5 },
    ]);

    expect(res.status).toBe(201);
    expect(res.body.referenceNumber).toBe("SHP-31337");
    expect(res.body.packages).toHaveLength(2);

    const [first, second] = res.body.packages.sort((a: { label: number }, b: { label: number }) => a.label - b.label);
    expect(first.label).toBe(1);
    expect(first.workflowStatus).toBe("SHIPPED");
    expect(first.verdict).toBeNull();
    expect(first.images).toHaveLength(4);
    expect(first.images.every((img: { phase: string }) => img.phase === "PRE_SHIP")).toBe(true);
    expect(second.images).toHaveLength(5);
  });

  it("keeps non-contiguous labels as sent, since they are written on the boxes", async () => {
    const res = await submitDelivery([
      { label: 1, photos: 4 },
      { label: 3, photos: 4 },
    ]);

    expect(res.status).toBe(201);
    expect(res.body.packages.map((p: { label: number }) => p.label).sort()).toEqual([1, 3]);
  });

  it("rejects a delivery with no packages", async () => {
    const res = await request(app)
      .post("/api/deliveries")
      .field("direction", "EXPORT")
      .field("reference_number", "SHP-31337")
      .field("packages", "[]");

    expect(res.status).toBe(400);
  });

  it("rejects a package with fewer than four photos", async () => {
    const res = await submitDelivery([{ label: 1, photos: 3 }]);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 4 photos/);
  });

  it("rejects duplicate labels within one delivery", async () => {
    const res = await submitDelivery([
      { label: 1, photos: 4 },
      { label: 1, photos: 4 },
    ]);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unique/);
  });

  it("rejects a non-image file", async () => {
    const res = await request(app)
      .post("/api/deliveries")
      .field("direction", "EXPORT")
      .field("reference_number", "SHP-31337")
      .field("packages", JSON.stringify([{ label: 1 }]))
      .attach("package_1", PNG, "a.png")
      .attach("package_1", PNG, "b.png")
      .attach("package_1", PNG, "c.png")
      .attach("package_1", Buffer.from("not an image"), { filename: "notes.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/image file/);
  });

  // An SVG passes a naive image/* check but can carry script, and an iPhone's
  // default HEIC can't be rendered by Chrome or Firefox — both would store
  // fine and then come back as unviewable evidence.
  it.each([
    ["image/svg+xml", "logo.svg"],
    ["image/heic", "IMG_0042.heic"],
  ])("rejects %s, which the viewer could not display", async (contentType, filename) => {
    const res = await request(app)
      .post("/api/deliveries")
      .field("direction", "EXPORT")
      .field("reference_number", "SHP-31337")
      .field("packages", JSON.stringify([{ label: 1 }]))
      .attach("package_1", PNG, "a.png")
      .attach("package_1", PNG, "b.png")
      .attach("package_1", PNG, "c.png")
      .attach("package_1", Buffer.from("<svg/>"), { filename, contentType });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/image file/);
  });

  it("rejects a non-image lying about its Content-Type", async () => {
    const res = await request(app)
      .post("/api/deliveries")
      .field("direction", "EXPORT")
      .field("reference_number", "SHP-31337")
      .field("packages", JSON.stringify([{ label: 1 }]))
      .attach("package_1", PNG, "a.png")
      .attach("package_1", PNG, "b.png")
      .attach("package_1", PNG, "c.png")
      // An SVG claiming to be a PNG — trusting the header would store it and
      // then serve it back from our origin as an image.
      .attach("package_1", Buffer.from('<svg onload="alert(1)"/>'), {
        filename: "evil.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/image file/);
  });

  it("returns 400, not 500, for a malformed packages array", async () => {
    const res = await request(app)
      .post("/api/deliveries")
      .field("direction", "EXPORT")
      .field("reference_number", "SHP-31337")
      .field("packages", "[null]");

    expect(res.status).toBe(400);
  });

  it("does not expose the internal storage path", async () => {
    const res = await submitDelivery([{ label: 1, photos: 4 }]);

    expect(res.status).toBe(201);
    expect(res.body.packages[0].images[0]).not.toHaveProperty("storagePath");
    expect(JSON.stringify(res.body)).not.toContain("storagePath");
  });

  it("names the stored file from its detected type, not the uploaded filename", async () => {
    const res = await request(app)
      .post("/api/deliveries")
      .field("direction", "EXPORT")
      .field("reference_number", "SHP-31337")
      .field("packages", JSON.stringify([{ label: 1 }]))
      .attach("package_1", PNG, { filename: "../../escape.php", contentType: "image/png" })
      .attach("package_1", PNG, "b.png")
      .attach("package_1", PNG, "c.png")
      .attach("package_1", PNG, "d.png");

    expect(res.status).toBe(201);
    const storagePaths = await prisma.packageImage
      .findMany({ where: { packageId: res.body.packages[0].id } })
      .then((images) => images.map((image) => image.storagePath));
    expect(storagePaths.every((p) => p.endsWith(".png"))).toBe(true);
    expect(storagePaths.some((p) => p.includes("escape"))).toBe(false);
  });

  it("rejects a reference that fails ERP validation", async () => {
    const res = await submitDelivery([{ label: 1, photos: 4 }], { reference: "NOT-A-SHIPMENT" });

    expect(res.status).toBe(422);
  });
});

describe("GET /api/deliveries and /api/deliveries/:id", () => {
  it("rejects an unknown status instead of quietly listing everything", async () => {
    const res = await request(app).get("/api/deliveries?status=SLIGHTLY_OPENED");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be one of/);
  });

  it.each(["0", "-1", "abc"])("rejects page=%s", async (page) => {
    const res = await request(app).get(`/api/deliveries?page=${page}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/page must be/);
  });

  it("returns a page envelope, not a bare array", async () => {
    const res = await request(app).get("/api/deliveries");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20 });
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeLessThanOrEqual(20);
    expect(typeof res.body.total).toBe("number");
  });

  it("lists deliveries with their package count and serves the detail with images", async () => {
    const created = await submitDelivery([{ label: 1, photos: 4 }]);
    expect(created.status).toBe(201);

    const listRes = await request(app).get(
      `/api/deliveries?search=${created.body.referenceNumber}`
    );
    expect(listRes.status).toBe(200);
    const listed = listRes.body.items.find((d: { id: string }) => d.id === created.body.id);
    expect(listed.packageCount).toBe(1);

    const detailRes = await request(app).get(`/api/deliveries/${created.body.id}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.packages[0].images).toHaveLength(4);
  });

  it("returns 404 for an unknown delivery", async () => {
    const res = await request(app).get("/api/deliveries/2b6b2f6e-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/images/:id", () => {
  it("serves the stored bytes back", async () => {
    const created = await submitDelivery([{ label: 1, photos: 4 }]);
    const imageId = created.body.packages[0].images[0].id;

    const res = await request(app).get(`/api/images/${imageId}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/png/);
    expect(Buffer.from(res.body)).toEqual(PNG);
  });

  it("returns 404 for an unknown image", async () => {
    const res = await request(app).get("/api/images/2b6b2f6e-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/deliveries query validation", () => {
  it("rejects a repeated parameter instead of 500ing on it", async () => {
    // Express 5 hands a repeated param over as an array.
    const res = await request(app).get("/api/deliveries?search=a&search=b");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most once/);
  });
});
