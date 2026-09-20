import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";

const VALID: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
};

describe("loadConfig", () => {
  it("applies the defaults the existing setup relies on", () => {
    const config = loadConfig(VALID);

    expect(config).toMatchObject({
      nodeEnv: "development",
      isProduction: false,
      port: 4000,
      corsOrigins: [],
      shutdownGraceMs: 10_000,
      jsonBodyLimit: "100kb",
    });
  });

  // Which schema a command lands in is the one thing two env files disagree
  // about, so it is derived here rather than left to whoever reads the URL.
  describe("databaseSchema", () => {
    it("reads the schema parameter when the URL names one", () => {
      const config = loadConfig({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db?schema=test_omri",
      });

      expect(config.databaseSchema).toBe("test_omri");
    });

    it("falls back to public when the URL names none", () => {
      expect(loadConfig(VALID).databaseSchema).toBe("public");
    });

    it("keeps other parameters out of it", () => {
      const config = loadConfig({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db?sslmode=disable&schema=test",
      });

      expect(config.databaseSchema).toBe("test");
    });

    // A boot log line is not a reason to refuse to start, and DATABASE_URL has
    // its own validation.
    it("reports an unparseable URL as unknown rather than throwing", () => {
      expect(loadConfig({ DATABASE_URL: "not-a-url" }).databaseSchema).toBe("unknown");
    });
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  // One restart per mistake is the slow way to find out an environment is
  // wrong in three places.
  it("reports every problem at once, not just the first", () => {
    let problems: string[] = [];
    try {
      loadConfig({ NODE_ENV: "staging", PORT: "http", SHUTDOWN_GRACE_MS: "-1" });
    } catch (error) {
      problems = (error as ConfigError).problems;
    }

    expect(problems).toHaveLength(4);
    expect(problems.join("\n")).toContain("DATABASE_URL");
    expect(problems.join("\n")).toContain("NODE_ENV");
    expect(problems.join("\n")).toContain("PORT");
    expect(problems.join("\n")).toContain("SHUTDOWN_GRACE_MS");
  });

  it("requires an explicit CORS origin in production only", () => {
    expect(() => loadConfig({ ...VALID, NODE_ENV: "production" })).toThrow(/CORS_ORIGIN/);
    expect(loadConfig({ ...VALID, NODE_ENV: "development" }).corsOrigins).toEqual([]);
  });

  // Left unset behind an ingress, req.ip is the ingress's own address and the
  // whole deployment shares one rate-limit bucket.
  it("requires TRUST_PROXY in production only", () => {
    expect(() => loadConfig({ ...VALID, NODE_ENV: "production", CORS_ORIGIN: "https://x.example" }))
      .toThrow(/TRUST_PROXY/);
    expect(loadConfig(VALID).trustProxy).toBe(false);
  });

  it("reads TRUST_PROXY as a hop count or a boolean", () => {
    expect(loadConfig({ ...VALID, TRUST_PROXY: "1" }).trustProxy).toBe(1);
    expect(loadConfig({ ...VALID, TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(loadConfig({ ...VALID, TRUST_PROXY: "false" }).trustProxy).toBe(false);
    expect(() => loadConfig({ ...VALID, TRUST_PROXY: "sometimes" })).toThrow(/TRUST_PROXY/);
  });

  // body-parser reads an unparseable limit as *no* limit, so a typo would
  // quietly remove the cap instead of failing.
  it("rejects a body limit body-parser would silently ignore", () => {
    expect(loadConfig({ ...VALID, JSON_BODY_LIMIT: "2mb" }).jsonBodyLimit).toBe("2mb");
    expect(() => loadConfig({ ...VALID, JSON_BODY_LIMIT: "100k" })).toThrow(/JSON_BODY_LIMIT/);
    expect(() => loadConfig({ ...VALID, JSON_BODY_LIMIT: "1_000_000" })).toThrow(/JSON_BODY_LIMIT/);
  });

  it("splits a comma-separated CORS_ORIGIN and drops the blanks", () => {
    const config = loadConfig({
      ...VALID,
      CORS_ORIGIN: "https://packages.example.com, https://admin.example.com , ",
    });

    expect(config.corsOrigins).toEqual([
      "https://packages.example.com",
      "https://admin.example.com",
    ]);
  });

  // The suite runs from one address and uploads dozens of times, so an
  // enabled limiter would read as flakiness rather than protection.
  it("defaults rate limiting off under test and on elsewhere", () => {
    expect(loadConfig({ ...VALID, NODE_ENV: "test" }).rateLimitEnabled).toBe(false);
    expect(
      loadConfig({
        ...VALID,
        NODE_ENV: "production",
        CORS_ORIGIN: "https://x.example",
        TRUST_PROXY: "1",
      }).rateLimitEnabled
    ).toBe(true);
    expect(loadConfig({ ...VALID, NODE_ENV: "test", RATE_LIMIT_ENABLED: "true" })
      .rateLimitEnabled).toBe(true);
  });

  // A zero deadline expires on the next tick, so every check fails and the
  // whole thing reads as a vendor outage rather than as the typo it is.
  it("refuses a tamper-check timeout of zero", () => {
    expect(() => loadConfig({ ...VALID, TAMPER_CHECK_TIMEOUT_MS: "0" })).toThrow(
      /TAMPER_CHECK_TIMEOUT_MS/
    );
    expect(loadConfig({ ...VALID, TAMPER_CHECK_TIMEOUT_MS: "1500" }).tamperCheckTimeoutMs).toBe(1500);
  });

  // A lease shorter than the call it covers has a healthy process losing its
  // own work mid-call — the same two-writers confusion the lease prevents.
  it("refuses a lease shorter than the call it covers", () => {
    expect(() =>
      loadConfig({ ...VALID, TAMPER_CHECK_TIMEOUT_MS: "30000", CHECK_LEASE_MS: "10000" })
    ).toThrow(/CHECK_LEASE_MS/);

    expect(
      loadConfig({ ...VALID, TAMPER_CHECK_TIMEOUT_MS: "30000", CHECK_LEASE_MS: "60000" })
        .checkLeaseMs
    ).toBe(60_000);
  });

  it("rejects a boolean that isn't one", () => {
    expect(() => loadConfig({ ...VALID, RATE_LIMIT_ENABLED: "yes please" })).toThrow(
      /RATE_LIMIT_ENABLED/
    );
  });
});
