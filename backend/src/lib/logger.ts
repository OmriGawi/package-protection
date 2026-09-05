import { currentRequestId } from "./requestContext";

/**
 * One JSON object per line on stdout.
 *
 * No logging library: the container's stdout is what the log collector reads
 * (Splunk, in this company's case, wired up in a later slice), so the only
 * decision this file makes is the *shape* of a line. Prose strings — what this
 * backend emitted before — can only be indexed as free text; fields can be
 * searched.
 *
 * A stack trace belongs here and never in an HTTP response, which is what
 * `flattenError` is for: the error handler logs the whole thing and answers
 * the client with a correlation id instead.
 */

type Level = "info" | "warn" | "error";

export type LogFields = Record<string, unknown> & { err?: unknown };

function flattenError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

function write(level: Level, event: string, fields: LogFields = {}): void {
  const { err, ...rest } = fields;
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
    ...rest,
  };

  const requestId = currentRequestId();
  if (requestId) line.requestId = requestId;
  if (err !== undefined) line.err = flattenError(err);

  // console.* rather than process.stdout.write so test runners and platforms
  // that capture console output still see these.
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(JSON.stringify(line));
}

export const log = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
