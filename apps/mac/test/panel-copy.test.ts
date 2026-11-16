import { describe, expect, it } from "vitest";
import { REVIEW_STUDY, STUDY_OFFER_LATER, STUDY_OPEN_SETTINGS } from "../src/renderer/panel/copy.ts";

describe("the panel's words for Learn this library's cards", () => {
  it("keeps the buttons' words", () => {
    expect(STUDY_OFFER_LATER).toBe("Not now");
    expect(REVIEW_STUDY).toBe("Review");
    // A study that paused on a failed run is told in Settings, which says why and goes on with it. Settings is the pane's name.
    expect(STUDY_OPEN_SETTINGS).toBe("Open Settings");
  });

  it("keeps to the copy rules: sentence case, no full stop on a button, no “!”", () => {
    for (const label of [STUDY_OFFER_LATER, REVIEW_STUDY, STUDY_OPEN_SETTINGS]) expect(label, label).toMatch(/^\p{Lu}[^!.]*$/u);
    for (const label of [STUDY_OFFER_LATER, REVIEW_STUDY]) expect(label.slice(1), label).not.toMatch(/\b\p{Lu}/u);
  });
});
