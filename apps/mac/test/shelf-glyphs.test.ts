import { SHELF_NAMES as UI_SHELF_NAMES, SHELVES as UI_SHELVES, ShelfGlyph } from "@avanzel/ui";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Bitmap } from "../src/main/png.ts";
import { rasterizeSvg } from "../src/main/raster.ts";
import { OWN_SHELF_GLYPH_SVG, SHELF_GLYPH_SVG, SHELF_NAMES, SHELVES, shelfGlyphIcon } from "../src/main/shelf-glyphs.ts";

// Main can't import the design system's shelves, names or glyphs (the package root pulls in CSS and fonts, and the glyphs are private
// JSX), so shelf-glyphs.ts keeps copies. A test may import the root, so these hold each copy to the real thing: the glyphs to what the
// design system's ShelfGlyph renders, and the shelves and names to its exports. The menu draws the glyphs in black, as template images:
// macOS gives them the menu's ink, so main holds no colours.

/** The root's attributes that are about the page and not the art: its CSS class, aria-hidden, xmlns and display size. */
const NOT_THE_ART = ["class", "aria-hidden", "xmlns", "width", "height"];

/**
 * The drawing in `markup` as one line per element: its depth, its name and its attributes in name order, with currentColor read as
 * black (the copy is drawn in black, and macOS tints it as a template image). The root leaves out NOT_THE_ART; every other attribute counts, so one the
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

function glyph(shelf: string, scale: 1 | 2): Bitmap {
  const bitmap = shelfGlyphIcon(shelf, scale);
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

  it("the shelves and names match the design system", () => {
    expect([...SHELVES]).toEqual([...UI_SHELVES]);
    expect(SHELF_NAMES).toEqual(UI_SHELF_NAMES);
  });

  it("a shelf glyph is black on transparent, for macOS to tint: no colour of its own", () => {
    for (const scale of [1, 2] as const) {
      const colours = paintedColours(glyph("ideas", scale));
      expect(colours.length).toBeGreaterThan(20);
      expect(new Set(colours)).toEqual(new Set(["#000000"]));
    }
  });

  it("every shelf has its own glyph, 12 points square, in black at 1x and 2x", () => {
    const drawings = new Set<string>();
    for (const shelf of SHELVES) {
      for (const scale of [1, 2] as const) {
        const bitmap = glyph(shelf, scale);
        expect([bitmap.width, bitmap.height], `${shelf} at ${scale}x`).toEqual([12 * scale, 12 * scale]);
        const colours = paintedColours(bitmap);
        expect(colours.length, `${shelf} at ${scale}x paints something`).toBeGreaterThan(10 * scale * scale);
        expect(new Set(colours), shelf).toEqual(new Set(["#000000"]));
      }
      drawings.add(Array.from(glyph(shelf, 1).rgba).join(","));
    }
    expect(drawings.size).toBe(SHELVES.length);
  });

  it("the own-shelf glyph matches what the design system's ShelfGlyph draws for a shelf the owner made", () => {
    // Every shelf the owner makes shares one glyph, whatever its folder and name, so any own shelf renders the same drawing.
    for (const shelf of [{ own: "projects", name: "Projects" }, { own: "recipes", name: "Рецепты" }]) {
      const drawn = outline(renderToStaticMarkup(createElement(ShelfGlyph, { shelf })));
      expect(drawn.length, `${shelf.own} as the design system draws it`).toBeGreaterThan(1);
      expect(outline(OWN_SHELF_GLYPH_SVG), shelf.own).toEqual(drawn);
    }
  });

  it("the own-shelf glyph is its own, 12 points square, in black at 1x and 2x", () => {
    const six = new Set(SHELVES.map((shelf) => Array.from(glyph(shelf, 1).rgba).join(",")));
    for (const scale of [1, 2] as const) {
      const bitmap = rasterizeSvg(OWN_SHELF_GLYPH_SVG, scale);
      expect([bitmap.width, bitmap.height], `at ${scale}x`).toEqual([12 * scale, 12 * scale]);
      const colours = paintedColours(bitmap);
      expect(colours.length, `at ${scale}x it paints something`).toBeGreaterThan(10 * scale * scale);
      expect(new Set(colours)).toEqual(new Set(["#000000"]));
    }
    expect(six.has(Array.from(rasterizeSvg(OWN_SHELF_GLYPH_SVG, 1).rgba).join(","))).toBe(false);
  });

  it("a folder off the shelves has no glyph", () => {
    expect(shelfGlyphIcon("projects", 1)).toBeNull();
    for (const folder of ["", "Ideas", "inbox", "constructor", "__proto__"]) expect(shelfGlyphIcon(folder, 2), folder).toBeNull();
  });
});
