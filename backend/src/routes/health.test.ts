import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { beginShutdown, resetShutdownForTests } from "../lib/lifecycle";

describe("health and readiness", () => {
  afterEach(() => resetShutdownForTests());

  it("reports liveness", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("reports readiness once the database answers", async () => {
    const response = await request(app).get("/api/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ready" });
  });

  // The window that matters during a deploy: still serving what it accepted,
  // but the platform should stop sending more.
  it("stops being ready the moment a shutdown begins", async () => {
    beginShutdown();

    const ready = await request(app).get("/api/ready");
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ status: "shutting_down" });

    // Liveness deliberately stays up: a draining process is not a broken one,
    // and failing this would get it killed rather than left to finish.
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
  });
});
