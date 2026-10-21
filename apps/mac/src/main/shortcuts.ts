// Global shortcuts, with an owner-readable problem for each one that could not be registered, and free ones to offer
// in place of a shortcut another app holds.
import type { Shortcuts } from "../shared/ipc.ts";

export interface ShortcutApi {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  unregisterAll(): void;
}

const ORDER = ["Control", "Alt", "Shift", "Command"] as const;
const SYMBOL: Record<(typeof ORDER)[number], string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Command: "⌘" };
const ALIASES: Record<string, (typeof ORDER)[number]> = {
  ctrl: "Control", control: "Control", alt: "Alt", option: "Alt", shift: "Shift",
  cmd: "Command", command: "Command", commandorcontrol: "Command", cmdorctrl: "Command", super: "Command", meta: "Command",
};

/** "Alt+Shift+S" → "⌥⇧S", in the modifier order macOS menus use. */
export function prettyAccelerator(accelerator: string): string {
  const parts = accelerator.split("+");
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((p) => ALIASES[p.toLowerCase()]).filter(Boolean));
  return ORDER.filter((m) => mods.has(m)).map((m) => SYMBOL[m]).join("") + key;
}

/**
 * The shortcuts offered in place of one another app holds, best first. None is one of macOS's own: they keep clear of
 * ⌃Space and ⌃⌥Space (input sources), ⌘Space and ⌥⌘Space (Spotlight), ⌃⌘Space (emoji and symbols) and ⌥⌘D (the Dock).
 */
export const ALTERNATIVES: Readonly<Record<keyof Shortcuts, readonly string[]>> = {
  dictate: ["Control+Shift+Space", "Control+Alt+R", "Control+Alt+D"],
  capture: ["Control+Alt+S", "Control+Alt+C"],
  type: ["Control+Alt+T", "Control+Alt+N"],
  ask: ["Control+Alt+A", "Control+Alt+Q"],
};

/** The apps whose default shortcut is ⌥Space, each with the name `ps` gives its process. */
const ALT_SPACE_APPS: readonly { name: string; process: string }[] = [
  { name: "Alfred", process: "Alfred" },
  { name: "Raycast", process: "Raycast" },
  { name: "ChatGPT", process: "ChatGPT" },
  { name: "Superwhisper", process: "superwhisper" },
];

/** The app that probably holds `accelerator`, going by the processes `running`: only ⌥Space, four apps' default, has one. */
export function likelyHolder(accelerator: string, running: readonly string[]): string | null {
  if (prettyAccelerator(accelerator) !== "⌥Space") return null;
  const processes = new Set(running.map((name) => name.toLowerCase()));
  return ALT_SPACE_APPS.find((app) => processes.has(app.process.toLowerCase()))?.name ?? null;
}

/** "⌥Space is used by another app, probably Alfred.": what happened to a shortcut another app holds. */
export function takenMessage(accelerator: string, holder: string | null): string {
  return `${prettyAccelerator(accelerator)} is used by another app${holder ? `, probably ${holder}` : ""}.`;
}

export interface Registration {
  /** What Settings → Voice says of each shortcut that didn't register. */
  problems: Partial<Record<keyof Shortcuts, string>>;
  /** The actions whose shortcut another app holds, in the order they register; not one macOS doesn't understand. */
  taken: (keyof Shortcuts)[];
}

/** Registers every action's shortcut. `running` (process names) names the app that probably holds a taken one. */
export function registerShortcuts(
  shortcuts: Shortcuts,
  handlers: Record<keyof Shortcuts, () => void>,
  api: ShortcutApi,
  running: readonly string[] = [],
): Registration {
  api.unregisterAll();
  const problems: Partial<Record<keyof Shortcuts, string>> = {};
  const taken: (keyof Shortcuts)[] = [];
  for (const key of ["dictate", "capture", "type", "ask"] as const) {
    const accelerator = shortcuts[key];
    if (!accelerator) continue;
    try {
      if (!api.register(accelerator, handlers[key])) {
        problems[key] = `${takenMessage(accelerator, likelyHolder(accelerator, running))} Pick another shortcut.`;
        taken.push(key);
      }
    } catch {
      problems[key] = `“${accelerator}” is not a shortcut macOS understands.`;
    }
  }
  return { problems, taken };
}

/**
 * Up to `count` of `key`'s ALTERNATIVES that are free now, best first. One Avanzel already uses for an action is
 * skipped. Each other one is tried by registering it, and let go of at once; one that throws counts as taken.
 */
export function freeAlternatives(key: keyof Shortcuts, shortcuts: Shortcuts, api: ShortcutApi, count = 2): string[] {
  const used = new Set(Object.values(shortcuts));
  const free: string[] = [];
  for (const candidate of ALTERNATIVES[key]) {
    if (free.length >= count) break;
    if (used.has(candidate)) continue;
    let registered: boolean;
    try {
      registered = api.register(candidate, () => {});
    } catch {
      registered = false;
    }
    if (!registered) continue;
    api.unregister(candidate);
    free.push(candidate);
  }
  return free;
}
