import { describe, expect, it, vi } from "vitest";
import { registerShortcuts } from "../src/main/shortcuts.ts";
import { DEFAULT_SETTINGS } from "../src/main/store.ts";

describe("global shortcuts", () => {
  it("registers each action and reports the ones another app already holds", () => {
    const registered: string[] = [];
    const api = {
      register: vi.fn((accelerator: string) => {
        if (accelerator === "Alt+Space") return false;
        registered.push(accelerator);
        return true;
      }),
      unregisterAll: vi.fn(),
    };
    const handlers = { dictate: vi.fn(), capture: vi.fn(), type: vi.fn(), ask: vi.fn() };
    const problems = registerShortcuts(DEFAULT_SETTINGS.shortcuts, handlers, api);
    expect(api.unregisterAll).toHaveBeenCalledOnce();
    expect(registered).toEqual(["Alt+Shift+S", "Alt+Shift+Space", "Alt+Shift+A"]);
    expect(problems).toEqual({ dictate: "⌥Space is already used by another app. Pick another shortcut." });
  });

  it("reports shortcuts Electron cannot parse", () => {
    const api = {
      register: vi.fn((accelerator: string) => {
        if (accelerator === "Hyper+Q") throw new Error("bad accelerator");
        return true;
      }),
      unregisterAll: vi.fn(),
    };
    const handlers = { dictate: vi.fn(), capture: vi.fn(), type: vi.fn(), ask: vi.fn() };
    const problems = registerShortcuts({ ...DEFAULT_SETTINGS.shortcuts, ask: "Hyper+Q" }, handlers, api);
    expect(problems).toEqual({ ask: "“Hyper+Q” is not a shortcut macOS understands." });
  });
});
