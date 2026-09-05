import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { MAX_UPLOAD_BYTES } from "../lib/photoUpload";
import { limitUploadBytes } from "./uploadSize";

/**
 * Driven directly rather than through supertest: the point of this middleware
 * is that it answers *before* the body is read, so a test that actually sent
 * 150MB would be measuring the wrong thing — and one that lied about
 * Content-Length over a real socket would hang waiting for bytes that never
 * come.
 */
function run(contentLength: string | undefined) {
  const req = { get: (name: string) => (name === "content-length" ? contentLength : undefined) };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const next = vi.fn();

  limitUploadBytes(req as unknown as Request, res as unknown as Response, next);
  return { res, next };
}

describe("limitUploadBytes", () => {
  it("rejects a request that declares more than the cap", () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { res, next } = run(String(MAX_UPLOAD_BYTES + 1));

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json.mock.calls[0][0].error).toMatch(/under \d+MB in total/);
    expect(next).not.toHaveBeenCalled();

    warned.mockRestore();
  });

  it("lets a delivery-sized upload through", () => {
    const { res, next } = run(String(MAX_UPLOAD_BYTES - 1));

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  // A chunked request carries no Content-Length. Nothing here can bound it
  // without consuming the body multer is about to parse, so it falls through to
  // multer's per-file limits — see the note in uploadSize.ts.
  it("passes a request with no declared length to multer's own limits", () => {
    const { next } = run(undefined);

    expect(next).toHaveBeenCalled();
  });
});
