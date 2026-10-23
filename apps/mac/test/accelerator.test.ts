import { describe, expect, it } from "vitest";
import { toAccelerator } from "../src/renderer/settings/accelerator.ts";

type Modifier = "ctrl" | "alt" | "shift" | "meta";

/** A keydown of the key `code` names, with the `held` modifiers down. */
function down(code: string, ...held: Modifier[]) {
  return { code, ctrlKey: held.includes("ctrl"), altKey: held.includes("alt"), shiftKey: held.includes("shift"), metaKey: held.includes("meta") };
}

describe("toAccelerator", () => {
  it("a key with modifiers becomes an accelerator", () => {
    expect(toAccelerator(down("KeyS", "alt", "shift"))).toBe("Alt+Shift+S");
    expect(toAccelerator(down("Space", "ctrl", "alt"))).toBe("Control+Alt+Space");
    expect(toAccelerator(down("Digit5", "meta"))).toBe("Command+5");
    expect(toAccelerator(down("Comma", "shift", "meta"))).toBe("Shift+Command+,");
    // The modifiers keep the order Control, Alt, Shift, Command, whichever way they were pressed.
    expect(toAccelerator(down("KeyK", "meta", "shift", "alt", "ctrl"))).toBe("Control+Alt+Shift+Command+K");
  });

  it("F-keys need no modifier", () => {
    expect(toAccelerator(down("F5"))).toBe("F5");
    expect(toAccelerator(down("F1"))).toBe("F1");
    expect(toAccelerator(down("F24"))).toBe("F24");
    expect(toAccelerator(down("F5", "alt"))).toBe("Alt+F5");
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
