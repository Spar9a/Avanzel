// Settings' shortcut recorder reads each keydown as an Electron accelerator.

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
 * A keydown as an Electron accelerator ("Alt+Shift+S"), its modifiers in the order Control, Alt, Shift, Command; null
 * while only modifiers are down, and for a key without a modifier other than F1–F24. Keys come from `code`.
 */
export function toAccelerator(key: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  const name = keyName(key.code);
  if (!name) return null;
  const modifiers = [key.ctrlKey && "Control", key.altKey && "Alt", key.shiftKey && "Shift", key.metaKey && "Command"].filter(
    (modifier) => modifier !== false,
  );
  if (modifiers.length === 0 && !/^F\d/.test(name)) return null;
  return [...modifiers, name].join("+");
}
