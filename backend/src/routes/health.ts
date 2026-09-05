import { Router } from "express";
import { prisma } from "../lib/prisma";
import { isShuttingDown } from "../lib/lifecycle";
import { log } from "../lib/logger";

export const healthRouter = Router();

/**
 * Liveness: this process is running and can answer.
 *
 * Deliberately does not touch the database. A liveness probe that fails on a
 * database blip gets a healthy process restarted, which fixes nothing and
 * throws away whatever it was doing.
 */
healthRouter.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * Readiness: this process should receive traffic right now.
 *
 * Fails while draining — that is the window where the process is deliberately
 * still serving in-flight requests but should get no new ones — and fails if
 * the database is unreachable, since every route past here needs it.
 */
healthRouter.get("/ready", async (_req, res) => {
  if (isShuttingDown()) {
    return res.status(503).json({ status: "shutting_down" });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    log.error("readiness_check_failed", { err: error });
    return res.status(503).json({ status: "database_unavailable" });
  }

  res.json({ status: "ready" });
});
