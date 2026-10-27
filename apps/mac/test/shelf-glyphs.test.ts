import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SHELF_NAMES as UI_SHELF_NAMES, SHELVES as UI_SHELVES, ShelfGlyph } from "@avanzel/ui";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Bitmap } from "../src/main/png.ts";
import { SHELF_COLORS, SHELF_GLYPH_SVG, SHELF_NAMES, SHELVES, shelfGlyphIcon } from "../src/main/shelf-glyphs.ts";

// Main can't import the design system's shelves, names, colours or glyphs (the package root pulls in CSS and fonts, and the
// glyphs are private JSX), so shelf-glyphs.ts keeps copies. A test may import the root, so these hold each copy to the real thing: the
// glyphs to what the design system's ShelfGlyph renders, the shelves and names to its exports, and the colours to its tokens.css.

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

/** The root's attributes that are about the page and not the art: its CSS class, aria-hidden, xmlns and display size. */
const NOT_THE_ART = ["class", "aria-hidden", "xmlns", "width", "height"];

/**
 * The drawing in `markup` as one line per element: its depth, its name and its attributes in name order, with currentColor read as
 * black (the copy is drawn in black and tinted afterwards). The root leaves out NOT_THE_ART; every other attribute counts, so one the
 * design system adds, on the root or anywhere else, shows. Markup that is more than tags throws.
 */
function outline(markup: string): string[] {
  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  if (markup.replace(tag, "").trim() !== "") throw new Error(`more than tags in ${markup}`);
  const lines: string[] = [];
  let depth = 0;
  for (const [, closing, name = "", attributes = "", selfClosing] of markup.matchAll(tag)) {
    if (closing) {
      depth--;
      continue;
    }
    const pairs = [...attributes.matchAll(/([\w:-]+)="([^"]*)"/g)]
      .map(([, key = "", value = ""]) => ({ key, value: value === "currentColor" ? "black" : value }))
      .filter(({ key }) => depth > 0 || !NOT_THE_ART.includes(key))
      .map(({ key, value }) => `${key}=${value}`)
      .sort();
    lines.push(`${"  ".repeat(depth)}${name} ${pairs.join(" ")}`);
    if (!selfClosing) depth++;
  }
  return lines;
}

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
  it("the glyphs match what the design system's ShelfGlyph draws", () => {
    // The real component renders each shelf, and the copy must be the same elements, nested the same way, with the same attributes
    // (so a swapped fill and stroke, an added opacity, transform, rect or line, a butt cap or another viewBox all show) and nothing
    // here depends on the order the design system lists its shelves in.
    for (const shelf of UI_SHELVES) {
      expect(SHELF_GLYPH_SVG[shelf], `${shelf} has a copy`).toBeTypeOf("string");
      const drawn = outline(renderToStaticMarkup(createElement(ShelfGlyph, { shelf })));
      expect(drawn.length, `${shelf} as the design system draws it`).toBeGreaterThan(1);
      expect(outline(SHELF_GLYPH_SVG[shelf]), shelf).toEqual(drawn);
    }
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
