import { describe, expect, it, vi } from "vitest";
import express from "express";
import multer from "multer";
import request from "supertest";
import { app } from "../app";
import { errorHandler } from "./errorHandler";
import { requestId } from "./requestId";

/** A throwing route can't be added to the real app, so this is the smallest one around it. */
function appThatThrows(error: unknown) {
  const testApp = express();
  testApp.use(requestId);
  testApp.get("/boom", async () => {
    throw error;
  });
  testApp.use(errorHandler);
  return testApp;
}

describe("errorHandler", () => {
  it("answers 500 with a correlation id and no stack", async () => {
    // The failure is expected; don't print its stack in the suite's output.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(appThatThrows(new Error("prisma exploded"))).get("/boom");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "internal server error",
      request_id: expect.any(String),
    });
    // Express's default handler puts this in the body unless NODE_ENV is
    // production, which nothing here sets.
    expect(JSON.stringify(response.body)).not.toContain("prisma exploded");
    expect(response.body).not.toHaveProperty("stack");

    // The stack goes to the log instead, which is where it is useful.
    expect(logged.mock.calls[0]?.[0]).toContain("prisma exploded");
    logged.mockRestore();
  });

  it("ties the response's id to the request's own header", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(appThatThrows(new Error("boom")))
      .get("/boom")
      .set("x-request-id", "trace-me");

    expect(response.body.request_id).toBe("trace-me");
    logged.mockRestore();
  });

  // multer signals a rejected upload by throwing, so before this handler an
  // oversized photo came back as "something broke".
  it("turns a multer size limit into 413, not 500", async () => {
    const testApp = express();
    testApp.use(requestId);
    testApp.post("/upload", multer({ limits: { fileSize: 10 } }).any(), (_req, res) => {
      res.json({ ok: true });
    });
    testApp.use(errorHandler);

    const response = await request(testApp)
      .post("/upload")
      .attach("photo", Buffer.alloc(1024), "big.jpg");

    expect(response.status).toBe(413);
    expect(response.body.error).toMatch(/photo must be under/);
  });
});

describe("client errors", () => {
  // Express's default handler read `err.status`; replacing it without reading
  // that field turned malformed input into "internal server error" — and paged
  // an operator with an `unhandled_error` log line for a typo'd request body.
  it("keeps malformed JSON a 400", async () => {
    const response = await request(app)
      .post("/api/deliveries/validate-reference")
      .set("content-type", "application/json")
      .send("{ not json");

    expect(response.status).toBe(400);
    expect(response.body.request_id).toEqual(expect.any(String));
  });

  it("keeps an over-limit JSON body a 413", async () => {
    const response = await request(app)
      .post("/api/deliveries/validate-reference")
      .set("content-type", "application/json")
      .send(JSON.stringify({ reference_number: "x".repeat(200 * 1024) }));

    expect(response.status).toBe(413);
  });
});

describe("notFound", () => {
  // The frontend's client only reads JSON, so Express's HTML error page
  // surfaced a typo'd path as an unexplained crash.
  it("answers an unknown path with JSON", async () => {
    const response = await request(app).get("/api/not-a-route");

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body.error).toContain("/api/not-a-route");
  });
});
