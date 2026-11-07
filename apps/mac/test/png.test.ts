import { inflateSync } from "node:zlib";
import type { MenuBarState } from "@avanzel/ui/menu-bar";
import { describe, expect, it } from "vitest";
import { encodePng, faceIcon, withBadge, type Bitmap } from "../src/main/png.ts";

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

describe("withBadge", () => {
  it("leaves the face as it is with nothing to count", () => {
    const face = faceIcon("filing", 2);
    expect(withBadge(face, 0, 2)).toBe(face);
  });

  it("puts a disc at the face's top right with the count cut out of it, and a clear ring between them", () => {
    const badged = withBadge(faceIcon("filing", 2), 3, 2);
    // At 2x the disc is centred at (28, 8), 8 px across; its left edge is solid, its middle has the figure cut out.
    expect(alphaAt(badged, 22, 8)).toBe(255);
    expect(alphaAt(badged, 28, 8)).toBeLessThan(255);
    // The ring around it is cleared, where the face's own circle passes.
    expect(alphaAt(badged, 19, 13)).toBeLessThan(alphaAt(faceIcon("filing", 2), 19, 13) || 1);
  });

  it("draws each count apart, and ten and more as one", () => {
    const pictures = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => alphas(withBadge(faceIcon("idle", 1), n, 1)).join(","));
    expect(new Set(pictures).size).toBe(10);
    expect(alphas(withBadge(faceIcon("idle", 1), 25, 1))).toEqual(alphas(withBadge(faceIcon("idle", 1), 10, 1)));
  });
});
