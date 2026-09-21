import { describe, expect, it } from "vitest";
import { discardPhotosWarning } from "./display";

describe("discardPhotosWarning", () => {
  it("speaks in the singular for one photo, with no count in brackets", () => {
    // "(1)" under a plural sentence is the bug this exists to prevent.
    expect(discardPhotosWarning(1, "saved", "פתיחת חבילה 1", "תמחק")).toEqual({
      title: "התמונה שבחרת טרם נשמרה",
      detail: "פתיחת חבילה 1 תמחק אותה.",
    });
  });

  it("speaks in the plural from two, and says how many", () => {
    expect(discardPhotosWarning(3, "saved", "פתיחת חבילה 2", "תמחק")).toEqual({
      title: "התמונות שבחרת טרם נשמרו",
      detail: "פתיחת חבילה 2 תמחק אותן.",
    });
  });

  it("says sent rather than saved on the receive panel", () => {
    expect(discardPhotosWarning(1, "sent", "מעבר לחבילה 2", "ימחק").title).toBe(
      "התמונה שבחרת טרם נשלחה"
    );
    expect(discardPhotosWarning(2, "sent", "מעבר לחבילה 2", "ימחק")).toEqual({
      title: "התמונות שבחרת טרם נשלחו",
      detail: "מעבר לחבילה 2 ימחק אותן.",
    });
  });
});
