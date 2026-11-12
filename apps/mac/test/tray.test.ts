import type { MenuBarState } from "@avanzel/ui/menu-bar";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodePng, faceIcon } from "../src/main/png.ts";
import { MenuBar } from "../src/main/tray.ts";
import { trayTooltip } from "../src/main/tray-state.ts";

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
    /** Every tooltip the icon was given, oldest first: a tooltip has no getter to read it back from. */
    readonly tips: string[] = [];
    title = "";
    menu: unknown = null;
    destroyed = false;
    constructor(public image: Image) {
      electron.trays.push(this);
    }
    setToolTip(tip: string): void {
      this.tips.push(tip);
    }
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
    /** What the icon's clicks were given to call: `on("click")`, `on("right-click")`. */
    readonly handlers = new Map<string, () => void>();
    on(event: string, handler: () => void): void {
      this.handlers.set(event, handler);
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
  }
  const electron = {
    trays: [] as FakeTray[],
    images: [] as Image[],
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
    expect(tray?.tips).toEqual(["Avanzel"]);
    expect(bar.tooltip).toBe("Avanzel");
  });

  it("gives the icon the words of each face when the face changes, and at no other time", () => {
    const bar = new MenuBar(() => {});
    const [tray] = electron.trays;
    bar.show({ face: "idle", title: "" }); // nothing new
    bar.show({ face: "listening", title: "0:00" });
    expect(bar.tooltip).toBe("Avanzel is recording");
    bar.show({ face: "listening", title: "0:01" }); // a tick of the count: the same state, the same words
    bar.show({ face: "filing", title: "" });
    bar.show({ face: "filed", title: "" });
    bar.show({ face: "needs-you", title: "37%" });
    bar.show({ face: "needs-you", title: "38%" });
    bar.show({ face: "asleep", title: "" });
    bar.show({ face: "idle", title: "" });
    expect(tray?.tips).toEqual([
      "Avanzel",
      "Avanzel is recording",
      "Avanzel is working",
      "Avanzel saved it",
      "Avanzel needs you",
      "The evening review is done",
      "Avanzel",
    ]);
    expect(bar.tooltip).toBe("Avanzel");
  });

  it("holds the words of the face it shows, for every face", () => {
    const bar = new MenuBar(() => {});
    const [tray] = electron.trays;
    for (const face of FACES) {
      bar.show({ face, title: "" });
      expect(bar.tooltip, face).toBe(trayTooltip(face));
      expect(tray?.tips.at(-1), face).toBe(trayTooltip(face));
    }
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
    const tips = [...tray!.tips];
    bar.show({ face: "filing", title: "" });
    bar.show({ face: "needs-you", title: "37%" });
    expect(tray?.told).toEqual(told);
    expect(tray?.tips).toEqual(tips);
    expect(bar.shown).toEqual({ face: "listening", title: "0:03" });
    expect(bar.tooltip).toBe("Avanzel is recording");
  });

  it("has no menu: a click on the icon, or a right click, brings up the panel", () => {
    let clicks = 0;
    const bar = new MenuBar(() => (clicks += 1));
    const [tray] = electron.trays;
    for (const face of ["listening", "filing", "filed", "idle"] as const) bar.show({ face, title: face === "filing" ? "0:02" : "" });
    expect(tray?.told).not.toContain("setContextMenu");
    tray?.handlers.get("click")?.();
    tray?.handlers.get("right-click")?.();
    expect(clicks).toBe(2);
  });
});
