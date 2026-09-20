import "dotenv/config";

/**
 * The one module that reads `process.env`.
 *
 * It loads `.env` itself rather than relying on `index.ts` doing it first:
 * tests import `app` directly and never run `index.ts`, and Prisma quietly
 * loads `.env` on its own, so before this module the answer to "is the
 * environment loaded?" depended on which import happened to come first.
 *
 * Validation runs once, at import, and reports *every* problem rather than the
 * first — a misconfigured environment is usually misconfigured in more than
 * one way, and finding that out one restart at a time is the slow version.
 */

export type NodeEnv = "development" | "test" | "production";

export interface Config {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  /**
   * The Postgres schema `databaseUrl` names, or `public` where it names none.
   *
   * Derived rather than configured, and logged at boot: the suite runs against
   * `.env.test` while everything else runs against `.env`, so "which schema am
   * I pointed at?" is a question with two right answers on the same machine.
   */
  databaseSchema: string;
  storageDir: string | undefined;
  /** Allowed browser origins. Empty means "any", which only development gets. */
  corsOrigins: string[];
  /** Express's `trust proxy`: false, true, or a hop count. */
  trustProxy: boolean | number;
  rateLimitEnabled: boolean;
  /** How long a shutdown waits for in-flight requests before forcing exit. */
  shutdownGraceMs: number;
  /** How long one tamper-detection call may take before it counts as failed. */
  tamperCheckTimeoutMs: number;
  /** How long a running check is owned by the process running it. */
  checkLeaseMs: number;
  /** How often to look for checks whose lease has expired. */
  checkRecoveryIntervalMs: number;
  /** Whether this process sweeps for abandoned checks at all. */
  checkRecoveryEnabled: boolean;
  /** Largest JSON body accepted. Uploads are multipart and bounded separately. */
  jsonBodyLimit: string;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

function parseNodeEnv(raw: string | undefined, problems: string[]): NodeEnv {
  const value = raw?.trim() || "development";
  if (value === "development" || value === "test" || value === "production") {
    return value;
  }
  problems.push(`NODE_ENV must be development, test or production (got "${raw}")`);
  return "development";
}

/**
 * Reads the `schema` parameter out of a Postgres connection string.
 *
 * A URL this cannot parse is not an error here — `DATABASE_URL` is validated
 * on its own, and a boot log line is not the place to fail a startup.
 */
function parseDatabaseSchema(raw: string | undefined): string {
  if (!raw) return "unknown";
  try {
    return new URL(raw).searchParams.get("schema")?.trim() || "public";
  } catch {
    return "unknown";
  }
}

function parseInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  problems: string[],
  min = 0
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    const bound = min === 0 ? "a non-negative integer" : `an integer of at least ${min}`;
    problems.push(`${name} must be ${bound} (got "${raw}")`);
    return fallback;
  }
  return value;
}

function parseBoolean(
  name: string,
  raw: string | undefined,
  fallback: boolean,
  problems: string[]
): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  problems.push(`${name} must be true or false (got "${raw}")`);
  return fallback;
}

/**
 * `TRUST_PROXY` decides where `req.ip` comes from, which decides what the rate
 * limiter counts. Left at Express's default (false), every request behind an
 * ingress reports the ingress's own address, so the whole deployment shares one
 * bucket and one busy client throttles everybody. Required in production for
 * that reason; a hop count is the safe form, since `true` trusts an
 * `X-Forwarded-For` a client can write itself.
 */
function parseTrustProxy(
  raw: string | undefined,
  isProduction: boolean,
  problems: string[]
): boolean | number {
  const value = raw?.trim().toLowerCase();

  if (!value) {
    if (isProduction) {
      problems.push(
        "TRUST_PROXY is required in production (the number of proxies in front of this process, or false if none)"
      );
    }
    return false;
  }

  if (value === "false") return false;
  if (value === "true") return true;

  const hops = Number(value);
  if (Number.isInteger(hops) && hops >= 0) return hops;

  problems.push(`TRUST_PROXY must be true, false or a hop count (got "${raw}")`);
  return false;
}

/**
 * body-parser runs its limit through `bytes.parse`, which answers null for
 * anything outside its grammar — and a null limit means *no* limit. A typo
 * would silently remove the cap rather than fail, so the grammar is checked
 * here instead.
 */
function parseByteLimit(raw: string | undefined, fallback: string, problems: string[]): string {
  const value = raw?.trim();
  if (!value) return fallback;

  if (!/^\d+(\.\d+)?\s*(b|kb|mb|gb)$/i.test(value)) {
    problems.push(`JSON_BODY_LIMIT must be a byte size such as 100kb (got "${raw}")`);
    return fallback;
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];

  const nodeEnv = parseNodeEnv(env.NODE_ENV, problems);
  const isProduction = nodeEnv === "production";

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    problems.push("DATABASE_URL is required");
  }

  const corsOrigins = (env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  // Wildcard CORS is a development convenience. In production the browser
  // origin is known, and a wildcard would also stop working the moment auth
  // uses cookies (DESIGN.md §6).
  if (isProduction && corsOrigins.length === 0) {
    problems.push("CORS_ORIGIN is required in production (comma-separated origins)");
  }

  const config: Config = {
    nodeEnv,
    isProduction,
    port: parseInteger("PORT", env.PORT, 4000, problems),
    databaseUrl: databaseUrl ?? "",
    databaseSchema: parseDatabaseSchema(databaseUrl),
    storageDir: env.STORAGE_DIR?.trim() || undefined,
    corsOrigins,
    trustProxy: parseTrustProxy(env.TRUST_PROXY, isProduction, problems),
    // Off in tests: the suite runs from one address and uploads dozens of
    // times, so a limit would turn into flakiness rather than protection.
    rateLimitEnabled: parseBoolean("RATE_LIMIT_ENABLED", env.RATE_LIMIT_ENABLED, nodeEnv !== "test", problems),
    shutdownGraceMs: parseInteger("SHUTDOWN_GRACE_MS", env.SHUTDOWN_GRACE_MS, 10_000, problems),
    // A guess, and labelled as one: the real service's latency is an open
    // question (DESIGN.md §9). It exists so a hung call cannot park a package
    // in CHECKING forever, not because 30s is known to be right.
    // At least 1ms: a zero deadline expires on the next tick, so every check
    // fails and the whole thing reads as a total vendor outage rather than as
    // the typo it is.
    tamperCheckTimeoutMs: parseInteger(
      "TAMPER_CHECK_TIMEOUT_MS",
      env.TAMPER_CHECK_TIMEOUT_MS,
      30_000,
      problems,
      1
    ),
    checkLeaseMs: parseInteger("CHECK_LEASE_MS", env.CHECK_LEASE_MS, 120_000, problems, 1),
    checkRecoveryIntervalMs: parseInteger(
      "CHECK_RECOVERY_INTERVAL_MS",
      env.CHECK_RECOVERY_INTERVAL_MS,
      30_000,
      problems,
      1
    ),
    // Off under test for the same reason as rate limiting: a sweep firing
    // mid-suite would race the fixtures the tests just built. The suite calls
    // the sweep directly instead.
    checkRecoveryEnabled: parseBoolean(
      "CHECK_RECOVERY_ENABLED",
      env.CHECK_RECOVERY_ENABLED,
      nodeEnv !== "test",
      problems
    ),
    jsonBodyLimit: parseByteLimit(env.JSON_BODY_LIMIT, "100kb", problems),
  };

  // Twice the call, not merely more than it: the lease starts when the attempt
  // is created and the call is only part of what it covers — reading the
  // package's images comes first, and acquiring a connection to do that can
  // take seconds of its own. A lease that barely clears the call still lets a
  // healthy process lose its own work mid-attempt, which is the
  // two-writers-one-package confusion the lease exists to prevent.
  if (config.checkLeaseMs < config.tamperCheckTimeoutMs * 2) {
    problems.push(
      `CHECK_LEASE_MS (${config.checkLeaseMs}) must be at least twice TAMPER_CHECK_TIMEOUT_MS (${config.tamperCheckTimeoutMs})`
    );
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}

export const config = loadConfig();
