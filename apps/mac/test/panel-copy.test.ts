import { describe, expect, it } from "vitest";
import { REVIEW_STUDY, STUDY_OFFER_LATER } from "../src/renderer/panel/copy.ts";

describe("the panel's words for Learn this library's cards", () => {
  it("keeps the buttons' words", () => {
    expect(STUDY_OFFER_LATER).toBe("Not now");
    expect(REVIEW_STUDY).toBe("Review");
  });

  it("keeps to the copy rules: sentence case, no full stop on a button, no “!”", () => {
    for (const label of [STUDY_OFFER_LATER, REVIEW_STUDY]) {
      expect(label, label).toMatch(/^\p{Lu}[^!.]*$/u);
      expect(label.slice(1), label).not.toMatch(/\b\p{Lu}/u);
    }
  });
});
