import { inflateSync } from "node:zlib";
import type { MenuBarState } from "@avanzel/ui/menu-bar";
import { describe, expect, it } from "vitest";
import { encodePng, faceIcon, tinted, type Bitmap } from "../src/main/png.ts";

// Keyed by every MenuBarState, so a state the design system adds fails the typecheck here until its face is tested too.
const FACE_STATES: Record<MenuBarState, true> = { idle: true, listening: true, filing: true, filed: true, "needs-you": true, asleep: true };
const STATES = Object.keys(FACE_STATES) as MenuBarState[];

const alphas = (bitmap: Bitmap): number[] => Array.from(bitmap.rgba).filter((_, i) => i % 4 === 3);
/** The alpha of the pixel at column `x`, row `y`. */
const alphaAt = (bitmap: Bitmap, x: number, y: number): number => bitmap.rgba[(y * bitmap.width + x) * 4 + 3] ?? -1;

describe("png", () => {
  it("encodes RGBA pixels as a valid PNG", () => {
    const png = encodePng(2, 1, Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 128]));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBe(2); // IHDR width
    expect(png.readUInt32BE(20)).toBe(1); // IHDR height
    const idatLength = png.readUInt32BE(33);
    expect(png.toString("ascii", 37, 41)).toBe("IDAT");
    expect([...inflateSync(png.subarray(41, 41 + idatLength))]).toEqual([0, 255, 0, 0, 255, 0, 0, 255, 128]);
  });
});

describe("faceIcon", () => {
  it("each face state is its own 18 px template image", () => {
    const faces = STATES.map((state) => faceIcon(state, 1));
    for (const face of faces) {
      expect([face.width, face.height]).toEqual([18, 18]);
      expect(face.rgba.length).toBe(18 * 18 * 4);
      expect(Array.from(face.rgba).filter((_, i) => i % 4 !== 3).every((v) => v === 0)).toBe(true);
      expect(alphas(face).some((a) => a > 0)).toBe(true);
    }
    expect(new Set(faces.map((face) => alphas(face).join(","))).size).toBe(STATES.length);
  });

  it("the idle face is symmetric left to right", () => {
    // The idle art is symmetric about x = 9, so pixel x and pixel 17 - x are mirror images.
    const idle = faceIcon("idle", 1);
    for (let y = 0; y < 18; y++) {
      for (let x = 0; x < 9; x++) {
        expect(Math.abs(alphaAt(idle, x, y) - alphaAt(idle, 17 - x, y)), `pixels ${x},${y} and ${17 - x},${y}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("needs-you adds its dot top right", () => {
    // The dot is a circle of radius 2.3 at (15.6, 2.6), well clear of the head, which ends at about 6.4 from (9, 7).
    expect(alphaAt(faceIcon("needs-you", 1), 15, 2)).toBe(255);
    expect(alphaAt(faceIcon("idle", 1), 15, 2)).toBe(0);
  });

  it("filing adds its two dots at the bottom right, the second one half as strong", () => {
    // At 2x the dots are at (14.4, 16) and (16.4, 16) with radius .8; these pixels sit inside them and clear of the shelf, which ends at 14.2.
    const filing = faceIcon("filing", 2);
    const idle = faceIcon("idle", 2);
    expect(alphaAt(filing, 29, 32)).toBe(255);
    expect([127, 128]).toContain(alphaAt(filing, 32, 32));
    expect(alphaAt(idle, 29, 32)).toBe(0);
    expect(alphaAt(idle, 32, 32)).toBe(0);
  });

  it("2x is 36 px", () => {
    for (const state of STATES) {
      const face = faceIcon(state, 2);
      expect([face.width, face.height]).toEqual([36, 36]);
      expect(face.rgba.length).toBe(36 * 36 * 4);
    }
    // the same art, drawn finer: both scales cover about the same share of the face
    const share = (face: Bitmap) => alphas(face).reduce((sum, a) => sum + a, 0) / 255 / (face.width * face.height);
    expect(Math.abs(share(faceIcon("idle", 2)) - share(faceIcon("idle", 1)))).toBeLessThan(0.01);
  });
});

describe("tinted", () => {
  it("keeps the alpha and sets every pixel's colour, leaving the bitmap it was given alone", () => {
    const face = faceIcon("idle", 1);
    const before = Array.from(face.rgba);
    const blue = tinted(face, "#007aff");
    expect([blue.width, blue.height]).toEqual([face.width, face.height]);
    expect(alphas(blue)).toEqual(alphas(face));
    for (let i = 0; i < blue.rgba.length; i += 4) expect(Array.from(blue.rgba.subarray(i, i + 3))).toEqual([0, 122, 255]);
    expect(Array.from(face.rgba)).toEqual(before);
  });

  it("takes upper case, and refuses what is not #rrggbb", () => {
    expect(Array.from(tinted(faceIcon("idle", 1), "#AF52DE").rgba.subarray(0, 3))).toEqual([175, 82, 222]);
    for (const bad of ["", "007aff", "#07f", "#007aff00", "#00zzff", "blue"]) {
      expect(() => tinted(faceIcon("idle", 1), bad), bad).toThrow(/#rrggbb/);
    }
  });
});
