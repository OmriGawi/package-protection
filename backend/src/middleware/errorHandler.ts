import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { log } from "../lib/logger";
import { currentRequestId } from "../lib/requestContext";
import { MAX_PHOTO_BYTES, MAX_PHOTOS_PER_REQUEST } from "../lib/photoUpload";

/**
 * The last middleware. Express 5 forwards a rejected async handler here on its
 * own, so routes don't wrap themselves in try/catch to report a failure.
 *
 * Two things it fixes. Express's default handler puts the stack in the
 * response body unless NODE_ENV is production — which nothing set — so an
 * unexpected failure leaked internals to whoever triggered it. And multer
 * signals a rejected upload by throwing, so a photo over the size cap came
 * back as a 500 "something broke" rather than "that file is too large".
 *
 * The stack goes to the log, and the client gets the request id instead, so a
 * user reporting "it failed" hands over the string that finds the line.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  // Past the point where a body can be swapped for an error — hand it back to
  // Express, which will close the connection.
  if (res.headersSent) return next(error);

  const requestId = currentRequestId();

  if (error instanceof MulterError) {
    const { status, message } = describeMulterError(error);
    log.warn("upload_rejected", { code: error.code, field: error.field });
    res.status(status).json({ error: message, request_id: requestId });
    return;
  }

  // body-parser and friends signal a *client* mistake by throwing with a
  // status on it — malformed JSON is a 400, an over-limit body a 413. Express's
  // default handler read that field; replacing the handler without reading it
  // turned every one of those into "internal server error", and logged ordinary
  // bad input as though the server had broken.
  const status = clientErrorStatus(error);
  if (status) {
    log.warn("client_error", { status, err: error });
    res.status(status).json({ error: messageFor(error), request_id: requestId });
    return;
  }

  log.error("unhandled_error", { err: error });
  res.status(500).json({ error: "internal server error", request_id: requestId });
}

/** The error's own status, when it names one below 500. Server errors stay opaque. */
function clientErrorStatus(error: unknown): number | null {
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = typeof candidate?.status === "number" ? candidate.status : candidate?.statusCode;

  return typeof status === "number" && status >= 400 && status < 500 ? status : null;
}

function messageFor(error: unknown): string {
  const message = (error as { message?: unknown })?.message;
  return typeof message === "string" && message ? message : "bad request";
}

function describeMulterError(error: MulterError): { status: number; message: string } {
  switch (error.code) {
    case "LIMIT_FILE_SIZE":
      return {
        status: 413,
        message: `each photo must be under ${Math.floor(MAX_PHOTO_BYTES / 1024 / 1024)}MB`,
      };
    case "LIMIT_FILE_COUNT":
    case "LIMIT_PART_COUNT":
      return {
        status: 413,
        message: `a request carries at most ${MAX_PHOTOS_PER_REQUEST} photos`,
      };
    default:
      return { status: 400, message: `upload rejected: ${error.message}` };
  }
}
