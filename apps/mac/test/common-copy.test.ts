import { SHELVES } from "@avanzel/ui";
import { describe, expect, it } from "vitest";
import { isShelf } from "../src/renderer/common/shelf.ts";
import { stampDate } from "../src/renderer/common/stamp.ts";
import * as setupCopy from "../src/renderer/setup/copy.ts";

// What the capsule and setup share of the words on a card of paper: the stamp's day, and which folders are shelves. Setup keeps
// importing them from its copy, which re-exports them.

describe("stampDate", () => {
  it("prints the day as a stamp does, with the month in three letters", () => {
    expect(stampDate(new Date(2026, 9, 21))).toBe("21 Oct 2026");
    expect(stampDate(new Date(2027, 0, 3))).toBe("3 Jan 2027");
    expect(stampDate(new Date(2026, 11, 31))).toBe("31 Dec 2026");
  });

  it("is the one setup's copy re-exports", () => {
    expect(setupCopy.stampDate).toBe(stampDate);
  });
});

describe("isShelf", () => {
  it("is true for each of the six shelves, and false for any other folder", () => {
    for (const shelf of SHELVES) expect(isShelf(shelf), shelf).toBe(true);
    for (const folder of ["projects", "inbox", "raw", "", "Ideas", "ideas/"]) expect(isShelf(folder), folder).toBe(false);
  });

  it("is the one setup's copy re-exports", () => {
    expect(setupCopy.isShelf).toBe(isShelf);
  });
});
