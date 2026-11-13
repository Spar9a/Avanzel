// Settings' shortcut recorder reads each keydown as an Electron accelerator, and says which keys it lets go on to the app.
import { leftToApps } from "../../main/shortcuts.ts";

/** The keys that `code` names and an accelerator writes as a word or a mark. Letters, digits and F-keys follow from `code`. */
const MARKS: ReadonlyMap<string, string> = new Map([
  ["Space", "Space"], ["Backquote", "`"], ["Minus", "-"], ["Equal", "="], ["BracketLeft", "["], ["BracketRight", "]"],
  ["Backslash", "\\"], ["Semicolon", ";"], ["Quote", "'"], ["Comma", ","], ["Period", "."], ["Slash", "/"],
]);

/** The key `code` names as an accelerator writes it ("KeyS" is "S", "Digit5" is "5"); null for a modifier or a key not offered. */
function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(code)) return code;
  return MARKS.get(code) ?? null;
}

/**
 * A keydown as an Electron accelerator ("Alt+Shift+S"), its modifiers in the order Control, Alt, Shift, Command. Null
 * while only modifiers are down, and for a shortcut Avanzel leaves to apps (leftToApps, which main keeps to as well): one
 * without Control or Alt, other than a bare F1–F24. Keys come from `code`.
 */
export function toAccelerator(key: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  const name = keyName(key.code);
  if (!name) return null;
  const modifiers = [key.ctrlKey && "Control", key.altKey && "Alt", key.shiftKey && "Shift", key.metaKey && "Command"].filter(
    (modifier) => modifier !== false,
  );
  const accelerator = [...modifiers, name].join("+");
  return leftToApps(accelerator) ? null : accelerator;
}

/**
 * A whole shortcut the recorder won't take because it has neither Control nor Alt (⌘⇧R, ⇧R, a plain K), as the same keys
 * with Alt instead of Command, which it would take ("Alt+Shift+R"): the person is told why, and what to try. Null for a
 * shortcut it takes, a bare F-key, a modifier on its own, or a key it never offers (Escape, Enter, Tab).
 */
export function refusedShortcut(key: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  const name = keyName(key.code);
  if (!name || key.ctrlKey || key.altKey) return null;
  if (!key.shiftKey && !key.metaKey && /^F\d+$/.test(name)) return null;
  return ["Alt", key.shiftKey && "Shift", name].filter((part) => part !== false).join("+");
}

/**
 * Whether the recorder lets a keydown go on to the app: one with Command and without Control or Alt, which it never
 * takes, so the app's own ⌘ keys work while it listens (⌘Q quits, ⌘H hides). It keeps every other key from the page, so
 * a plain Space or Return doesn't press the focused button.
 */
export function passesThrough(key: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey">): boolean {
  return key.metaKey && !key.ctrlKey && !key.altKey;
}
