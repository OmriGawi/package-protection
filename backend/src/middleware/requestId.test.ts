import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";

describe("requestId", () => {
  it("gives every response an id", async () => {
    const response = await request(app).get("/api/health");

    expect(response.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  // The platform's ingress may already stamp one. Two ids for one request is
  // worse than none: the point is that a user's report and our logs meet at
  // the same string.
  it("reuses an inbound id rather than minting a second one", async () => {
    const response = await request(app).get("/api/health").set("x-request-id", "from-the-ingress");

    expect(response.headers["x-request-id"]).toBe("from-the-ingress");
  });

  it("mints one when the inbound header is blank", async () => {
    const response = await request(app).get("/api/health").set("x-request-id", "   ");

    expect(response.headers["x-request-id"].trim()).not.toBe("");
  });

  // The inbound value lands in a response header, in error bodies and in every
  // log line for the request, so an unusable one is replaced rather than
  // carried: it is the correlation key, and a caller should not get to bloat or
  // corrupt it.
  it("replaces an id that is too long or oddly shaped", async () => {
    const tooLong = await request(app).get("/api/health").set("x-request-id", "a".repeat(200));
    expect(tooLong.headers["x-request-id"]).not.toBe("a".repeat(200));

    const oddShape = await request(app)
      .get("/api/health")
      .set("x-request-id", "id with spaces");
    expect(oddShape.headers["x-request-id"]).not.toBe("id with spaces");
  });
});
