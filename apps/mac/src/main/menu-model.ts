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
  /**
   * Notes on a call: "ready" offers "Take notes on a call…", "running" offers "Stop taking notes", and "off" offers neither: the Mac
   * can't tap a call, no library is open, or a call is starting or being finished (`Controller.menuInput`).
   */
  callNotes: "off" | "ready" | "running";
  /**
   * How many calls cut short (by a quit, a crash, or a microphone, helper or disk that failed) wait to be finished, while one can be
   * now (no call starts, runs or is being finished, no thought records); 0 otherwise. Over 0, "Finish notes for a call that was cut
   * short" follows the call's rows and finishes the oldest.
   */
  cutShortCalls: number;
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
  /**
   * "Show the last receipt" can be chosen now (`Controller.receiptShowable`): the open library has a receipt, and nothing is recording,
   * filing or reviewing, Avanzel isn't quitting, the library's saved Undo is checked, and the capsule shows nothing or a finished card (not
   * a problem's notice, the editor or a capture, which the item would do nothing over). The menu then ends its recent pages with the item,
   * right above "Undo the last filing".
   */
  showableReceipt: boolean;
  /**
   * The open library has a receipt, whether or not it can be shown now. The invitation to a first thought reads this and not
   * `showableReceipt`, which is false during every recording, filing and review, and over a problem's notice: read by the invitation, it
   * would bring "Nothing filed yet" back for the length of each, in a library whose only filing was noted on an earlier day.
   */
  hasReceipt: boolean;
  /**
   * The newest dictations at the cursor, newest first (`MENU_DICTATIONS` at most). The menu then has Recent dictations: a click on one
   * copies its words, as the capsule's card and Settings offer when a paste misses, and "Forget the last dictation" takes the newest out of the history.
   */
  recentDictations: readonly MenuDictation[];
  /** Dictating into any app, with its key by name; null on a Mac that can't: it has no row then. */
  cursorDictation: { enabled: boolean; key: string } | null;
}

/** A dictation as the menu lists it. The whole words stay in the history, and a click copies them by `id`. */
export interface MenuDictation {
  id: string;
  /** When it was said, ISO: what the history keeps. */
  at: string;
  text: string;
  /** The app that had the cursor: none when Avanzel couldn't see one. */
  app: string;
}

/** How many dictations the menu lists. */
export const MENU_DICTATIONS = 3;

// Anything the owner has to read is an enabled item: macOS draws disabled items too dim to read.
export type MenuItemModel =
  | { type: "separator" }
  | { type: "submenu"; label: string; items: MenuItemModel[] }
  | { type: "item"; label: string; action: string; accelerator?: string; enabled?: boolean; shelf?: string; detail?: string; sublabel?: string; checked?: boolean };

const SEP: MenuItemModel = { type: "separator" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (from: Date, to: Date) => Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);

/** "21:00" today, "Tomorrow 09:05" or "Yesterday 23:59", "Sun 18:00" within the coming week, else "2 Nov 18:00". */
export function formatWhen(at: Date, now: Date): string {
  const days = daysBetween(now, at);
  if (days === 0) return hhmm(at);
  if (days === 1) return `Tomorrow ${hhmm(at)}`;
  if (days === -1) return `Yesterday ${hhmm(at)}`;
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

/** How today went, for the head of the menu: "Nothing filed today", "1 thought filed today" or "3 thoughts filed today". */
export function filedLine(filedToday: number): string {
  if (filedToday <= 0) return "Nothing filed today";
  return filedToday === 1 ? "1 thought filed today" : `${filedToday} thoughts filed today`;
}

/**
 * The second line of the head: what waits in the inbox, and when an evening review is on, its own name and its next time ("2 in the inbox · Evening
 * review at 21:00", "Evening review tomorrow at 21:00"); none with neither. `evening` is the soonest evening review that is on and has a time
 * to say. It is a review, not a letter: no letter is built yet.
 */
export function waitingLine(inbox: number, evening: MenuTask | undefined, now: Date): string | undefined {
  const parts = [...(inbox > 0 ? [`${inbox} in the inbox`] : []), ...(evening?.at ? [`${evening.name} ${nextPhrase(evening.at, now)}`] : [])];
  return parts.length ? parts.join(" · ") : undefined;
}

/** A dictation's row in the menu is cut to this many characters: a menu is as wide as its longest row, and it has no way to cut one itself. */
const DICTATION_ROW_CHARACTERS = 44;

/**
 * What a dictation's row shows: its words on one line, the first of them with an ellipsis when there are more. It counts whole characters, so a
 * character made of two UTF-16 units is never cut in half, and it leaves no space before the ellipsis.
 */
export function dictationRow(text: string): string {
  const characters = Array.from(text.replace(/\s+/g, " ").trim());
  if (characters.length <= DICTATION_ROW_CHARACTERS) return characters.join("");
  return `${characters.slice(0, DICTATION_ROW_CHARACTERS).join("").trimEnd()}…`;
}

/** A dictation's second line: the app it went to, and when, each when there is one to say. */
function dictationPlace({ app, at }: MenuDictation, now: Date): string | undefined {
  const moment = new Date(at);
  const parts = [app, Number.isNaN(moment.getTime()) ? "" : formatWhen(moment, now)].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
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

  // The soonest evening review that is on and has a time: the head names it. The reviews themselves are in their submenu.
  const evening = input.tasks
    .filter((t): t is MenuTask & { at: Date } => t.kind === "evening-review" && t.enabled && t.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];

  const shortcut = (key: keyof Shortcuts) => (input.unregisteredShortcuts.includes(key) ? {} : { accelerator: input.shortcuts[key] });
  // The click goes where the words say: while the head's second line names the inbox it opens the inbox, and with the inbox empty, when
  // its words no longer mention it, it opens the library.
  const waiting = waitingLine(input.inbox, evening, now);
  const head: MenuItemModel = { type: "item", label: filedLine(input.filedToday), action: input.inbox > 0 ? "open-inbox" : "open-library", ...(waiting ? { sublabel: waiting } : {}) };
  const items: MenuItemModel[] = [
    head,
    ...(input.speechProblem
      ? [{ type: "item" as const, label: input.speechProblem, action: "open-settings:voice", ...(input.speechSublabel ? { sublabel: input.speechSublabel } : {}) }]
      : []),
    SEP,
    { type: "item", label: input.recording ? "Stop recording" : "Record a thought", action: "dictate", ...shortcut("dictate") },
    { type: "item", label: "Capture screen…", action: "capture", ...shortcut("capture") },
    ...(input.callNotes === "ready" ? [{ type: "item" as const, label: "Take notes on a call…", action: "call-notes" }] : []),
    ...(input.callNotes === "running" ? [{ type: "item" as const, label: "Stop taking notes", action: "call-notes-stop" }] : []),
    ...(input.cutShortCalls > 0 ? [{ type: "item" as const, label: "Finish notes for a call that was cut short", action: "finish-cut-short" }] : []),
    { type: "item", label: "Type a thought…", action: "type", ...shortcut("type") },
    { type: "item", label: "Ask your library…", action: "ask", ...shortcut("ask") },
    SEP,
  ];

  // What has been done, and what is set to come. What is rare waits one hover away, in a submenu; a submenu with nothing to show isn't there, and with
  // none of this to show, nor is the section.
  const kept: MenuItemModel[] = [];
  if (!input.recent.length && input.filedToday === 0 && !input.undoableFiling && !input.hasReceipt) {
    // Nothing filed yet invites a first thought. What the owner has to read is an enabled item (see MenuItemModel), so this is
    // one, and it does what Record a thought does. It names the shortcut that action really has: none when it didn't register
    // or isn't set. Only while nothing has been filed: a filing that wrote no page (the agent only logged the note) leaves no page
    // to list, and the invitation would contradict the head's count, and the Undo and the receipt of that filing.
    const dictate = input.unregisteredShortcuts.includes("dictate") ? "" : input.shortcuts.dictate;
    const press = dictate ? `Press ${prettyAccelerator(dictate)}` : "Record a thought";
    kept.push({ type: "item", label: `Nothing filed yet. ${press} and say hello.`, action: "dictate" });
  }
  if (input.undoableFiling) kept.push({ type: "item", label: "Undo the last filing", action: "undo-filing", ...shortcut("undo") });

  const filed: MenuItemModel[] = [];
  for (const page of input.recent.slice(0, 3)) {
    const shelf = shelfLine(page.shelf);
    filed.push({ type: "item", label: page.title, action: `open:${page.path}`, shelf: page.shelf, ...(shelf ? { sublabel: shelf } : {}) });
  }
  // The newest filing's card can be printed again from here. A submenu's rows that act come apart from what it lists, as Recent dictations' do.
  if (input.showableReceipt) filed.push(...(filed.length ? [SEP] : []), { type: "item", label: "Show the last receipt", action: "show-receipt" });
  if (filed.length) kept.push({ type: "submenu", label: "Recently filed", items: filed });

  if (input.recentDictations.length) {
    const rows = input.recentDictations.slice(0, MENU_DICTATIONS).map((dictation): MenuItemModel => {
      const place = dictationPlace(dictation, now);
      return { type: "item", label: dictationRow(dictation.text), action: `copy-dictation:${dictation.id}`, ...(place ? { sublabel: place } : {}) };
    });
    kept.push({
      type: "submenu",
      label: "Recent dictations",
      items: [...rows, SEP, { type: "item", label: "Forget the last dictation", action: "forget-dictation" }, { type: "item", label: "Open history…", action: "open-settings:dictations" }],
    });
  }

  if (input.tasks.length || input.undoableReview) {
    const reviews: MenuItemModel[] = input.tasks.map((task) => {
      const detail = task.running ? (task.progress ?? "Running…") : task.enabled && task.at ? formatWhen(task.at, now) : "Off";
      return { type: "item", label: task.name, action: `task:${task.id}`, detail };
    });
    if (input.undoableReview) reviews.push(...(reviews.length ? [SEP] : []), { type: "item", label: "Undo the last evening review", action: "undo-review" });
    kept.push({ type: "submenu", label: "Scheduled reviews", items: reviews });
  }
  if (kept.length) items.push(...kept, SEP);

  // Its key in the detail: the one place the menu says which it is. macOS has no room beside a checkbox's words for a key held alone.
  if (input.cursorDictation) {
    items.push({ type: "item", label: "Dictate into any app", action: "toggle-dictation", detail: input.cursorDictation.key, checked: input.cursorDictation.enabled });
  }
  items.push(
    { type: "item", label: "Open library", action: "open-library" },
    { type: "item", label: "Settings…", action: "settings", accelerator: "Cmd+," },
    { type: "item", label: "Quit Avanzel", action: "quit", accelerator: "Cmd+Q" },
  );
  return items;
}

/** Every row of `menu` in the order it is read, with what is in a submenu in its submenu's place: for what looks for one row, wherever it lives. */
export function menuRows(menu: readonly MenuItemModel[]): Extract<MenuItemModel, { type: "item" }>[] {
  return menu.flatMap((item) => (item.type === "item" ? [item] : item.type === "submenu" ? menuRows(item.items) : []));
}
