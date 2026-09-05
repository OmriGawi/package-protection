import { afterEach, describe, expect, it, vi } from "vitest";
import { newSubmitKey } from "./submitKey";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newSubmitKey", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("produces the UUID shape the API validates", () => {
    expect(newSubmitKey()).toMatch(UUID);
  });

  it("does not repeat itself", () => {
    expect(newSubmitKey()).not.toBe(newSubmitKey());
  });

  // The phone photographing the packages may be pointed at a plain-HTTP LAN
  // address, where randomUUID is not merely unavailable but undefined — and
  // reaching for it threw out of the submit handler, leaving the button
  // disabled with nothing on screen to explain why.
  it("still works where crypto.randomUUID does not exist", () => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });

    expect(newSubmitKey()).toMatch(UUID);
  });

  it("still works with no crypto at all", () => {
    vi.stubGlobal("crypto", undefined);

    expect(newSubmitKey()).toMatch(UUID);
  });
});
