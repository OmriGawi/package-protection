import { AsyncLocalStorage } from "async_hooks";

/**
 * The current request's id, carried without threading a parameter through
 * every service.
 *
 * An async-local store rather than an argument because the tamper check is
 * deliberately started and not awaited (`startCheck`, DESIGN.md §3): it runs
 * after its response is already sent, and an async-local context follows into
 * that continuation. A parameter would have to be passed down through the
 * service layer purely so a log line could mention it.
 */
interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

/** The current request's id, or undefined outside a request (startup, jobs). */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
