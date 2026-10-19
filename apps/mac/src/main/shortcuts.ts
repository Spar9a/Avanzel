// Global shortcuts, with an owner-readable problem for each one that could not be registered.
import type { Shortcuts } from "../shared/ipc.ts";

export interface ShortcutApi {
  register(accelerator: string, callback: () => void): boolean;
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

export function registerShortcuts(
  shortcuts: Shortcuts,
  handlers: Record<keyof Shortcuts, () => void>,
  api: ShortcutApi,
): Partial<Record<keyof Shortcuts, string>> {
  api.unregisterAll();
  const problems: Partial<Record<keyof Shortcuts, string>> = {};
  for (const key of ["dictate", "capture", "type", "ask"] as const) {
    const accelerator = shortcuts[key];
    if (!accelerator) continue;
    try {
      if (!api.register(accelerator, handlers[key])) {
        problems[key] = `${prettyAccelerator(accelerator)} is already used by another app. Pick another shortcut.`;
      }
    } catch {
      problems[key] = `“${accelerator}” is not a shortcut macOS understands.`;
    }
  }
  return problems;
}
