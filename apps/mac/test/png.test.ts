import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePng, trayIcon } from "../src/main/png.ts";

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

  it("draws the tray glyph as black-on-transparent at 1x and 2x", () => {
    for (const scale of [1, 2] as const) {
      const { width, height, rgba } = trayIcon(scale);
      expect([width, height]).toEqual([16 * scale, 16 * scale]);
      const alphas = [...rgba].filter((_, i) => i % 4 === 3);
      expect(alphas.some((a) => a === 255)).toBe(true);
      expect(alphas.some((a) => a === 0)).toBe(true);
      expect([...rgba].filter((_, i) => i % 4 !== 3).every((v) => v === 0)).toBe(true);
    }
  });
});
