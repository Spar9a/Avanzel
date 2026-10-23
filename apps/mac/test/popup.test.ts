import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickRequest, popupChoice } from "../src/main/popup.ts";

/** What Menu.buildFromTemplate is given for one item, and what menu.popup is given. */
interface Item { label: string; type: string; checked: boolean; click(): void }
interface Popup { window: unknown; x?: number; y?: number; callback(): void }

// A stand-in for Electron's Menu, so the test never loads Electron itself: every menu built, and what the person does
// when one pops up.
const menus = vi.hoisted(() => ({
  built: [] as { items: Item[]; popup: Popup | null }[],
  /** The label of the item the person picks at the next menu, or null: they close it without a pick. */
  pick: null as string | null,
}));

vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: (items: Item[]) => {
      const menu = { items, popup: null as Popup | null };
      menus.built.push(menu);
      return {
        popup: (options: Popup) => {
          menu.popup = options;
          // As on macOS: a picked item's click runs first, and the menu's close callback follows it.
          items.find((item) => item.label === menus.pick)?.click();
          options.callback();
        },
      };
    },
  },
}));

describe("a native menu's request", () => {
  it("pickRequest keeps the well-formed options, at most fifty, and rounds the point", () => {
    const mixed = [
      { label: 1, value: "a" },
      { label: "A" },
      "x",
      null,
      { label: "", value: "b" },
      { label: "System default", value: "", checked: true },
      { label: "Studio mic", value: "mic-1", checked: "yes" },
    ];
    // A label that isn't words or a value that isn't text leaves an option out; an empty value is fine (System
    // default's), and only `true` checks an item.
    expect(pickRequest(mixed, null)).toEqual({
      options: [
        { label: "System default", value: "", checked: true },
        { label: "Studio mic", value: "mic-1", checked: false },
      ],
      at: null,
    });

    const sixty = Array.from({ length: 60 }, (_, i) => ({ label: `Item ${i}`, value: String(i), checked: false }));
    const kept = pickRequest(sixty, null)!.options;
    expect(kept).toHaveLength(50);
    expect(kept[0]).toEqual({ label: "Item 0", value: "0", checked: false });
    expect(kept[49]).toEqual({ label: "Item 49", value: "49", checked: false });

    const good = [{ label: "A", value: "a", checked: false }];
    expect(pickRequest(good, { x: 10.4, y: 20.6 })).toEqual({ options: good, at: { x: 10, y: 21 } });
    // Never above the window's left or top edge.
    expect(pickRequest(good, { x: -5, y: -0.4 })!.at).toEqual({ x: 0, y: 0 });
  });

  it("pickRequest refuses a request without an option in words", () => {
    expect(pickRequest(null, null)).toBeNull();
    expect(pickRequest({}, null)).toBeNull();
    expect(pickRequest([{ label: 2 }], null)).toBeNull();
    expect(pickRequest([], { x: 1, y: 2 })).toBeNull();
  });

  it("a point that isn't one leaves the menu at the pointer", () => {
    const options = [{ label: "A", value: "a", checked: false }];
    for (const at of ["x", null, undefined, {}, { x: 1 }, { x: "1", y: "2" }, { x: NaN, y: 1 }, { x: 1, y: Infinity }]) {
      expect(pickRequest(options, at)).toEqual({ options, at: null });
    }
  });
});

describe("popupChoice", () => {
  const win = { id: 7 } as unknown as BrowserWindow;
  const options = [
    { label: "System default", value: "", checked: false },
    { label: "Studio mic", value: "mic-1", checked: true },
  ];

  beforeEach(() => {
    menus.built.length = 0;
    menus.pick = null;
  });

  it("resolves with the value of the item picked, though the close callback follows its click", async () => {
    menus.pick = "Studio mic";
    await expect(popupChoice(win, options, { x: 10, y: 20 })).resolves.toBe("mic-1");
    // An empty value is a value: System default is not "no pick".
    menus.pick = "System default";
    await expect(popupChoice(win, options, null)).resolves.toBe("");
  });

  it("resolves null when the menu closes without a pick", async () => {
    await expect(popupChoice(win, options, null)).resolves.toBeNull();
    menus.pick = "Not in the menu";
    await expect(popupChoice(win, options, null)).resolves.toBeNull();
  });

  it("shows each option as a checkbox item over the window, at the point when there is one", async () => {
    await popupChoice(win, options, { x: 10, y: 20 });
    await popupChoice(win, options, null);
    const [placed, pointer] = menus.built;
    expect(placed!.items.map(({ label, type, checked }) => ({ label, type, checked }))).toEqual([
      { label: "System default", type: "checkbox", checked: false },
      { label: "Studio mic", type: "checkbox", checked: true },
    ]);
    expect(placed!.popup).toMatchObject({ window: win, x: 10, y: 20 });
    // Without a point the menu is left to open at the pointer: Electron does that when x and y are missing.
    expect(pointer!.popup).toMatchObject({ window: win });
    expect(pointer!.popup).not.toHaveProperty("x");
    expect(pointer!.popup).not.toHaveProperty("y");
  });
});
