import { describe, expect, it } from "vitest";
import { passesThrough, refusedShortcut, toAccelerator } from "../src/renderer/settings/accelerator.ts";

type Modifier = "ctrl" | "alt" | "shift" | "meta";

/** A keydown of the key `code` names, with the `held` modifiers down. */
function down(code: string, ...held: Modifier[]) {
  return { code, ctrlKey: held.includes("ctrl"), altKey: held.includes("alt"), shiftKey: held.includes("shift"), metaKey: held.includes("meta") };
}

describe("toAccelerator", () => {
  it("a key with Control or Alt becomes an accelerator, with Shift and Command allowed alongside", () => {
    expect(toAccelerator(down("KeyS", "alt", "shift"))).toBe("Alt+Shift+S");
    expect(toAccelerator(down("KeyK", "alt", "shift"))).toBe("Alt+Shift+K");
    expect(toAccelerator(down("Space", "ctrl", "alt"))).toBe("Control+Alt+Space");
    expect(toAccelerator(down("KeyW", "ctrl", "meta"))).toBe("Control+Command+W");
    expect(toAccelerator(down("Digit5", "ctrl"))).toBe("Control+5");
    expect(toAccelerator(down("Comma", "alt", "shift", "meta"))).toBe("Alt+Shift+Command+,");
    // The modifiers keep the order Control, Alt, Shift, Command, whichever way they were pressed.
    expect(toAccelerator(down("KeyK", "meta", "shift", "alt", "ctrl"))).toBe("Control+Alt+Shift+Command+K");
  });

  it("a key with only Command or Shift is one apps use themselves, so nothing is saved", () => {
    expect(toAccelerator(down("KeyW", "meta"))).toBeNull();
    expect(toAccelerator(down("KeyZ", "meta", "shift"))).toBeNull();
    expect(toAccelerator(down("KeyA", "shift"))).toBeNull();
    expect(toAccelerator(down("Digit5", "meta"))).toBeNull();
    expect(toAccelerator(down("Comma", "shift", "meta"))).toBeNull();
  });

  it("an F-key needs no modifier, and with one it needs Control or Alt", () => {
    expect(toAccelerator(down("F5"))).toBe("F5");
    expect(toAccelerator(down("F1"))).toBe("F1");
    expect(toAccelerator(down("F24"))).toBe("F24");
    expect(toAccelerator(down("F5", "alt"))).toBe("Alt+F5");
    expect(toAccelerator(down("F5", "shift"))).toBeNull();
    expect(toAccelerator(down("F5", "meta"))).toBeNull();
  });

  it("nothing is saved for a key without a modifier, or for modifiers alone", () => {
    expect(toAccelerator(down("KeyA"))).toBeNull();
    expect(toAccelerator(down("Space"))).toBeNull();
    expect(toAccelerator(down("AltLeft", "alt"))).toBeNull();
    expect(toAccelerator(down("ShiftLeft", "shift"))).toBeNull();
    expect(toAccelerator(down("Escape"))).toBeNull();
    // Only F1 to F24 are F-keys.
    expect(toAccelerator(down("F25"))).toBeNull();
    expect(toAccelerator(down("F0", "alt"))).toBeNull();
  });
});

describe("passesThrough", () => {
  it("lets a Command combination the recorder won't take go on to the app, so ⌘Q still quits", () => {
    expect(passesThrough(down("KeyW", "meta"))).toBe(true);
    expect(passesThrough(down("KeyQ", "meta"))).toBe(true);
    expect(passesThrough(down("KeyZ", "meta", "shift"))).toBe(true);
    expect(passesThrough(down("Digit5", "meta"))).toBe(true);
  });

  it("keeps every other key from the page: a plain Space or Return mustn't press the focused button", () => {
    expect(passesThrough(down("KeyK"))).toBe(false);
    expect(passesThrough(down("Space"))).toBe(false);
    expect(passesThrough(down("Enter"))).toBe(false);
    expect(passesThrough(down("KeyA", "shift"))).toBe(false);
    expect(passesThrough(down("KeyW", "ctrl", "meta"))).toBe(false);
    expect(passesThrough(down("KeyW", "alt", "meta"))).toBe(false);
    expect(passesThrough(down("KeyK", "ctrl", "alt"))).toBe(false);
  });
});

describe("refusedShortcut", () => {
  it("a whole shortcut without Control or Alt is refused, and the same keys with Alt are offered instead", () => {
    expect(refusedShortcut(down("KeyR", "meta", "shift"))).toBe("Alt+Shift+R");
    expect(refusedShortcut(down("KeyR", "meta"))).toBe("Alt+R");
    expect(refusedShortcut(down("KeyR", "shift"))).toBe("Alt+Shift+R");
    expect(refusedShortcut(down("KeyK"))).toBe("Alt+K");
    expect(refusedShortcut(down("Space", "meta", "shift"))).toBe("Alt+Shift+Space");
    expect(refusedShortcut(down("Digit5", "meta"))).toBe("Alt+5");
  });

  it("a shortcut it takes, a bare F-key, a lone modifier or a key it never offers is not refused", () => {
    expect(refusedShortcut(down("KeyR", "alt", "shift"))).toBeNull();
    expect(refusedShortcut(down("KeyK", "ctrl"))).toBeNull();
    expect(refusedShortcut(down("KeyW", "ctrl", "meta"))).toBeNull();
    expect(refusedShortcut(down("F5"))).toBeNull();
    expect(refusedShortcut(down("MetaLeft", "meta"))).toBeNull();
    expect(refusedShortcut(down("ShiftRight", "shift"))).toBeNull();
    expect(refusedShortcut(down("Escape"))).toBeNull();
    expect(refusedShortcut(down("Enter"))).toBeNull();
    expect(refusedShortcut(down("Tab"))).toBeNull();
  });
});
