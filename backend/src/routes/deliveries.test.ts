import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma";

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

describe("POST /api/deliveries + GET /api/deliveries", () => {
  it("creates a delivery and returns it in the list", async () => {
    const createRes = await request(app)
      .post("/api/deliveries")
      .send({ direction: "IMPORT", reference_number: "po-22222" });

    expect(createRes.status).toBe(201);
    expect(createRes.body.direction).toBe("IMPORT");
    // Stored uppercased regardless of input casing.
    expect(createRes.body.referenceNumber).toBe("PO-22222");
    expect(typeof createRes.body.internalNumber).toBe("number");

    const listRes = await request(app).get("/api/deliveries");
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((d: { id: string }) => d.id === createRes.body.id)).toBe(true);
  });

  it("rejects a create request with an invalid direction", async () => {
    const res = await request(app)
      .post("/api/deliveries")
      .send({ direction: "SIDEWAYS", reference_number: "PO-1" });

    expect(res.status).toBe(400);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
