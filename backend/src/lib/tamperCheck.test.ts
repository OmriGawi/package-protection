import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MockTamperCheckClient,
  TamperCheckCallError,
  forcedOutcome,
  pickWeightedOutcome,
  type MockOutcome,
} from "./tamperCheck";

const input = {
  packageId: "pkg-1",
  preShip: [{ id: "a", storagePath: "d/p/a.png", sequence: 1 }],
  postReceive: [{ id: "b", storagePath: "d/p/b.png", sequence: 1 }],
};

function clientReturning(outcome: MockOutcome) {
  return new MockTamperCheckClient(() => outcome, 0);
}

describe("MockTamperCheckClient", () => {
  it.each(["INTACT", "OPENED", "INCONCLUSIVE"] as const)("returns a %s verdict", async (verdict) => {
    const result = await clientReturning(verdict).check(input);

    expect(result.verdict).toBe(verdict);
    // The real API may or may not expose a score — we don't invent one (§3).
    expect(result.confidenceScore).toBeNull();
  });

  it("rejects when the call itself fails, rather than returning a verdict", async () => {
    // CHECK_FAILED is an operational problem, not evidence about the package,
    // so it must not arrive as if it were a verdict.
    await expect(clientReturning("CALL_FAILED").check(input)).rejects.toBeInstanceOf(TamperCheckCallError);
  });

  it("reports what it compared, so the stored raw response isn't opaque", async () => {
    const result = await clientReturning("INTACT").check(input);

    expect(result.raw).toMatchObject({ mock: true, comparedPreShip: 1, comparedPostReceive: 1 });
  });

  it("ignores the images — identical sets prove nothing about the verdict", async () => {
    const sameImages = { ...input, preShip: input.preShip, postReceive: input.preShip };

    // Deliberate: the mock detects nothing, so it must not be read as evidence
    // that identical photos mean an untampered package.
    const result = await clientReturning("OPENED").check(sameImages);

    expect(result.verdict).toBe("OPENED");
  });
});

describe("TAMPER_CHECK_OUTCOME", () => {
  const original = process.env.TAMPER_CHECK_OUTCOME;
  afterEach(() => {
    process.env.TAMPER_CHECK_OUTCOME = original;
    vi.restoreAllMocks();
  });

  it.each(["INTACT", "OPENED", "INCONCLUSIVE", "CALL_FAILED"] as const)("pins the outcome to %s", (outcome) => {
    process.env.TAMPER_CHECK_OUTCOME = outcome;

    expect(forcedOutcome()).toBe(outcome);
    // Every draw, not just the first — this is what makes a demo repeatable.
    expect(Array.from({ length: 20 }, pickWeightedOutcome).every((o) => o === outcome)).toBe(true);
  });

  it("is case-insensitive and tolerates stray whitespace", () => {
    process.env.TAMPER_CHECK_OUTCOME = " opened ";
    expect(forcedOutcome()).toBe("OPENED");
  });

  it.each(["RANDOM", "", undefined])("draws at random for %o", (value) => {
    if (value === undefined) delete process.env.TAMPER_CHECK_OUTCOME;
    else process.env.TAMPER_CHECK_OUTCOME = value;

    expect(forcedOutcome()).toBeNull();
  });

  it("warns rather than silently ignoring a misspelled value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.TAMPER_CHECK_OUTCOME = "INTECT";

    // A typo that quietly behaves like RANDOM looks exactly like it working.
    expect(forcedOutcome()).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("INTECT"));
  });
});
