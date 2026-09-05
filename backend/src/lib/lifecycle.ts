/**
 * Whether the process is draining.
 *
 * Readiness has to start failing the *moment* SIGTERM arrives, while in-flight
 * requests are still being served: that is the window in which the platform
 * should stop routing new traffic here but the process is deliberately still
 * alive. Liveness stays true throughout — a draining process is not a broken
 * one.
 */
let shuttingDown = false;

export function beginShutdown(): void {
  shuttingDown = true;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Test-only: puts the flag back so one test's shutdown doesn't leak into the next. */
export function resetShutdownForTests(): void {
  shuttingDown = false;
}
