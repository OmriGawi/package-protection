import type { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { config } from "../lib/config";
import { log } from "../lib/logger";
import { currentRequestId } from "../lib/requestContext";

/**
 * There is no authenticated user yet (DESIGN.md §6), so the only key available
 * is the caller's address. That is a blunt instrument here: a warehouse behind
 * one NAT puts every employee on the same key, so these limits are deliberately
 * loose — enough to stop a runaway client or a held-down retry button, not
 * enough to lock a site out of its own work.
 *
 * `keyFor` is the single line that changes when Keycloak lands: the key becomes
 * the token's subject, the limits tighten, and they stop being per-site.
 *
 * The counters live in this process. With more than one instance the effective
 * limit is multiplied by the instance count — a shared store or the platform's
 * ingress is the answer there, and both wait on questions in
 * `docs/production-readiness.md` §8.
 */
export function keyFor(req: Request): string {
  // ipKeyGenerator, not req.ip directly: it normalizes IPv6 to a /64 subnet,
  // so a client cannot walk its own address space for a fresh bucket.
  return ipKeyGenerator(req.ip ?? "unknown");
}

interface LimitOptions {
  name: string;
  windowMs: number;
  max: number;
  /** Defaults to the configured value; a test overrides it to exercise a limiter. */
  enabled?: boolean;
}

export function createLimiter({
  name,
  windowMs,
  max,
  enabled = config.rateLimitEnabled,
}: LimitOptions): RequestHandler {
  // A no-op rather than a zero limit when disabled, so tests and local runs
  // don't pay for a counter they never read.
  if (!enabled) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  return rateLimit({
    windowMs,
    limit: max,
    keyGenerator: keyFor,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) => {
      log.warn("rate_limited", { limiter: name, method: req.method, path: req.path });
      res.status(429).json({
        error: "too many requests, try again shortly",
        request_id: currentRequestId(),
      });
    },
  });
}

/**
 * A backstop against a client stuck in a loop, deliberately far above what the
 * UI generates: a delivery page polls once a second while a check is running
 * (`DeliveryPackagesPage`), so a budget tight enough to feel protective would
 * be spent by a few employees watching packages rather than by an attack. The
 * write paths below are where the real limits are.
 */
export const globalLimiter = createLimiter({ name: "global", windowMs: 60_000, max: 1_200 });

/** The two multipart endpoints. One submitted delivery is one request. */
export const uploadLimiter = createLimiter({ name: "upload", windowMs: 15 * 60_000, max: 60 });

/** Retry after a failed check — the one button a manager can hold down. */
export const retryLimiter = createLimiter({ name: "retry", windowMs: 5 * 60_000, max: 20 });
