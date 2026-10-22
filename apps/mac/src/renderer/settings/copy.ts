// Settings' words that are made from values: the name of each pane on the toolbar, the library's line, and a message
// ended as a sentence.
import { SHELVES } from "@avanzel/ui";
import type { SettingsPane } from "../../shared/ipc.ts";

/** Each pane's name on the toolbar, which is also its heading. The scheduled reviews' pane keeps its id, "tasks". */
export const PANE_LABELS: Readonly<Record<SettingsPane, string>> = {
  general: "General",
  voice: "Voice",
  agents: "Agents",
  tasks: "Reviews",
  privacy: "Privacy",
};

/** The library row's description, from LibraryInfo.shelves (the six shelves count; others don't) and isGit. */
export function libraryLine(shelves: Readonly<Record<string, number>>, isGit: boolean): string {
  const pages = SHELVES.reduce((sum, shelf) => sum + (shelves[shelf] ?? 0), 0);
  const filled = pages === 0 ? "Your first thought will fill a shelf." : `${pages} ${pages === 1 ? "page" : "pages"} on six shelves.`;
  const undo = isGit ? "Every change is a commit you can undo." : "This folder has no git history, so changes can't be undone.";
  return `${filled} ${undo}`;
}

/** `text` ending as a sentence: a full stop added, unless it ends in ".", "?" or "…". */
export function asSentence(text: string): string {
  return /[.?…]$/.test(text) ? text : `${text}.`;
}
