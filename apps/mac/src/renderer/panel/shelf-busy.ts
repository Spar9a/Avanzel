// Which of Library's buttons for a suggested shelf is busy. Pure: the panel's ShelfQuestion draws it.
import type { PanelSnapshot, ShelfGoing } from "../../shared/ipc.ts";

/** A press of Make shelf or No in Library, and the snapshot that was showing when it came (`under`). */
export interface ShelfPress {
  op: ShelfGoing["op"];
  under: unknown;
}

/**
 * The operation whose button is busy for `folder`'s question, or null. Main says what it is waiting on or running
 * (`snap.shelvesGoing`), whichever window asked. A press here (`pressed`) only bridges the gap until main's next snapshot, which comes
 * once main has it in hand, or has turned it away: from then on main's word stands, so a stale snapshot, or a batch of them, never leaves
 * a button spinning.
 */
export function shelfBusy(folder: string, snap: Pick<PanelSnapshot, "shelvesGoing">, pressed: ShelfPress | null): ShelfGoing["op"] | null {
  if (pressed && pressed.under === snap) return pressed.op;
  return snap.shelvesGoing.find((going) => going.folder === folder)?.op ?? null;
}
