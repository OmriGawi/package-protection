import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createLimiter, keyFor } from "./rateLimit";
import { requestId } from "./requestId";

function appLimitedTo(max: number, enabled = true) {
  const testApp = express();
  testApp.use(requestId);
  testApp.use(createLimiter({ name: "test", windowMs: 60_000, max, enabled }));
  testApp.get("/thing", (_req, res) => res.json({ ok: true }));
  return testApp;
}

describe("createLimiter", () => {
  it("answers 429 with a correlation id past the limit", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limited = appLimitedTo(2);

    expect((await request(limited).get("/thing")).status).toBe(200);
    expect((await request(limited).get("/thing")).status).toBe(200);

    const third = await request(limited).get("/thing");
    expect(third.status).toBe(429);
    expect(third.body).toEqual({
      error: "too many requests, try again shortly",
      request_id: expect.any(String),
    });

    warned.mockRestore();
  });

  // Off in tests and available as a switch for a local run, so the counter is
  // never paid for where it isn't wanted.
  it("is a pass-through when disabled", async () => {
    const unlimited = appLimitedTo(1, false);

    expect((await request(unlimited).get("/thing")).status).toBe(200);
    expect((await request(unlimited).get("/thing")).status).toBe(200);
    expect((await request(unlimited).get("/thing")).status).toBe(200);
  });
});

describe("keyFor", () => {
  // The one line that changes when Keycloak lands: the key becomes the token
  // subject instead of an address.
  it("keys on the caller's address", () => {
    expect(keyFor({ ip: "10.0.0.4" } as never)).toBe("10.0.0.4");
  });

  // Otherwise a client on a /64 walks its own address space for a fresh bucket.
  it("collapses an IPv6 address to its subnet", () => {
    const first = keyFor({ ip: "2001:db8:1:2:3:4:5:6" } as never);
    const second = keyFor({ ip: "2001:db8:1:2:ffff:ffff:ffff:ffff" } as never);

    expect(first).toBe(second);
  });

  it("still produces a key when the address is unknown", () => {
    expect(keyFor({ ip: undefined } as never)).toBe("unknown");
  });
});
