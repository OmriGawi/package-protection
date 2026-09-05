import type { Request, Response } from "express";

/**
 * Unknown paths answer JSON.
 *
 * Express's default is an HTML error page, which a `fetch` caller parses as a
 * failure with no message — the frontend's client only ever reads JSON
 * (`frontend/src/api/client.ts`), so a typo'd path surfaced as an unexplained
 * crash rather than a 404.
 */
export function notFound(req: Request, res: Response): void {
  res.status(404).json({ error: `no route for ${req.method} ${req.path}` });
}
