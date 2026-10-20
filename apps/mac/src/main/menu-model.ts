// What the menu bar menu shows, as plain data; tray.ts turns it into an Electron menu.
import type { FiledPage, Shortcuts } from "../shared/ipc.ts";

export interface MenuTask {
  id: string;
  name: string;
  at: Date | null;
  enabled: boolean;
  running: boolean;
}

export interface MenuInput {
  libraryReady: boolean;
  /** Why the library couldn't be opened, if that is why it isn't ready. */
  problem?: string | null;
  inbox: number;
  recent: FiledPage[];
  tasks: MenuTask[];
  recording: boolean;
  shortcuts: Shortcuts;
  undoableReview: boolean;
}

export type MenuItemModel =
  | { type: "separator" }
  | { type: "header"; label: string; sublabel?: string }
  | { type: "item"; label: string; action: string; accelerator?: string; enabled?: boolean; shelf?: string; detail?: string };

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

export function buildMenuModel(input: MenuInput, now: Date): MenuItemModel[] {
  if (!input.libraryReady) {
    return [
      { type: "header", label: "Avanzel", sublabel: input.problem || "Choose a folder for your library to start." },
      SEP,
      { type: "item", label: "Set up Avanzel…", action: "settings" },
      SEP,
      { type: "item", label: "Quit Avanzel", action: "quit", accelerator: "Cmd+Q" },
    ];
  }

  const inbox = input.inbox === 0 ? "Inbox is empty." : input.inbox === 1 ? "1 note in the inbox." : `${input.inbox} notes in the inbox.`;
  const upcoming = input.tasks
    .filter((t): t is MenuTask & { at: Date } => t.enabled && t.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  const sublabel = upcoming ? `${inbox} Next: ${upcoming.name} ${nextPhrase(upcoming.at, now)}.` : inbox;

  const items: MenuItemModel[] = [
    { type: "header", label: "Avanzel", sublabel },
    SEP,
    {
      type: "item",
      label: input.recording ? "Stop recording" : "Record a thought",
      action: "dictate",
      accelerator: input.shortcuts.dictate,
    },
    { type: "item", label: "Capture screen with a comment", action: "capture", accelerator: input.shortcuts.capture },
    { type: "item", label: "Type a thought…", action: "type", accelerator: input.shortcuts.type },
    { type: "item", label: "Ask your library…", action: "ask", accelerator: input.shortcuts.ask },
    SEP,
  ];

  if (input.recent.length) {
    items.push({ type: "header", label: "Recently filed" });
    for (const page of input.recent.slice(0, 3)) {
      items.push({ type: "item", label: page.title, action: `open:${page.path}`, shelf: page.shelf });
    }
    items.push(SEP);
  }

  if (input.tasks.length || input.undoableReview) {
    items.push({ type: "header", label: "Shadow tasks" });
    for (const task of input.tasks) {
      const detail = task.running ? "Running…" : task.enabled && task.at ? formatWhen(task.at, now) : "Off";
      items.push({ type: "item", label: task.name, action: `task:${task.id}`, detail });
    }
    if (input.undoableReview) items.push({ type: "item", label: "Undo last evening review", action: "undo-review" });
    items.push(SEP);
  }

  items.push(
    { type: "item", label: "Open library", action: "open-library" },
    { type: "item", label: "Settings…", action: "settings", accelerator: "Cmd+," },
    { type: "item", label: "Quit Avanzel", action: "quit", accelerator: "Cmd+Q" },
  );
  return items;
}
