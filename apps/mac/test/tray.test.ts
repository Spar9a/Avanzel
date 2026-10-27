import type { MenuBarState } from "@avanzel/ui/menu-bar";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodePng, faceIcon } from "../src/main/png.ts";
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
    setContextMenu(): void {
      this.told.push("setContextMenu");
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
  }
  const electron = {
    trays: [] as FakeTray[],
    images: [] as Image[],
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
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: { createEmpty: () => electron.createEmpty() },
}));

const FACES: MenuBarState[] = ["idle", "listening", "filing", "filed", "needs-you", "asleep"];
const MONOSPACED = { fontType: "monospacedDigit" };
const titleSet = (title: string) => `setTitle ${JSON.stringify([title, MONOSPACED])}`;

/** The pixel size a PNG says it is: the width and height in its IHDR chunk. */
const sizeOf = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

beforeEach(() => {
  electron.trays.length = 0;
  electron.images.length = 0;
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
