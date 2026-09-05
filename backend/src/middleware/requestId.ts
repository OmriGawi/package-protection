import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";
import { log } from "../lib/logger";
import { runWithRequestContext } from "../lib/requestContext";

export const REQUEST_ID_HEADER = "x-request-id";

// An inbound id is echoed into a response header, into error bodies and into
// every log line for the request, so it is accepted only in a shape that can't
// be used to bloat or corrupt any of the three.
const USABLE_REQUEST_ID = /^[\w.-]{1,128}$/;

/**
 * Gives every request an id, echoes it back, and logs one line when it
 * finishes.
 *
 * An inbound id is reused rather than replaced: the platform's ingress may
 * already be stamping one, and two ids for the same request is worse than
 * none — the whole point is that a user's report and our logs meet at the
 * same string.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get(REQUEST_ID_HEADER)?.trim();
  const id = inbound && USABLE_REQUEST_ID.test(inbound) ? inbound : randomUUID();

  res.setHeader(REQUEST_ID_HEADER, id);

  runWithRequestContext(id, () => {
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      log.info("request", {
        method: req.method,
        // The route pattern where Express knows it ("/:id"), the raw path
        // otherwise. Patterns group in a log search; raw ids do not.
        path: req.route?.path ? req.baseUrl + req.route.path : req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
      });
    });

    next();
  });
}
