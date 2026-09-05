import type { Server } from "http";
import { app } from "./app";
import { config } from "./lib/config";
import { beginShutdown, isShuttingDown } from "./lib/lifecycle";
import { log } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { MockTamperCheckClient, getTamperCheckClient } from "./lib/tamperCheck";
import {
  awaitInFlightChecks,
  inFlightCheckCount,
  recoverInterruptedChecks,
} from "./services/tamperCheckService";

/**
 * Refuses to start a production process that would fabricate verdicts.
 *
 * The stand-in returns a weighted random result and never looks at the photos,
 * and `TAMPER_CHECK_OUTCOME` pins that result for a demo — but a package
 * checked by the mock is indistinguishable afterwards from one checked for
 * real: `verdictSource` says `API` either way (DESIGN.md §3, §9). Inheriting
 * either of those in production is a silent, total failure, so it is a startup
 * error instead.
 */
function assertProductionReady(): void {
  if (!config.isProduction) return;

  const problems: string[] = [];
  if (getTamperCheckClient() instanceof MockTamperCheckClient) {
    problems.push("the tamper-detection client is still the mock");
  }
  if (process.env.TAMPER_CHECK_OUTCOME) {
    problems.push("TAMPER_CHECK_OUTCOME pins a fake verdict and must not be set");
  }

  if (problems.length > 0) {
    throw new Error(`Refusing to start in production:\n  - ${problems.join("\n  - ")}`);
  }
}

/**
 * Stops taking new work, lets what is in flight finish, then exits.
 *
 * Readiness starts failing immediately (`beginShutdown`) so the platform can
 * route elsewhere while this process is still serving the requests it already
 * accepted. Past the grace period the exit is forced: a request that has not
 * finished by then is not going to.
 */
function shutdownOn(signal: NodeJS.Signals, server: Server): void {
  process.on(signal, () => {
    // A second signal — Ctrl-C twice, or SIGINT after SIGTERM — would otherwise
    // re-enter, and server.close() on an already-closing server calls back
    // immediately: the process would exit 0 mid-drain and report it as clean.
    if (isShuttingDown()) {
      log.warn("shutdown_signal_ignored", { signal });
      return;
    }

    log.info("shutdown_started", { signal, graceMs: config.shutdownGraceMs });
    beginShutdown();

    const deadline = Date.now() + config.shutdownGraceMs;
    const forced = setTimeout(() => {
      log.error("shutdown_forced", { signal, graceMs: config.shutdownGraceMs });
      process.exit(1);
    }, config.shutdownGraceMs);
    // Don't let the timer itself be the reason the process stays alive.
    forced.unref();

    server.close(async () => {
      // Closing the listener only accounts for open sockets, and a tamper check
      // has none: its response went out before the call finished (DESIGN.md §3).
      // Waiting for it here is what keeps a deploy from stranding a package in
      // CHECKING until the next boot recovers it.
      const running = inFlightCheckCount();
      if (running > 0) {
        log.info("shutdown_awaiting_checks", { count: running });
        const settled = await awaitInFlightChecks(Math.max(0, deadline - Date.now()));
        if (!settled) {
          log.warn("shutdown_checks_unfinished", { count: inFlightCheckCount() });
        }
      }

      try {
        await prisma.$disconnect();
      } catch (error) {
        log.error("shutdown_disconnect_failed", { err: error });
      }
      log.info("shutdown_complete", { signal });
      process.exit(0);
    });
  });
}

async function start() {
  assertProductionReady();

  // A check runs in this process, so a restart strands anything mid-flight in
  // CHECKING. Recovery is best-effort though: if the database isn't up yet,
  // that's a reason to log and still serve, not to refuse to start.
  try {
    const recovered = await recoverInterruptedChecks();
    if (recovered > 0) {
      log.info("interrupted_checks_recovered", { count: recovered });
    }
  } catch (error) {
    log.error("interrupted_check_recovery_failed", { err: error });
  }

  const server = app.listen(config.port, () => {
    log.info("server_listening", { port: config.port, nodeEnv: config.nodeEnv });
  });

  shutdownOn("SIGTERM", server);
  shutdownOn("SIGINT", server);
}

start().catch((error) => {
  log.error("startup_failed", { err: error });
  process.exit(1);
});
