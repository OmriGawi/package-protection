import type { WorkflowStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getTamperCheckClient, type TamperCheckClient } from "../lib/tamperCheck";

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
export async function startCheck(
  packageId: string,
  client: TamperCheckClient = getTamperCheckClient()
): Promise<void> {
  const check = await prisma.tamperCheck.create({ data: { packageId, status: "PENDING" } });

  // Left running: the request returns 202 and the client polls for the result.
  // runCheck records its own failures, so this catch is only for the unexpected
  // — it must never surface as an unhandled rejection.
  void runCheck(packageId, check.id, client).catch((error) =>
    console.error(`tamper check for package ${packageId} failed unexpectedly`, error)
  );
}

async function runCheck(packageId: string, checkId: string, client: TamperCheckClient): Promise<void> {
  const images = await prisma.packageImage.findMany({
    where: { packageId },
    orderBy: { sequence: "asc" },
    select: { id: true, storagePath: true, sequence: true, phase: true },
  });

  // Only the call itself is guarded. If recording a *successful* result failed
  // and were caught here, a real verdict would be thrown away and marked as a
  // failed call — sending the retry back to the external service for an answer
  // it had already given.
  let result;
  try {
    result = await client.check({
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
      status: "ERROR",
      rawResponse: { error: "interrupted by a server restart" },
      completedAt: now,
    },
  });

  return count;
}
