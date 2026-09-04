import { describe, expect, it } from "vitest";
import { nextPackageLabel } from "./packageLabels";

describe("nextPackageLabel", () => {
  it("starts at 1 for an empty delivery", () => {
    expect(nextPackageLabel([])).toBe(1);
  });

  it("continues the sequence", () => {
    expect(nextPackageLabel([{ label: 1 }, { label: 2 }])).toBe(3);
  });

  it("skips the gap left by a deleted package instead of reusing its number", () => {
    // 1,2,3 with #2 deleted — the box marked 3 still exists, so the next box
    // must be 4, not 3 (which is what a count-based label would hand out).
    expect(nextPackageLabel([{ label: 1 }, { label: 3 }])).toBe(4);
  });

  it("never reuses a number after the last package is deleted", () => {
    expect(nextPackageLabel([{ label: 1 }])).toBe(2);
  });
});
