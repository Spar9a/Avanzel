// What outside agents are told when they connect: the library as it is now, and how to write a note the librarian can
// file. The rules live here once, so the instructions, the `remember` tool and the docs say the same thing.

/** How to write a good note, in full: sent in the server's instructions on every connection. */
export const WRITING_RULES = [
  "Search before you remember: don't save what the library already says; if it differs, say what changed and name that page in supersedes.",
  "One thing per note: one decision, preference, fact or open question.",
  "Write it to stand alone, as the librarian won't see your chat: say who and which project, use full dates, name people as the library does.",
  "Suggest the shelf and related pages from what you found.",
  "Take tags from library_overview; add a new one only when none fits.",
  "Put its source in context: project, repo, URL.",
  "After remember, tell the user in one line what you saved.",
  "If the user asked you to check before saving, ask before every remember.",
  "Never save secrets, keys or passwords.",
  "Save what the owner would want kept, not your working notes.",
].join(" ");

/** The writing rules in short, for the `remember` tool's description, which every request pays for. */
export const REMEMBER_RULES =
  "Search first. One thing per note, written to stand alone (who, which project, full dates). Tags from library_overview. Never secrets. Tell the user in one line what you saved.";

const SHELVES_ROOM = 160;

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The shelves by name, as many as fit in their share of the instructions, then how many more there are. */
function shelfList(shelves: readonly string[]): string {
  const shown: string[] = [];
  for (const [index, shelf] of shelves.entries()) {
    const left = shelves.length - index - 1;
    const tail = left > 0 ? `, and ${left} more`.length : 0;
    if ([...shown, shelf].join(", ").length + tail > SHELVES_ROOM) {
      if (shown.length === 0) return `${shelves.length} (library_overview lists them)`;
      return `${shown.join(", ")}, and ${shelves.length - shown.length} more`;
    }
    shown.push(shelf);
  }
  return shown.join(", ");
}

/** The instructions for one connection (about 150 words), built from the library's state when the agent connects. */
export function serverInstructions(state: { shelves: string[]; pages: number; waiting: number; eveningReviewOn: boolean }): string {
  const waiting = `${count(state.waiting, "note", "notes")} from agents ${state.waiting === 1 ? "waits" : "wait"} to be filed`;
  return [
    `This is the owner's Avanzel library, kept by its librarian. Shelves: ${shelfList(state.shelves)}.`,
    `It has ${count(state.pages, "page", "pages")}; ${waiting}, and the evening review is ${state.eveningReviewOn ? "on" : "off"}.`,
    "Read library_overview first.",
    WRITING_RULES,
  ].join(" ");
}
