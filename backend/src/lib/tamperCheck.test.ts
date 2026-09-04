import { describe, expect, it } from "vitest";
import { MockTamperCheckClient, TamperCheckCallError, type MockOutcome } from "./tamperCheck";

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
});
