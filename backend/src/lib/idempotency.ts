import type { Request } from "express";

export const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * A UUID, and nothing looser.
 *
 * The key namespace is global — there is no user to scope it to yet — so a
 * memorable key is a hazard rather than a convenience: two callers that both
 * hardcode `retry-test-1` would replay each other's deliveries, and the second
 * would read back the first's reference number, packages and image ids while
 * believing it had created something. A UUID cannot collide by accident, which
 * is the only protection available before the lookup can be scoped by user
 * (docs/production-readiness.md P1).
 */
const USABLE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IDEMPOTENCY_KEY_ERROR = `${IDEMPOTENCY_HEADER} must be a UUID`;

export type IdempotencyKey =
  | { ok: true; key: string | null }
  | { ok: false };

/**
 * The submit attempt's key, or null when the caller sent none.
 *
 * Optional rather than required: a request without it behaves exactly as before
 * (docs/production-readiness.md P8), which keeps every existing caller working
 * and makes this safe to roll out before the frontend sends one. A *malformed*
 * key is rejected outright, though — silently ignoring it would hand back the
 * duplicate the caller was trying to prevent.
 */
export function readIdempotencyKey(req: Request): IdempotencyKey {
  const raw = req.get(IDEMPOTENCY_HEADER)?.trim();
  if (!raw) return { ok: true, key: null };
  if (!USABLE_KEY.test(raw)) return { ok: false };
  return { ok: true, key: raw };
}
