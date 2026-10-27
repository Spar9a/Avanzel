// What the menu bar menu shows, as plain data; tray.ts turns it into an Electron menu.
import type { FiledPage, ModelStatus, Shortcuts } from "../shared/ipc.ts";
import { downloadFailedProblem, TYPED_THOUGHTS_SAVED, TYPING_WORKS_MEANWHILE, voiceSettingsProblem } from "../shared/problems.ts";
import { SHELF_NAMES, isShelf } from "./shelf-glyphs.ts";
import { prettyAccelerator } from "./shortcuts.ts";

export interface MenuTask {
  id: string;
  name: string;
  /** The kind of review the task file says it is: "evening-review", "review" or "custom". The status line names the evening review. */
  kind: string;
  at: Date | null;
  enabled: boolean;
  running: boolean;
  /**
   * How far the review is while it runs, "Filing 2 of 5" (`reviewProgress`): the menu shows it beside the review in place of "Running…".
   * The evening review counts its captures (`Controller.countReview`); a review that has begun none, or doesn't count, has none, and
   * says "Running…".
   */
  progress?: string;
}

export interface MenuInput {
  libraryReady: boolean;
  /** Why the library couldn't be opened, if that is why it isn't ready. */
  problem?: string | null;
  /** The remembered library's place as the person knows it ("~/Avanzel"), if that is why it isn't ready: it isn't there any more. */
  missingLibrary?: string | null;
  inbox: number;
  recent: FiledPage[];
  /** How many thoughts the library's log says were filed today (`filedToday`): the head counts them. */
  filedToday: number;
  tasks: MenuTask[];
  /**
   * The capsule's own title for why the speech model can't be used (`speechProblemOf`), or null when nothing is wrong with it. The menu
   * names it right under the head, and its action opens Settings on Voice, where the fix is.
   */
  speechProblem: string | null;
  /** The second line under `speechProblem`: what is safe meanwhile and where the fix is (`speechProblemOf`). Nothing without a problem. */
  speechSublabel?: string;
  recording: boolean;
  shortcuts: Shortcuts;
  /**
   * The actions whose shortcut didn't register: another app holds it, an earlier action has it, or macOS doesn't
   * understand it. Pressing it does nothing for them, so their items don't show it.
   */
  unregisteredShortcuts: readonly (keyof Shortcuts)[];
  undoableReview: boolean;
  /**
   * The last filing can be taken back from here (`Controller.undoableFiling`): a capsule or background filing ended well with a commit,
   * no run has begun since, and no filing or review waits or runs. The menu then ends its recent pages with "Undo the last filing".
   */
  undoableFiling: boolean;
}

// Anything the owner has to read is an enabled item: macOS draws disabled items too dim to read.
export type MenuItemModel =
  | { type: "separator" }
  | { type: "header"; label: string }
  | { type: "item"; label: string; action: string; accelerator?: string; enabled?: boolean; shelf?: string; detail?: string; sublabel?: string };

const SEP: MenuItemModel = { type: "separator" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (from: Date, to: Date) => Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);

/** "21:00" today, "Tomorrow 09:05", "Sun 18:00" within the week, else "2 Nov 18:00". */
export function formatWhen(at: Date, now: Date): string {
  const days = daysBetween(now, at);
  if (days === 0) return hhmm(at);
  if (days === 1) return `Tomorrow ${hhmm(at)}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[at.getDay()]} ${hhmm(at)}`;
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${hhmm(at)}`;
}

function nextPhrase(at: Date, now: Date): string {
  const days = daysBetween(now, at);
  if (days === 0) return `at ${hhmm(at)}`;
  if (days === 1) return `tomorrow at ${hhmm(at)}`;
  return `on ${formatWhen(at, now).replace(/ (\d\d:\d\d)$/, " at $1")}`;
}

/** An item's label as the menu shows it: macOS menus don't line up tabs, so a detail goes in parentheses. */
export function menuLabel(item: { label: string; detail?: string }): string {
  return item.detail ? `${item.label} (${item.detail})` : item.label;
}

/**
 * How today went, for the head of the menu: "Nothing filed today.", "1 thought filed today." or "3 thoughts filed today.", and when an
 * evening review is on, its own name and its next time after that ("Evening review at 21:00.", "Evening review tomorrow at 21:00.").
 * `evening` is the soonest evening review that is on and has a time to say. It is a review, not a letter: no letter is built yet.
 */
export function statusLine(filedToday: number, evening: MenuTask | undefined, now: Date): string {
  const filed = filedToday <= 0 ? "Nothing filed today." : filedToday === 1 ? "1 thought filed today." : `${filedToday} thoughts filed today.`;
  return evening?.at ? `${filed} ${evening.name} ${nextPhrase(evening.at, now)}.` : filed;
}

/**
 * How far an evening review is, for `MenuTask.progress`: "Filing 2 of 5", capitalised like the other details ("Running…", "Off"). The
 * total never falls short of the count, since a capture that arrives meanwhile is filed too: the menu never reads "Filing 3 of 2".
 */
export function reviewProgress(done: number, total: number): string {
  return `Filing ${done} of ${Math.max(total, done)}`;
}

/**
 * What is wrong with the speech model, for the menu to name: the capsule's own title for it, and a second line under it that says what
 * is safe meanwhile and where the fix is, as the capsule's card and Settings → Voice do (the title and the safe sentence are the
 * builders' own, in shared/problems.ts). A download that failed is tried again in Settings → Voice, which tells whether it continues
 * where it stopped or starts over: the menu leaves that there. Voice settings Avanzel can't use have no Try again: they are fixed in
 * the config file. Null while the model is ready, on its way or still to be fetched: none of those is a problem.
 */
export function speechProblemOf(model: ModelStatus): { title: string; sublabel: string } | null {
  if (model.kind !== "error") return null;
  if (model.cause === "settings") {
    return { title: voiceSettingsProblem(model.message).title, sublabel: `${TYPED_THOUGHTS_SAVED} Fix the config file.` };
  }
  return { title: downloadFailedProblem(model.message, model.resumable).title, sublabel: `${TYPING_WORKS_MEANWHILE}. Try again in Settings → Voice.` };
}

/** A recently filed page's second line: its shelf's name, or the folder it is in when the person made that folder; none without one. */
function shelfLine(folder: string): string | undefined {
  if (!folder) return undefined;
  return isShelf(folder) ? SHELF_NAMES[folder] : folder;
}

export function buildMenuModel(input: MenuInput, now: Date): MenuItemModel[] {
  if (!input.libraryReady) {
    // A library that couldn't be opened, or isn't there any more, is explained, and fixed, in Settings; otherwise setup makes one.
    const trouble = input.problem || (input.missingLibrary ? `Can't find your library at ${input.missingLibrary}.` : "");
    return [
      { type: "item", label: "Set up Avanzel…", action: trouble ? "settings" : "setup", sublabel: trouble || "Choose a folder for your library to start." },
      SEP,
      { type: "item", label: "Quit Avanzel", action: "quit", accelerator: "Cmd+Q" },
    ];
  }

  const inbox = input.inbox === 1 ? "1 note in the inbox" : `${input.inbox} notes in the inbox`;
  // The soonest evening review that is on and has a time: the head names it. The other reviews are listed further down.
  const evening = input.tasks
    .filter((t): t is MenuTask & { at: Date } => t.kind === "evening-review" && t.enabled && t.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];

  const shortcut = (key: keyof Shortcuts) => (input.unregisteredShortcuts.includes(key) ? {} : { accelerator: input.shortcuts[key] });
  // The click goes where the words say: while the head's second line names the inbox it opens the inbox, and with the inbox empty, when
  // its words no longer mention it, it opens the library.
  const status = statusLine(input.filedToday, evening, now);
  const head: MenuItemModel = input.inbox > 0 ? { type: "item", label: status, action: "open-inbox", sublabel: inbox } : { type: "item", label: status, action: "open-library" };
  const items: MenuItemModel[] = [
    head,
    ...(input.speechProblem
      ? [{ type: "item" as const, label: input.speechProblem, action: "open-settings:voice", ...(input.speechSublabel ? { sublabel: input.speechSublabel } : {}) }]
      : []),
    SEP,
    { type: "item", label: input.recording ? "Stop recording" : "Record a thought", action: "dictate", ...shortcut("dictate") },
    { type: "item", label: "Capture screen with a comment", action: "capture", ...shortcut("capture") },
    { type: "item", label: "Type a thought…", action: "type", ...shortcut("type") },
    { type: "item", label: "Ask your library…", action: "ask", ...shortcut("ask") },
    SEP,
  ];

  const filed: MenuItemModel[] = [];
  for (const page of input.recent.slice(0, 3)) {
    const shelf = shelfLine(page.shelf);
    filed.push({ type: "item", label: page.title, action: `open:${page.path}`, shelf: page.shelf, ...(shelf ? { sublabel: shelf } : {}) });
  }
  if (!input.recent.length && input.filedToday === 0 && !input.undoableFiling) {
    // Nothing filed yet invites a first thought. What the owner has to read is an enabled item (see MenuItemModel), so this is
    // one, and it does what Record a thought does. It names the shortcut that action really has: none when it didn't register
    // or isn't set. Only while nothing has been filed: a filing that wrote no page (the agent only logged the note) leaves no page
    // to list, and the invitation would contradict the head's count, and the Undo of that filing.
    const dictate = input.unregisteredShortcuts.includes("dictate") ? "" : input.shortcuts.dictate;
    const press = dictate ? `Press ${prettyAccelerator(dictate)}` : "Record a thought";
    filed.push({ type: "item", label: `Nothing filed yet. ${press} and say hello.`, action: "dictate" });
  }
  // The newest filing can be taken back from here: the item closes the section that lists the pages filed.
  if (input.undoableFiling) filed.push({ type: "item", label: "Undo the last filing", action: "undo-filing" });
  // A section with nothing to show (filings today, but none that wrote a page or can be undone) has no header either.
  if (filed.length) items.push({ type: "header", label: "Recently filed" }, ...filed, SEP);

  if (input.tasks.length || input.undoableReview) {
    items.push({ type: "header", label: "Scheduled reviews" });
    for (const task of input.tasks) {
      const detail = task.running ? (task.progress ?? "Running…") : task.enabled && task.at ? formatWhen(task.at, now) : "Off";
      items.push({ type: "item", label: task.name, action: `task:${task.id}`, detail });
    }
    if (input.undoableReview) items.push({ type: "item", label: "Undo the last evening review", action: "undo-review" });
    items.push(SEP);
  }

  items.push(
    { type: "item", label: "Open library", action: "open-library" },
    { type: "item", label: "Settings…", action: "settings", accelerator: "Cmd+," },
    { type: "item", label: "Quit Avanzel", action: "quit", accelerator: "Cmd+Q" },
  );
  return items;
}
