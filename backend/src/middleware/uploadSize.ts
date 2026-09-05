import type { NextFunction, Request, Response } from "express";
import { log } from "../lib/logger";
import { currentRequestId } from "../lib/requestContext";
import { MAX_UPLOAD_BYTES } from "../lib/photoUpload";

const MAX_UPLOAD_MB = Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024);

/**
 * Rejects an oversized upload before multer buffers any of it.
 *
 * multer's own limits are per file and per file *count*, and it buffers into
 * memory before any handler runs, so the two together permitted roughly 3GB in
 * one request — a handful of which would take the process down. This caps the
 * request as a whole (docs/production-readiness.md P6).
 *
 * It reads Content-Length rather than counting the stream: attaching a `data`
 * listener here would put the request into flowing mode and consume the body
 * multer is about to parse. Browsers set Content-Length for a FormData upload,
 * so this covers the path that actually exists; a chunked request without the
 * header falls through to multer's per-file limits, and closing that gap
 * properly means getting the bytes out of this process entirely, which is the
 * rest of P6.
 *
 * The request is deliberately *not* destroyed after the 413. Node still drains
 * the body it will never parse, so an oversized POST costs its transfer either
 * way — but destroying mid-upload means many clients see a connection reset
 * instead of the response, and the employee gets a generic network error rather
 * than being told the upload is too large. Memory is what this protects;
 * bandwidth is P6's job, by not sending the bytes here at all.
 */
export function limitUploadBytes(req: Request, res: Response, next: NextFunction): void {
  const declared = Number(req.get("content-length"));

  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    log.warn("upload_too_large", { declaredBytes: declared, limitBytes: MAX_UPLOAD_BYTES });
    res.status(413).json({
      error: `an upload must be under ${MAX_UPLOAD_MB}MB in total`,
      request_id: currentRequestId(),
    });
    return;
  }

  next();
}
