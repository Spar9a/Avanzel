import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SHELF_NAMES as UI_SHELF_NAMES, SHELVES as UI_SHELVES } from "@avanzel/ui";
import { describe, expect, it } from "vitest";
import type { Bitmap } from "../src/main/png.ts";
import { SHELF_COLORS, SHELF_GLYPH_SVG, SHELF_NAMES, SHELVES, shelfGlyphIcon } from "../src/main/shelf-glyphs.ts";

// Main can't import the design system's shelves, names, colours or glyphs (the package root pulls in CSS and fonts, and the
// glyphs are private JSX), so shelf-glyphs.ts keeps copies. These tests keep every copy equal to the design system.

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

function glyph(shelf: string, dark: boolean, scale: 1 | 2): Bitmap {
  const bitmap = shelfGlyphIcon(shelf, dark, scale);
  if (!bitmap) throw new Error(`no glyph for ${shelf}`);
  return bitmap;
}

/** The colour (#rrggbb) of every pixel that has any alpha. */
function paintedColours({ rgba }: Bitmap): string[] {
  const colours: string[] = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if ((rgba[i + 3] ?? 0) > 0) colours.push(`#${[0, 1, 2].map((k) => (rgba[i + k] ?? 0).toString(16).padStart(2, "0")).join("")}`);
  }
  return colours;
}

describe("shelf glyphs", () => {
  it("the glyphs match Shelf.tsx", () => {
    // Every d, cx, cy, r and strokeWidth in a shelf's JSX appears, in order, in the same shelf's SVG, and the SVG adds none.
    const source = read("../../../packages/ui/src/components/Shelf.tsx");
    const start = source.indexOf("const GLYPHS");
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("\n};", start));
    const at = SHELVES.map((shelf) => block.indexOf(`\n  ${shelf}: `));
    expect(at.every((index) => index > -1)).toBe(true);
    SHELVES.forEach((shelf, n) => {
      const jsx = block.slice(at[n], at[n + 1] ?? block.length);
      const expected = [...jsx.matchAll(/(?<![\w-])(d|cx|cy|r)="([^"]*)"|strokeWidth=\{([\d.]+)\}/g)].map((m) =>
        m[1] ? `${m[1]}=${m[2]}` : `stroke-width=${m[3]}`,
      );
      const actual = [...SHELF_GLYPH_SVG[shelf].matchAll(/(?<![\w-])(d|cx|cy|r|stroke-width)="([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`);
      expect(expected.length, `${shelf} in Shelf.tsx`).toBeGreaterThan(0);
      expect(actual, shelf).toEqual(expected);
    });
  });

  it("the shelves, names and colours match the design system", () => {
    expect([...SHELVES]).toEqual([...UI_SHELVES]);
    expect(SHELF_NAMES).toEqual(UI_SHELF_NAMES);

    const css = read("../../../packages/ui/src/generated/tokens.css");
    const colours = (from: string, to: string): Record<string, string> => {
      const start = css.indexOf(from);
      expect(start, from).toBeGreaterThan(-1);
      const found: Record<string, string> = {};
      for (const [, shelf, hex] of css.slice(start, css.indexOf(to, start)).matchAll(/--av-shelf-(\w+): (#[0-9a-f]{6});/g)) {
        if (shelf && hex) found[shelf] = hex;
      }
      expect(Object.keys(found), from).toHaveLength(SHELVES.length);
      return found;
    };
    const light = colours(':root, [data-appearance="light"] {', '[data-appearance="dark"] {');
    const dark = colours('[data-appearance="dark"] {', "@media (prefers-color-scheme: dark)");
    const darkFollowingTheSystem = colours("@media (prefers-color-scheme: dark)", "@media (prefers-contrast: more)");
    expect(SHELF_COLORS.light).toEqual(light);
    expect(SHELF_COLORS.dark).toEqual(dark);
    expect(darkFollowingTheSystem).toEqual(dark);
  });

  it("a shelf glyph is tinted with its colour", () => {
    for (const [dark, hex] of [[false, "#ffcc00"], [true, "#ffd60a"]] as const) {
      const colours = paintedColours(glyph("ideas", dark, 1));
      expect(colours.length).toBeGreaterThan(20);
      expect(new Set(colours)).toEqual(new Set([hex]));
    }
  });

  it("every shelf has its own glyph, 12 points square, in its colour in light and in dark", () => {
    const drawings = new Set<string>();
    for (const shelf of SHELVES) {
      for (const dark of [false, true]) {
        for (const scale of [1, 2] as const) {
          const bitmap = glyph(shelf, dark, scale);
          expect([bitmap.width, bitmap.height], `${shelf} at ${scale}x`).toEqual([12 * scale, 12 * scale]);
          const colours = paintedColours(bitmap);
          expect(colours.length, `${shelf} at ${scale}x paints something`).toBeGreaterThan(10 * scale * scale);
          expect(new Set(colours), shelf).toEqual(new Set([SHELF_COLORS[dark ? "dark" : "light"][shelf]]));
        }
      }
      drawings.add(Array.from(glyph(shelf, false, 1).rgba).join(","));
    }
    expect(drawings.size).toBe(SHELVES.length);
  });

  it("a folder off the shelves has no glyph", () => {
    expect(shelfGlyphIcon("projects", false, 1)).toBeNull();
    for (const folder of ["", "Ideas", "inbox", "constructor", "__proto__"]) expect(shelfGlyphIcon(folder, true, 2), folder).toBeNull();
  });
});
