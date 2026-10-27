import type { MenuBarState } from "@avanzel/ui/menu-bar";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FiledPage } from "../src/shared/ipc.ts";
import type { MenuInput } from "../src/main/menu-model.ts";
import { encodePng, faceIcon } from "../src/main/png.ts";
import { SHELVES, shelfGlyphIcon } from "../src/main/shelf-glyphs.ts";
import { DEFAULT_SETTINGS } from "../src/main/store.ts";
import { MenuBar } from "../src/main/tray.ts";

// Electron isn't there to run: a stand-in Tray and nativeImage note what the menu bar is told, and nothing else.
const electron = vi.hoisted(() => {
  interface Representation {
    scaleFactor: number;
    buffer: Buffer;
  }
  interface Image {
    representations: Representation[];
    template: boolean;
    addRepresentation(representation: Representation): void;
    setTemplateImage(template: boolean): void;
  }
  class FakeTray {
    readonly told: string[] = [];
    title = "";
    menu: unknown = null;
    destroyed = false;
    constructor(public image: Image) {
      electron.trays.push(this);
    }
    setToolTip(): void {}
    setImage(image: Image): void {
      this.told.push("setImage");
      this.image = image;
    }
    setTitle(title: string, options?: unknown): void {
      this.told.push(`setTitle ${JSON.stringify([title, options])}`);
      this.title = title;
    }
    getTitle(): string {
      return this.title;
    }
    setContextMenu(menu: unknown): void {
      this.told.push("setContextMenu");
      this.menu = menu;
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
  }
  const electron = {
    trays: [] as FakeTray[],
    images: [] as Image[],
    /** The templates the menus were built from, newest last. */
    menus: [] as { template: Record<string, unknown>[] }[],
    /** The appearance: `nativeTheme.shouldUseDarkColors`. */
    theme: { shouldUseDarkColors: false },
    FakeTray,
    createEmpty(): Image {
      const image: Image = {
        representations: [],
        template: false,
        addRepresentation: (representation) => image.representations.push(representation),
        setTemplateImage: (template) => (image.template = template),
      };
      electron.images.push(image);
      return image;
    },
  };
  return electron;
});

vi.mock("electron", () => ({
  Tray: electron.FakeTray,
  Menu: {
    buildFromTemplate: (template: Record<string, unknown>[]) => {
      const menu = { template };
      electron.menus.push(menu);
      return menu;
    },
  },
  nativeImage: { createEmpty: () => electron.createEmpty() },
  nativeTheme: electron.theme,
}));

const FACES: MenuBarState[] = ["idle", "listening", "filing", "filed", "needs-you", "asleep"];
const MONOSPACED = { fontType: "monospacedDigit" };
const titleSet = (title: string) => `setTitle ${JSON.stringify([title, MONOSPACED])}`;

/** The pixel size a PNG says it is: the width and height in its IHDR chunk. */
const sizeOf = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

beforeEach(() => {
  electron.trays.length = 0;
  electron.images.length = 0;
  electron.menus.length = 0;
  electron.theme.shouldUseDarkColors = false;
});

describe("MenuBar", () => {
  it("starts on the idle face, as a template image at 18 points, and shows no title", () => {
    const bar = new MenuBar(() => {});
    const [tray] = electron.trays;
    expect(electron.trays).toHaveLength(1);
    expect(bar.shown).toEqual({ face: "idle", title: "" });
    expect(tray?.image.template).toBe(true);
    expect(tray?.image.representations.map((one) => one.scaleFactor)).toEqual([1, 2]);
    expect(tray?.image.representations.map((one) => sizeOf(one.buffer))).toEqual([[18, 18], [36, 36]]);
    expect(tray?.told).toEqual([]);
  });

  it("sets the image only when the face changes, and the title only when the title does", () => {
    const bar = new MenuBar(() => {});
    const [tray] = electron.trays;
    bar.show({ face: "idle", title: "" });
    expect(tray?.told).toEqual([]);
    bar.show({ face: "listening", title: "0:00" });
    expect(tray?.told).toEqual(["setImage", titleSet("0:00")]);
    bar.show({ face: "listening", title: "0:01" }); // a tick: the title alone
    bar.show({ face: "listening", title: "0:01" }); // nothing new
    expect(tray?.told).toEqual(["setImage", titleSet("0:00"), titleSet("0:01")]);
    bar.show({ face: "filing", title: "0:01" }); // a swap: the image alone
    expect(tray?.told).toEqual(["setImage", titleSet("0:00"), titleSet("0:01"), "setImage"]);
    bar.show({ face: "filed", title: "" });
    expect(tray?.told.slice(4)).toEqual(["setImage", titleSet("")]);
    expect(bar.shown).toEqual({ face: "filed", title: "" });
    expect(tray?.title).toBe("");
  });

  it("makes one image for each face, the first time it shows, and shows that one again", () => {
    const bar = new MenuBar(() => {});
    const [tray] = electron.trays;
    expect(electron.images).toHaveLength(1); // the idle face the icon starts on
    const idle = tray?.image;
    bar.show({ face: "listening", title: "" });
    const listening = tray?.image;
    bar.show({ face: "idle", title: "" });
    expect(tray?.image).toBe(idle);
    bar.show({ face: "listening", title: "" });
    expect(tray?.image).toBe(listening);
    expect(listening).not.toBe(idle);
    expect(electron.images).toHaveLength(2);
    for (const face of ["filing", "filed", "needs-you", "asleep"] as const) bar.show({ face, title: "" });
    expect(electron.images).toHaveLength(6);
    expect(new Set(electron.images).size).toBe(6);
  });

  it("draws each face from its own art, at 1x and 2x", () => {
    const bar = new MenuBar(() => {});
    const [tray] = electron.trays;
    for (const face of FACES) {
      bar.show({ face, title: "" });
      expect(tray?.image.template, face).toBe(true);
      expect(tray?.image.representations.map((one) => one.scaleFactor), face).toEqual([1, 2]);
      for (const { scaleFactor, buffer } of tray?.image.representations ?? []) {
        const art = faceIcon(face, scaleFactor as 1 | 2);
        expect(buffer.equals(encodePng(art.width, art.height, art.rgba)), `${face} at ${scaleFactor}x`).toBe(true);
      }
    }
  });

  it("does nothing once the tray is destroyed", () => {
    const bar = new MenuBar(() => {});
    const [tray] = electron.trays;
    bar.show({ face: "listening", title: "0:03" });
    tray!.destroyed = true;
    const told = [...tray!.told];
    bar.show({ face: "filing", title: "" });
    bar.show({ face: "needs-you", title: "37%" });
    expect(tray?.told).toEqual(told);
    expect(bar.shown).toEqual({ face: "listening", title: "0:03" });
  });

  it("never rebuilds the menu", () => {
    const bar = new MenuBar(() => {});
    const [tray] = electron.trays;
    for (const face of ["listening", "filing", "filed", "idle"] as const) bar.show({ face, title: face === "filing" ? "0:02" : "" });
    expect(tray?.told).not.toContain("setContextMenu");
  });
});

describe("MenuBar's menu", () => {
  const page = (shelf: string): FiledPage => ({ title: `A page in ${shelf}`, shelf, path: `${shelf}/a.md` });
  const menuInput = (recent: FiledPage[]): MenuInput => ({
    libraryReady: true,
    inbox: 2,
    recent,
    tasks: [],
    filedToday: 3,
    speechProblem: null,
    recording: false,
    shortcuts: DEFAULT_SETTINGS.shortcuts,
    unregisteredShortcuts: [],
    undoableReview: false,
    undoableFiling: false,
  });
  type Item = { label?: string; sublabel?: string; icon?: { template: boolean; representations: { scaleFactor: number; buffer: Buffer }[] } };
  /** The items of the menu built last. */
  const itemsOf = (): Item[] => (electron.menus.at(-1)?.template ?? []) as Item[];
  /** The item whose label is the page's title. */
  const itemFor = (shelf: string) => itemsOf().find((item) => item.label === page(shelf).title);
  /** The image the menu was given for the page on `shelf`, as the 1x and 2x PNGs the glyph is, or null. */
  const pngsOf = (shelf: string) => itemFor(shelf)?.icon?.representations.map((one) => [one.scaleFactor, one.buffer] as const) ?? null;
  const glyphPng = (shelf: string, dark: boolean, scale: 1 | 2) => {
    const art = shelfGlyphIcon(shelf, dark, scale)!;
    return encodePng(art.width, art.height, art.rgba);
  };

  /** Builds the menu for each shelf in turn, three pages at a time (a menu shows three), and calls `check` with the shelf while its menu is the last one. */
  function eachShelf(bar: MenuBar, check: (shelf: string) => void): void {
    for (let from = 0; from < SHELVES.length; from += 3) {
      const shelves = SHELVES.slice(from, from + 3);
      bar.update(menuInput(shelves.map(page)));
      for (const shelf of shelves) check(shelf);
    }
  }

  it("gives each page the glyph of its shelf, in the shelf's colour, as an image that keeps its colours", () => {
    const bar = new MenuBar(() => {});
    const seen: string[] = [];
    eachShelf(bar, (shelf) => {
      const icon = itemFor(shelf)?.icon;
      expect(icon, shelf).toBeDefined();
      expect(icon?.template, `${shelf} is no template image: macOS would take its colour away`).toBe(false);
      expect(icon?.representations.map((one) => one.scaleFactor), shelf).toEqual([1, 2]);
      for (const { scaleFactor, buffer } of icon?.representations ?? []) {
        expect(buffer.equals(glyphPng(shelf, false, scaleFactor as 1 | 2)), `${shelf} at ${scaleFactor}x`).toBe(true);
      }
      expect(icon?.representations.map((one) => sizeOf(one.buffer)), shelf).toEqual([[12, 12], [24, 24]]);
      seen.push(icon?.representations[1]?.buffer.toString("base64") ?? "");
    });
    // Six glyphs in six colours: no two alike.
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  it("draws the glyphs for a dark menu while the appearance is dark, and for a light one when it is light again", () => {
    const bar = new MenuBar(() => {});
    electron.theme.shouldUseDarkColors = true;
    eachShelf(bar, (shelf) => {
      for (const [scale, buffer] of pngsOf(shelf) ?? []) expect(buffer.equals(glyphPng(shelf, true, scale as 1 | 2)), `${shelf} dark at ${scale}x`).toBe(true);
      expect(pngsOf(shelf)?.[1]?.[1]?.equals(glyphPng(shelf, false, 2)), `${shelf} isn't the light glyph`).toBe(false);
    });
    electron.theme.shouldUseDarkColors = false;
    eachShelf(bar, (shelf) => expect(pngsOf(shelf)?.[1]?.[1]?.equals(glyphPng(shelf, false, 2)), `${shelf} light again`).toBe(true));
  });

  it("makes each glyph once for its shelf and appearance, and gives the same image to every menu after", () => {
    const bar = new MenuBar(() => {});
    const faces = electron.images.length; // the idle face the icon starts on
    bar.update(menuInput([page("goals"), page("ideas")]));
    const made = electron.images.length - faces;
    expect(made).toBe(2);
    const goals = itemFor("goals")?.icon;
    bar.update(menuInput([page("goals"), page("ideas"), page("people")]));
    expect(itemFor("goals")?.icon).toBe(goals); // not a new image
    expect(electron.images.length - faces).toBe(3); // only people's is new
    // The other appearance has its own images, and the first are kept for when it comes back.
    electron.theme.shouldUseDarkColors = true;
    bar.update(menuInput([page("goals")]));
    const dark = itemFor("goals")?.icon;
    expect(dark).not.toBe(goals);
    expect(electron.images.length - faces).toBe(4);
    electron.theme.shouldUseDarkColors = false;
    bar.update(menuInput([page("goals")]));
    expect(itemFor("goals")?.icon).toBe(goals);
    expect(electron.images.length - faces).toBe(4);
  });

  it("gives a page off the shelves no icon, and makes none for it", () => {
    const bar = new MenuBar(() => {});
    const faces = electron.images.length;
    bar.update(menuInput([page("projects"), page("constructor"), page("")]));
    for (const shelf of ["projects", "constructor", ""]) expect(itemFor(shelf)?.icon, shelf || "no folder").toBeUndefined();
    expect(electron.images.length).toBe(faces);
  });

  it("gives no other item an icon", () => {
    const bar = new MenuBar(() => {});
    bar.update(menuInput([page("goals")]));
    const withIcons = itemsOf().filter((item) => item.icon).map((item) => item.label);
    expect(withIcons).toEqual([page("goals").title]);
  });

  it("offers Undo the last filing as a plain, enabled item whose click asks for its action, and only while the model offers it", () => {
    const asked: string[] = [];
    const bar = new MenuBar((action) => asked.push(action));
    bar.update({ ...menuInput([page("goals")]), undoableFiling: true });
    const undo = itemsOf().find((item) => item.label === "Undo the last filing") as (Item & { enabled?: boolean; click?: () => void }) | undefined;
    expect(undo).toMatchObject({ label: "Undo the last filing", enabled: true });
    expect(undo?.icon).toBeUndefined();
    undo?.click?.();
    expect(asked).toEqual(["undo-filing"]);
    bar.update(menuInput([page("goals")]));
    expect(itemsOf().some((item) => item.label === "Undo the last filing")).toBe(false);
  });

  it("passes each item's sublabel on, and sets the menu on the tray once for each update", () => {
    const bar = new MenuBar(() => {});
    const [tray] = electron.trays;
    bar.update({ ...menuInput([page("goals")]), inbox: 1 });
    expect(itemsOf()[0]).toMatchObject({ label: "3 thoughts filed today.", sublabel: "1 note in the inbox" });
    expect(itemFor("goals")).toMatchObject({ sublabel: "Goals" });
    expect(tray?.told.filter((told) => told === "setContextMenu")).toHaveLength(1);
    expect(tray?.menu).toBe(electron.menus.at(-1));
  });

  it("holds the menu it built last, for the tests that read it", () => {
    const bar = new MenuBar(() => {});
    expect(bar.menu).toBeNull();
    bar.update(menuInput([page("goals")]));
    expect(bar.menu).toBe(electron.menus.at(-1));
    bar.update(menuInput([]));
    expect(bar.menu).toBe(electron.menus.at(-1));
  });
});
