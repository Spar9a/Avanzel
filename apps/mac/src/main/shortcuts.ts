// Global shortcuts, with an owner-readable problem for each one that could not be registered, and free ones to offer
// in place of a shortcut another app holds.
import type { Shortcuts } from "../shared/ipc.ts";

export interface ShortcutApi {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  unregisterAll(): void;
}

/**
 * Each action by its role name: its item in the menu bar menu, which adds "…" to some. Undo the last filing's item is there only after a
 * filing. The actions register in this order (`registerShortcuts`), and Settings → Shortcuts draws a row for each, in it.
 */
export const ACTION_NAMES: Readonly<Record<keyof Shortcuts, string>> = {
  dictate: "Record a thought",
  capture: "Capture screen",
  type: "Type a thought",
  ask: "Ask your library",
  undo: "Undo the last filing",
  call: "Take notes on a call",
  region: "Capture part of the screen",
  shot: "Screenshot of a part",
  shotScreen: "Screenshot of the screen",
  shotMarks: "Screenshot with marks",
};

const ORDER = ["Control", "Alt", "Shift", "Command"] as const;
const SYMBOL: Record<(typeof ORDER)[number], string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Command: "⌘" };
const ALIASES: Record<string, (typeof ORDER)[number]> = {
  ctrl: "Control", control: "Control", alt: "Alt", option: "Alt", shift: "Shift",
  cmd: "Command", command: "Command", commandorcontrol: "Command", cmdorctrl: "Command", super: "Command", meta: "Command",
};

/** "Alt+Space" → ["⌥", "Space"]: the keys to press, each modifier as its symbol in the order macOS menus use, then the key. */
export function keyCaps(accelerator: string): string[] {
  const parts = accelerator.split("+");
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((p) => ALIASES[p.toLowerCase()]).filter(Boolean));
  const caps = ORDER.filter((m) => mods.has(m)).map((m) => SYMBOL[m]);
  return key ? [...caps, key] : caps;
}

/** "Alt+Shift+S" → "⌥⇧S", in the modifier order macOS menus use. */
export function prettyAccelerator(accelerator: string): string {
  return keyCaps(accelerator).join("");
}

/** F1 to F24, the keys a shortcut may be on their own. */
const F_KEY = /^F(?:[1-9]|1\d|2[0-4])$/i;

/**
 * Whether `accelerator` is a shortcut Avanzel leaves to apps: one without Control or Alt (Option), other than a bare
 * F1–F24. With Command or Shift alone, or no modifier, a global shortcut would take a key every app uses for itself, ⌘W
 * to close a window, ⌘C to copy, ⇧A to type a capital A. Shift and Command are fine beside Control or Alt. Something
 * that isn't a shortcut at all, with a modifier macOS doesn't know or no key but a modifier, isn't one: registering it
 * says so. Settings' recorder (toAccelerator) and registerShortcuts both keep to it.
 */
export function leftToApps(accelerator: string): boolean {
  const parts = accelerator.split("+");
  const key = parts.pop() ?? "";
  const mods = parts.map((part) => ALIASES[part.toLowerCase()]);
  if (mods.some((mod) => mod === undefined) || ALIASES[key.toLowerCase()]) return false;
  if (mods.includes("Control") || mods.includes("Alt")) return false;
  return !(mods.length === 0 && F_KEY.test(key));
}

/** Each modifier as a keydown names it (KeyboardEvent.key). */
const MODIFIER_KEY: Record<(typeof ORDER)[number], string> = { Control: "Control", Alt: "Alt", Shift: "Shift", Command: "Meta" };

/**
 * The key that goes down as a person reaches for `accelerator`, as a keydown names it (KeyboardEvent.key): its first
 * modifier in the order macOS menus use, "Alt" for Alt+Space. Null for a shortcut without a modifier.
 */
export function reachKey(accelerator: string): string | null {
  const mods = new Set(accelerator.split("+").slice(0, -1).map((p) => ALIASES[p.toLowerCase()]).filter(Boolean));
  const first = ORDER.find((m) => mods.has(m));
  return first ? MODIFIER_KEY[first] : null;
}

/**
 * The shortcuts offered in place of one another app holds, best first. They keep clear of the system shortcuts named here: ⌃Space and
 * ⌃⌥Space (input sources), ⌘Space and ⌥⌘Space (Spotlight), ⌃⌘Space (emoji and symbols) and ⌥⌘D (the Dock). Not of every key macOS has:
 * with VoiceOver on, ⌃⌥ is its modifier, so the ⌃⌥ ones meet VoiceOver's own keys. That is a known cost of offering ⌃⌥ and a letter, and
 * an owner item.
 */
export const ALTERNATIVES: Readonly<Record<keyof Shortcuts, readonly string[]>> = {
  dictate: ["Control+Shift+Space", "Control+Alt+R", "Control+Alt+D"],
  capture: ["Control+Alt+S", "Control+Alt+C"],
  type: ["Control+Alt+T", "Control+Alt+N"],
  ask: ["Control+Alt+A", "Control+Alt+Q"],
  undo: ["Control+Alt+Z", "Control+Alt+U"],
  call: ["Control+Alt+M", "Control+Alt+K"],
  region: ["Control+Alt+P", "Control+Alt+X"],
  shot: ["Control+Alt+G", "Control+Alt+H"],
  shotScreen: ["Control+Alt+J", "Control+Alt+L"],
  shotMarks: ["Control+Alt+B", "Control+Alt+V"],
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

/**
 * "“Record a thought” is still in the menu bar.": where the action's item is, for the notices of a shortcut that doesn't work (the
 * capsule's, and Settings → Shortcuts'). Undo the last filing's item is in the menu bar only after a filing, so it is not "still" there.
 */
export function inMenuLine(key: keyof Shortcuts): string {
  return `“${ACTION_NAMES[key]}” ${key === "undo" ? "is in the menu bar after each filing" : "is still in the menu bar"}.`;
}

export interface Registration {
  /** What Settings → Shortcuts says of each shortcut that didn't register. */
  problems: Partial<Record<keyof Shortcuts, string>>;
  /**
   * The actions whose shortcut another app holds, or apps use themselves (leftToApps), in the order they register: not
   * one macOS doesn't understand, nor one an earlier action of Avanzel's has.
   */
  taken: (keyof Shortcuts)[];
}

/** The same shortcut however it is written ("Alt+Space", "Option+space"): as macOS shows it, in one case. */
const sameShortcut = (accelerator: string) => prettyAccelerator(accelerator).toLowerCase();

/**
 * Registers every action's shortcut. One an earlier action has already is not registered again: it isn't another
 * app's, and gets no free ones. `running` (process names) names the app that probably holds a taken one. One Avanzel
 * leaves to apps (leftToApps), from a hand-edited settings.json or an older recorder, isn't registered at all: it counts
 * as taken, so its free ones are offered as for a shortcut another app holds.
 */
export function registerShortcuts(
  shortcuts: Shortcuts,
  handlers: Record<keyof Shortcuts, () => void>,
  api: ShortcutApi,
  running: readonly string[] = [],
): Registration {
  api.unregisterAll();
  const problems: Partial<Record<keyof Shortcuts, string>> = {};
  const taken: (keyof Shortcuts)[] = [];
  const owners = new Map<string, keyof Shortcuts>(); // each shortcut macOS understands, by the action that has it
  for (const key of Object.keys(ACTION_NAMES) as (keyof Shortcuts)[]) {
    const accelerator = shortcuts[key];
    if (!accelerator) continue;
    if (leftToApps(accelerator)) {
      problems[key] = `${prettyAccelerator(accelerator)} is a shortcut apps use themselves, so Avanzel doesn't take it. Pick one with ⌃ or ⌥.`;
      taken.push(key);
      continue;
    }
    const owner = owners.get(sameShortcut(accelerator));
    if (owner) {
      problems[key] = `${prettyAccelerator(shortcuts[owner])} is already the shortcut for ${ACTION_NAMES[owner]}. Pick another shortcut.`;
      continue;
    }
    try {
      if (!api.register(accelerator, handlers[key])) {
        problems[key] = `${takenMessage(accelerator, likelyHolder(accelerator, running))} Pick another shortcut.`;
        taken.push(key);
      }
      owners.set(sameShortcut(accelerator), key);
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
