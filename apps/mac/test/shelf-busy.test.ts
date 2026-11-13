import { describe, expect, it } from "vitest";
import { shelfBusy } from "../src/renderer/panel/shelf-busy.ts";
import type { ShelfGoing } from "../src/shared/ipc.ts";

// Which of Library's buttons for a suggested shelf is busy: the one main names (`PanelSnapshot.shelvesGoing`), and a press here only
// until the first snapshot after it.
const snapshot = (...going: ShelfGoing[]) => ({ shelvesGoing: going });

describe("shelfBusy", () => {
  it("is nothing while main is doing nothing for the folder", () => {
    expect(shelfBusy("projects", snapshot(), null)).toBeNull();
    expect(shelfBusy("projects", snapshot({ folder: "errands", op: "make" }), null)).toBeNull();
  });

  it("is the operation main names, whichever window pressed it", () => {
    expect(shelfBusy("projects", snapshot({ folder: "projects", op: "make" }), null)).toBe("make");
    expect(shelfBusy("projects", snapshot({ folder: "projects", op: "decline" }), null)).toBe("decline");
  });

  it("is what was pressed here, from the press until the next snapshot", () => {
    const before = snapshot();
    expect(shelfBusy("projects", before, { op: "decline", under: before })).toBe("decline");
  });

  it("defers to main once a snapshot comes after the press: a stale or batched one leaves nothing spinning", () => {
    const before = snapshot();
    const pressed = { op: "make", under: before } as const;
    // Main made it, or had nothing to make, before this snapshot: nothing is going, so nothing is busy.
    expect(shelfBusy("projects", snapshot(), pressed)).toBeNull();
    // Main is turning it down (a No pressed on the card): No is busy, not the Make shelf pressed here.
    expect(shelfBusy("projects", snapshot({ folder: "projects", op: "decline" }), pressed)).toBe("decline");
  });
});
