import type { WorkflowStatus } from "@prisma/client";
import { log } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { config } from "../lib/config";
import {
  TamperCheckTimeoutError,
  getTamperCheckClient,
  type TamperCheckClient,
  type TamperCheckInput,
  type TamperCheckResult,
} from "../lib/tamperCheck";

/**
 * Atomically moves a package into CHECKING, but only from one of `allowedFrom`.
 *
 * A read-then-update would let two concurrent requests both see SHIPPED and
 * both start a check, racing to write a verdict for the same package. Putting
 * the current status in the WHERE clause makes the database the arbiter:
 * exactly one caller gets `true`.
 */
export async function claimForCheck(
  packageId: string,
  allowedFrom: WorkflowStatus[]
): Promise<boolean> {
  const { count } = await prisma.package.updateMany({
    where: { id: packageId, workflowStatus: { in: allowedFrom } },
    data: { workflowStatus: "CHECKING" },
  });
  return count === 1;
}

/** Puts a claimed package back, for when the work after the claim fails. */
export async function releaseClaim(packageId: string, to: WorkflowStatus): Promise<void> {
  await prisma.package.updateMany({
    where: { id: packageId, workflowStatus: "CHECKING" },
    data: { workflowStatus: to },
  });
}

/**
 * Runs the tamper-detection call for a package already claimed as CHECKING.
 *
 * The call is started but not awaited: the request that triggers it returns
 * immediately (a persisted CHECKING state per DESIGN.md §3) and the client
 * polls for the outcome, since the real service's latency is unknown (§9) and
 * holding an HTTP request open for it would be fragile.
 *
 * Resolves once the attempt is recorded — deliberately *not* once the check
 * finishes. (It can't hand back the in-flight promise for a caller to await:
 * an async function flattens a returned promise, so awaiting it would wait for
 * the whole check and undo the point of this design.)
 */
// A check outlives the request that started it, so nothing else in the process
// knows it is running: the response is already sent and its socket is closed.
// Shutdown needs that count, or it would drain "cleanly" while killing the only
// work the grace period exists for.
const inFlight = new Set<Promise<void>>();

export function inFlightCheckCount(): number {
  return inFlight.size;
}

/** Waits for running checks, up to `timeoutMs`. Answers whether they all finished. */
export async function awaitInFlightChecks(timeoutMs: number): Promise<boolean> {
  if (inFlight.size === 0) return true;

  const timedOut = Symbol("timed-out");
  const timer = new Promise<typeof timedOut>((resolve) =>
    setTimeout(() => resolve(timedOut), timeoutMs).unref()
  );

  const result = await Promise.race([Promise.allSettled([...inFlight]), timer]);
  return result !== timedOut;
}

export async function startCheck(
  packageId: string,
  client: TamperCheckClient = getTamperCheckClient()
): Promise<void> {
  const check = await prisma.tamperCheck.create({ data: { packageId, status: "PENDING" } });

  // Left running: the request returns 202 and the client polls for the result.
  // runCheck records its own failures, so this catch is only for the unexpected
  // — it must never surface as an unhandled rejection.
  const running = runCheck(packageId, check.id, client)
    .catch((error) =>
      log.error("tamper_check_unexpected_failure", { packageId, checkId: check.id, err: error })
    )
    .finally(() => inFlight.delete(running));

  inFlight.add(running);
}

/**
 * Records an attempt that fell over *before* the call was made.
 *
 * Deliberately not used after a call returns. A failure while recording a
 * verdict leaves the attempt PENDING on purpose — the call itself succeeded, and
 * rewriting it as a failed one would throw away a real answer and send the retry
 * back to the vendor for something it has already said. That case stays with the
 * boot-time recovery, which now marks it INTERRUPTED rather than ERROR.
 *
 * Before the call there is no answer to protect, so leaving the package in
 * CHECKING — a state that offers no retry (DESIGN.md §4.2) — buys nothing.
 */
async function failCheck(packageId: string, checkId: string, error: unknown): Promise<void> {
  log.error("tamper_check_unexpected_failure", { packageId, checkId, err: error });

  try {
    await prisma.$transaction([
      prisma.tamperCheck.updateMany({
        where: { id: checkId, status: "PENDING" },
        data: {
          status: "ERROR",
          rawResponse: { error: error instanceof Error ? error.message : String(error) },
          completedAt: new Date(),
        },
      }),
      prisma.package.updateMany({
        where: { id: packageId, workflowStatus: "CHECKING" },
        data: { workflowStatus: "CHECK_FAILED" },
      }),
    ]);
  } catch (recordingError) {
    // Nothing left to try. The boot-time recovery is the backstop.
    log.error("tamper_check_failure_unrecorded", { packageId, checkId, err: recordingError });
  }
}

async function runCheck(packageId: string, checkId: string, client: TamperCheckClient): Promise<void> {
  // Guarded separately from the call below: this read can fail on its own — a
  // pool timeout, a connection reset during a failover — and until it was
  // handled, that left the package in CHECKING until the next restart.
  let images;
  try {
    images = await prisma.packageImage.findMany({
      where: { packageId },
      orderBy: { sequence: "asc" },
      select: { id: true, storagePath: true, sequence: true, phase: true },
    });
  } catch (error) {
    await failCheck(packageId, checkId, error);
    return;
  }

  // Only the call itself is guarded. If recording a *successful* result failed
  // and were caught here, a real verdict would be thrown away and marked as a
  // failed call — sending the retry back to the external service for an answer
  // it had already given.
  let result;
  try {
    result = await callWithDeadline(client, {
      packageId,
      preShip: images.filter((image) => image.phase === "PRE_SHIP"),
      postReceive: images.filter((image) => image.phase === "POST_RECEIVE"),
    });
  } catch (error) {
    // The call failed — an operational problem, not a verdict, so the package
    // gets CHECK_FAILED and keeps whatever verdict it had (§3, §4.2).
    await prisma.$transaction([
      prisma.tamperCheck.update({
        where: { id: checkId },
        data: {
          status: "ERROR",
          rawResponse: { error: error instanceof Error ? error.message : String(error) },
          completedAt: new Date(),
        },
      }),
      prisma.package.update({
        where: { id: packageId },
        data: { workflowStatus: "CHECK_FAILED" },
      }),
    ]);
    return;
  }

  await prisma.$transaction([
    prisma.tamperCheck.update({
      where: { id: checkId },
      data: {
        status: "COMPLETE",
        verdict: result.verdict,
        confidenceScore: result.confidenceScore,
        rawResponse: result.raw as object,
        completedAt: new Date(),
      },
    }),
    prisma.package.update({
      where: { id: packageId },
      data: {
        workflowStatus: "RECEIVED",
        verdict: result.verdict,
        verdictSource: "API",
      },
    }),
  ]);
}

/**
 * The call, bounded.
 *
 * Two mechanisms, deliberately: the signal lets a client abort its own request
 * and release the socket, and the race guarantees the deadline even if a client
 * ignores the signal. Without this a hung call parks the package in CHECKING
 * forever — a state with no retry button, since retry is offered only from
 * CHECK_FAILED (DESIGN.md §4.2) — and nothing short of a restart recovers it.
 *
 * A timeout is treated as a failed call, not as a verdict, so it lands on the
 * path that already exists for one.
 */
async function callWithDeadline(
  client: TamperCheckClient,
  input: TamperCheckInput
): Promise<TamperCheckResult> {
  const timeoutMs = config.tamperCheckTimeoutMs;
  const controller = new AbortController();

  let expire: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    expire = setTimeout(() => {
      // Reject first, abort second. A client that rejects straight from its own
      // abort listener would otherwise settle the race ahead of us, and the
      // stored attempt would read "aborted" rather than naming the deadline it
      // missed — which is the whole reason the timeout has its own error type.
      reject(new TamperCheckTimeoutError(timeoutMs));
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([client.check(input, { signal: controller.signal }), deadline]);
  } finally {
    clearTimeout(expire);
    // Frees a client still waiting on the signal when the call lost the race
    // for some other reason.
    controller.abort();
  }
}

/**
 * An in-process check can't survive a restart, so anything left mid-flight is
 * stranded in CHECKING forever. Recovering it to CHECK_FAILED puts it back in
 * reach of the retry button that already exists for failed calls, rather than
 * inventing a second recovery path.
 */
export async function recoverInterruptedChecks(): Promise<number> {
  const now = new Date();
  const { count } = await prisma.package.updateMany({
    where: { workflowStatus: "CHECKING" },
    data: { workflowStatus: "CHECK_FAILED" },
  });

  await prisma.tamperCheck.updateMany({
    where: { status: "PENDING" },
    data: {
      // INTERRUPTED, not ERROR: the call may well have reached the vendor and
      // succeeded, and nobody will ever know. Recording it as a failed call
      // would inflate every count of how often the service actually fails.
      status: "INTERRUPTED",
      rawResponse: { error: "interrupted by a server restart" },
      completedAt: now,
    },
  });

  return count;
}
