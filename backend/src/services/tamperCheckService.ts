import { Prisma, type WorkflowStatus } from "@prisma/client";
import { log } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { config } from "../lib/config";
import { INSTANCE_ID } from "../lib/instance";
import { isShuttingDown } from "../lib/lifecycle";
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

/** A lease held by this process, expiring far enough out to cover the call. */
function heldByThisProcess() {
  return {
    leaseOwner: INSTANCE_ID,
    leaseExpiresAt: new Date(Date.now() + config.checkLeaseMs),
  };
}

/** No owner: a finished attempt is nobody's to reclaim. */
const RELEASED = { leaseOwner: null, leaseExpiresAt: null } as const;

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
  const check = await prisma.tamperCheck.create({
    data: { packageId, status: "PENDING", ...heldByThisProcess() },
  });

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
 * verdict leaves the attempt PENDING on purpose: the call itself succeeded, and
 * relabelling it a failed call would put a wrong reason in the audit trail for
 * an answer the vendor did give. Its lease then expires like any other and the
 * sweep re-runs it, which does ask the vendor again — the same cost a human
 * pressing retry used to pay, now automatic and bounded by recoveryAttempts.
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
          ...RELEASED,
        },
      }),
      prisma.package.updateMany({
        where: { id: packageId, workflowStatus: "CHECKING" },
        data: { workflowStatus: "CHECK_FAILED" },
      }),
    ]);
  } catch (recordingError) {
    // Nothing left to try here. The row keeps its lease, so the sweep is the
    // backstop.
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
    await recordIfStillOurs(checkId, packageId, {
      check: {
        status: "ERROR",
        rawResponse: { error: error instanceof Error ? error.message : String(error) },
        completedAt: new Date(),
        ...RELEASED,
      },
      package: { workflowStatus: "CHECK_FAILED" },
    });
    return;
  }

  await recordIfStillOurs(checkId, packageId, {
    check: {
      status: "COMPLETE",
      verdict: result.verdict,
      confidenceScore: result.confidenceScore,
      rawResponse: result.raw as object,
      completedAt: new Date(),
      ...RELEASED,
    },
    package: {
      workflowStatus: "RECEIVED",
      verdict: result.verdict,
      verdictSource: "API",
    },
  });
}

/**
 * Writes an attempt's outcome, but only if this process still owns it.
 *
 * The lease decides who *starts* work; this is what stops a superseded owner
 * from finishing it. A process paused past its lease — a throttled container, a
 * long stop-the-world pause — wakes with a result in hand for a check that has
 * since been reclaimed, completed, and possibly ruled on by a manager. Writing
 * it by id alone would overwrite that: `verdictSource: "API"` would bury a
 * MANUAL override and the note behind it (§4.4.5), which is the "two writers,
 * one package" outcome the lease exists to prevent.
 *
 * The package write is guarded on CHECKING for the same reason, and runs only
 * once the check row is confirmed still ours.
 */
async function recordIfStillOurs(
  checkId: string,
  packageId: string,
  outcome: {
    check: Prisma.TamperCheckUpdateManyMutationInput;
    package: Prisma.PackageUpdateManyMutationInput;
  }
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.tamperCheck.updateMany({
      where: { id: checkId, status: "PENDING", leaseOwner: INSTANCE_ID },
      data: outcome.check,
    });

    if (count !== 1) {
      log.warn("tamper_check_result_discarded", { packageId, checkId });
      return;
    }

    await tx.package.updateMany({
      where: { id: packageId, workflowStatus: "CHECKING" },
      data: outcome.package,
    });
  });
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

/** Reclaiming forever would be the right answer to the wrong problem. */
const MAX_RECOVERY_ATTEMPTS = 3;

/**
 * Picks up checks whose owner stopped running.
 *
 * This replaces a boot-time sweep that moved *every* package in CHECKING to
 * CHECK_FAILED. That was right with one instance, where nothing else could be
 * running a check, and silently wrong with two: a starting instance declared a
 * live check dead, and the instance still running it then wrote a verdict onto
 * a package already marked failed. Ownership is now explicit and expires, so
 * "abandoned" is a fact about the lease rather than an assumption about the
 * fleet.
 *
 * Each row is claimed with the owner and expiry it was read with in the WHERE
 * clause, so two instances sweeping at the same moment cannot both win it — the
 * same reason `claimForCheck` puts the status in its own WHERE.
 *
 * Returns how many were taken.
 */
export async function reclaimExpiredChecks(
  client: TamperCheckClient = getTamperCheckClient()
): Promise<number> {
  const now = new Date();

  const expired = await prisma.tamperCheck.findMany({
    where: {
      status: "PENDING",
      // NULL as well as past: a check already running when the lease columns
      // were added has no owner recorded, and NULL is not less-than anything in
      // SQL, so filtering on the date alone would hide exactly the rows the
      // deleted boot sweep used to rescue.
      OR: [{ leaseExpiresAt: { lt: now } }, { leaseExpiresAt: null }],
    },
    select: { id: true, packageId: true, leaseOwner: true, leaseExpiresAt: true, recoveryAttempts: true },
    // Oldest lease first, so the window is deterministic rather than whatever
    // the planner happens to return.
    orderBy: { leaseExpiresAt: { sort: "asc", nulls: "first" } },
    take: 20,
  });

  let reclaimed = 0;
  for (const check of expired) {
    // Checked per row, not once: a sweep can outlive the signal that started a
    // shutdown, and work picked up after the drain took its snapshot would be
    // killed at exit and stranded for a whole lease.
    if (isShuttingDown()) break;
    if (await reclaim(check, client)) reclaimed++;
  }
  return reclaimed;
}

async function reclaim(
  check: {
    id: string;
    packageId: string;
    leaseOwner: string | null;
    leaseExpiresAt: Date | null;
    recoveryAttempts: number;
  },
  client: TamperCheckClient
): Promise<boolean> {
  // Past the cap this is not work waiting to be finished, it is work that keeps
  // taking its process down with it. CHECK_FAILED is where a human can act.
  if (check.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
    const { count } = await prisma.tamperCheck.updateMany({
      where: { id: check.id, status: "PENDING", leaseOwner: check.leaseOwner },
      data: {
        status: "INTERRUPTED",
        rawResponse: { error: `abandoned after ${MAX_RECOVERY_ATTEMPTS} recovery attempts` },
        completedAt: new Date(),
        ...RELEASED,
      },
    });
    if (count === 1) {
      await releaseClaim(check.packageId, "CHECK_FAILED");
      log.warn("tamper_check_given_up", {
        packageId: check.packageId,
        checkId: check.id,
        recoveryAttempts: check.recoveryAttempts,
      });
    }
    return false;
  }

  const { count } = await prisma.tamperCheck.updateMany({
    where: {
      id: check.id,
      status: "PENDING",
      leaseOwner: check.leaseOwner,
      leaseExpiresAt: check.leaseExpiresAt,
    },
    data: { ...heldByThisProcess(), recoveryAttempts: { increment: 1 } },
  });
  if (count !== 1) return false;

  // The package moved on while this row sat expired — a retry produced a
  // newer attempt, say. Nothing to re-run; let the row go.
  const pkg = await prisma.package.findUnique({ where: { id: check.packageId } });
  if (pkg?.workflowStatus !== "CHECKING") {
    await prisma.tamperCheck.updateMany({
      where: { id: check.id, status: "PENDING" },
      data: {
        status: "INTERRUPTED",
        rawResponse: { error: "package was no longer being checked" },
        completedAt: new Date(),
        ...RELEASED,
      },
    });
    return false;
  }

  log.info("tamper_check_reclaimed", {
    packageId: check.packageId,
    checkId: check.id,
    previousOwner: check.leaseOwner,
    recoveryAttempts: check.recoveryAttempts + 1,
  });

  const running = runCheck(check.packageId, check.id, client)
    .catch((error) =>
      log.error("tamper_check_unexpected_failure", {
        packageId: check.packageId,
        checkId: check.id,
        err: error,
      })
    )
    .finally(() => inFlight.delete(running));

  inFlight.add(running);
  return true;
}
