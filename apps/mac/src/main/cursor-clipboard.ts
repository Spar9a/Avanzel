// The clipboard as a dictation at the cursor uses it from the app: only for words that were NOT pasted (focus moved, the paste failed,
// the target was unknown), which are left there so the person can paste them by hand, and for the copy card's and the Dictations
// pane's Copy. A paste itself borrows the clipboard in the helper (avanzel-cursor's `paste`), which keeps every item and gives them back.
// Electron's clipboard has only promises (Electron 44).
import { clipboard } from "electron";
import type { CursorHost } from "./cursor-dictation.ts";

export const electronClipboard: CursorHost["clipboard"] = {
  async writeText(text: string): Promise<void> {
    await clipboard.writeText(text);
  },
};
