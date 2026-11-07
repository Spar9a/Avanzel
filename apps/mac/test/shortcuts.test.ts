import { describe, expect, it, vi } from "vitest";
import {
  ALTERNATIVES,
  freeAlternatives,
  inMenuLine,
  keyCaps,
  leftToApps,
  likelyHolder,
  prettyAccelerator,
  reachKey,
  registerShortcuts,
  type ShortcutApi,
} from "../src/main/shortcuts.ts";
import { DEFAULT_SETTINGS } from "../src/main/store.ts";

const handlers = () => ({ dictate: vi.fn(), capture: vi.fn(), type: vi.fn(), ask: vi.fn(), undo: vi.fn(), call: vi.fn(), region: vi.fn(), shot: vi.fn(), shotScreen: vi.fn(), shotMarks: vi.fn() });

/** Global shortcuts as other apps leave them: `taken` are held elsewhere, `invalid` throw, and `registered` is what this app holds. */
function fakeApi({ taken = [], invalid = [] }: { taken?: readonly string[]; invalid?: readonly string[] } = {}) {
  const registered = new Set<string>();
  const api: ShortcutApi = {
    register: (accelerator) => {
      if (invalid.includes(accelerator)) throw new Error("bad accelerator");
      if (taken.includes(accelerator) || registered.has(accelerator)) return false;
      registered.add(accelerator);
      return true;
    },
    unregister: (accelerator) => void registered.delete(accelerator),
    unregisterAll: () => registered.clear(),
  };
  return { api, registered };
}

describe("global shortcuts", () => {
  it("registers each action and reports the ones another app already holds", () => {
    const registered: string[] = [];
    const api = {
      register: vi.fn((accelerator: string) => {
        if (accelerator === "Alt+Space") return false;
        registered.push(accelerator);
        return true;
      }),
      unregister: vi.fn(),
      unregisterAll: vi.fn(),
    };
    const { problems, taken } = registerShortcuts(DEFAULT_SETTINGS.shortcuts, handlers(), api);
    expect(api.unregisterAll).toHaveBeenCalledOnce();
    expect(registered).toEqual(["Alt+Shift+S", "Alt+Shift+Space", "Alt+Shift+A", "Alt+Shift+Z", "Alt+Shift+C", "Alt+Shift+R", "Alt+Shift+X", "Alt+Shift+E", "Alt+Shift+M"]);
    expect(problems).toEqual({ dictate: "⌥Space is used by another app. Pick another shortcut." });
    expect(taken).toEqual(["dictate"]);
  });

  it("a shortcut an earlier action has is that action's, not another app's", () => {
    const { api, registered } = fakeApi();
    // Written another way, ⌥Space is still Record a thought's.
    const { problems, taken } = registerShortcuts({ ...DEFAULT_SETTINGS.shortcuts, type: "Option+space" }, handlers(), api, ["Alfred"]);
    expect(problems).toEqual({ type: "⌥Space is already the shortcut for Record a thought. Pick another shortcut." });
    expect(taken).toEqual([]); // so no launch notice and no free ones
    expect([...registered]).toEqual(["Alt+Space", "Alt+Shift+S", "Alt+Shift+A", "Alt+Shift+Z", "Alt+Shift+C", "Alt+Shift+R", "Alt+Shift+X", "Alt+Shift+E", "Alt+Shift+M"]); // and it isn't tried again
  });

  it("a shortcut an earlier action has is that action's even when another app holds it", () => {
    const { api } = fakeApi({ taken: ["Alt+Space"] });
    const { problems, taken } = registerShortcuts({ ...DEFAULT_SETTINGS.shortcuts, ask: "Alt+Space" }, handlers(), api);
    expect(problems).toEqual({
      dictate: "⌥Space is used by another app. Pick another shortcut.",
      ask: "⌥Space is already the shortcut for Record a thought. Pick another shortcut.",
    });
    expect(taken).toEqual(["dictate"]);
  });

  it("registers Undo the last filing fifth, so a clash names the earlier action", () => {
    const { api, registered } = fakeApi();
    const { problems, taken } = registerShortcuts({ ...DEFAULT_SETTINGS.shortcuts, undo: "Alt+Shift+A" }, handlers(), api);
    expect(problems).toEqual({ undo: "⌥⇧A is already the shortcut for Ask your library. Pick another shortcut." });
    expect(taken).toEqual([]); // it isn't another app's, so no launch notice and no free ones
    expect([...registered]).toEqual(["Alt+Space", "Alt+Shift+S", "Alt+Shift+Space", "Alt+Shift+A", "Alt+Shift+C", "Alt+Shift+R", "Alt+Shift+X", "Alt+Shift+E", "Alt+Shift+M"]);
  });

  it("a shortcut without ⌃ or ⌥, such as one a hand-edited settings.json holds, isn't registered: apps use it themselves", () => {
    const { api, registered } = fakeApi();
    const { problems, taken } = registerShortcuts({ ...DEFAULT_SETTINGS.shortcuts, type: "Command+W" }, handlers(), api);
    expect(problems).toEqual({ type: "⌘W is a shortcut apps use themselves, so Avanzel doesn't take it. Pick one with ⌃ or ⌥." });
    expect(taken).toEqual(["type"]); // so its free ones are offered, as for one another app holds
    expect([...registered]).toEqual(["Alt+Space", "Alt+Shift+S", "Alt+Shift+A", "Alt+Shift+Z", "Alt+Shift+C", "Alt+Shift+R", "Alt+Shift+X", "Alt+Shift+E", "Alt+Shift+M"]); // the others are; ⌘W never was
  });

  it("leftToApps: a shortcut needs Control or Alt, or is a bare F-key", () => {
    for (const accelerator of ["Command+W", "Command+Shift+Z", "Shift+A", "Cmd+C", "CommandOrControl+Q", "Space", "K", "Shift+F5", "Command+F5"]) {
      expect(leftToApps(accelerator), accelerator).toBe(true);
    }
    for (const accelerator of ["Alt+Space", "Option+Shift+K", "Control+Command+W", "Ctrl+5", "F5", "f12"]) {
      expect(leftToApps(accelerator), accelerator).toBe(false);
    }
    // Something that isn't a shortcut at all isn't one apps use: registering it says macOS doesn't understand it.
    expect(leftToApps("Hyper+Q")).toBe(false);
    expect(leftToApps("Alt")).toBe(false);
  });

  it("reports shortcuts Electron cannot parse", () => {
    const { api } = fakeApi({ invalid: ["Hyper+Q"] });
    const { problems, taken } = registerShortcuts({ ...DEFAULT_SETTINGS.shortcuts, ask: "Hyper+Q" }, handlers(), api);
    expect(problems).toEqual({ ask: "“Hyper+Q” is not a shortcut macOS understands." });
    expect(taken).toEqual([]); // no other app holds it: macOS doesn't understand it
  });

  it("names the app that probably holds ⌥Space", () => {
    const { api } = fakeApi({ taken: ["Alt+Space"] });
    expect(registerShortcuts(DEFAULT_SETTINGS.shortcuts, handlers(), api, ["Finder", "Alfred"]).problems).toEqual({
      dictate: "⌥Space is used by another app, probably Alfred. Pick another shortcut.",
    });
    expect(registerShortcuts(DEFAULT_SETTINGS.shortcuts, handlers(), api).problems).toEqual({
      dictate: "⌥Space is used by another app. Pick another shortcut.",
    });
  });

  it("only ⌥Space has a likely holder", () => {
    expect(likelyHolder("Alt+Shift+S", ["Alfred"])).toBeNull();
    expect(likelyHolder("Alt+Space", ["superwhisper"])).toBe("Superwhisper");
    expect(likelyHolder("Alt+Space", ["superwhisper", "RAYCAST"])).toBe("Raycast"); // Raycast comes first in the list
    expect(likelyHolder("Alt+Space", ["Finder"])).toBeNull();
  });

  it("keyCaps splits a shortcut into keycaps in macOS order", () => {
    expect(keyCaps("Alt+Space")).toEqual(["⌥", "Space"]);
    expect(keyCaps("Control+Shift+Space")).toEqual(["⌃", "⇧", "Space"]);
    expect(keyCaps("Command+Alt+K")).toEqual(["⌥", "⌘", "K"]); // written in another order, drawn in macOS's
  });

  it("reachKey is the shortcut's first modifier, as a keydown names it", () => {
    expect(reachKey("Alt+Space")).toBe("Alt");
    expect(reachKey("Option+Space")).toBe("Alt");
    expect(reachKey("Control+Shift+Space")).toBe("Control");
    expect(reachKey("Shift+Control+Space")).toBe("Control"); // written in another order, reached for in macOS's
    expect(reachKey("CommandOrControl+Shift+K")).toBe("Shift");
    expect(reachKey("Command+K")).toBe("Meta");
    expect(reachKey("F13")).toBeNull();
  });
});

describe("inMenuLine: where an action's item is in the menu bar", () => {
  it("says each item is still there, except Undo the last filing's, which is there after each filing", () => {
    expect(inMenuLine("dictate")).toBe("“Record a thought” is still in the menu bar.");
    expect(inMenuLine("capture")).toBe("“Capture screen” is still in the menu bar.");
    expect(inMenuLine("type")).toBe("“Type a thought” is still in the menu bar.");
    expect(inMenuLine("ask")).toBe("“Ask your library” is still in the menu bar.");
    expect(inMenuLine("undo")).toBe("“Undo the last filing” is in the menu bar after each filing.");
  });
});

describe("free alternatives", () => {
  it("offers the first two free alternatives and leaves none registered", () => {
    const { api, registered } = fakeApi({ taken: ["Control+Shift+Space"] });
    expect(freeAlternatives("dictate", DEFAULT_SETTINGS.shortcuts, api)).toEqual(["Control+Alt+R", "Control+Alt+D"]);
    expect([...registered]).toEqual([]);
  });

  it("never offers a shortcut Avanzel already uses", () => {
    const { api } = fakeApi();
    expect(freeAlternatives("dictate", { ...DEFAULT_SETTINGS.shortcuts, type: "Control+Alt+R" }, api)).toEqual([
      "Control+Shift+Space",
      "Control+Alt+D",
    ]);
  });

  it("offers ⌃⌥Z and ⌃⌥U in place of a taken ⌥⇧Z", () => {
    const { api, registered } = fakeApi({ taken: ["Alt+Shift+Z"] });
    expect(freeAlternatives("undo", DEFAULT_SETTINGS.shortcuts, api)).toEqual(["Control+Alt+Z", "Control+Alt+U"]);
    expect([...registered]).toEqual([]);
  });

  it("offers nothing when every candidate is taken", () => {
    // One that throws counts as taken too.
    const { api } = fakeApi({ taken: ["Control+Shift+Space", "Control+Alt+R"], invalid: ["Control+Alt+D"] });
    expect(freeAlternatives("dictate", DEFAULT_SETTINGS.shortcuts, api)).toEqual([]);
  });

  it("keeps clear of the shortcuts macOS has for itself", () => {
    const system = ["⌃Space", "⌃⌥Space", "⌘Space", "⌥⌘Space", "⌃⌘Space", "⌥⌘D"];
    const candidates = Object.values(ALTERNATIVES).flat();
    expect(candidates.filter((candidate) => system.includes(prettyAccelerator(candidate)))).toEqual([]);
  });
});
