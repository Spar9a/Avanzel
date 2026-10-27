// The six shelves as the menu shows them: their names, their colours and their glyphs. The design system draws the glyphs in React
// (packages/ui/src/components/Shelf.tsx), and its package root pulls in CSS and fonts that main's build can't load, so main keeps
// copies here. test/shelf-glyphs.test.ts renders the design system's own ShelfGlyph for each shelf and checks that its elements and
// attributes (currentColor read as black) are SHELF_GLYPH_SVG's, and that the shelves, names and colours equal the design system's
// exports and its tokens.css, in light and in dark.
import { tinted, type Bitmap } from "./png.ts";
import { rasterizeSvg } from "./raster.ts";

/** The library's shelves, in the order the menu lists them (packages/ui/src/generated/tokens.ts). */
export const SHELVES = ["goals", "ideas", "problems", "memories", "people", "topics"] as const;
export type Shelf = (typeof SHELVES)[number];

/** How each shelf is named on screen (Shelf.tsx). */
export const SHELF_NAMES: Record<Shelf, string> = {
  goals: "Goals",
  ideas: "Ideas",
  problems: "Problems",
  memories: "Memories",
  people: "People",
  topics: "Topics",
};

/** Each shelf's colour, from the `--av-shelf-*` tokens in light and in dark (packages/ui/src/generated/tokens.css). */
export const SHELF_COLORS: { light: Record<Shelf, string>; dark: Record<Shelf, string> } = {
  light: { goals: "#34c759", ideas: "#ffcc00", problems: "#ff3b30", memories: "#af52de", people: "#007aff", topics: "#8e8e93" },
  dark: { goals: "#30d158", ideas: "#ffd60a", problems: "#ff453a", memories: "#bf5af2", people: "#0a84ff", topics: "#98989d" },
};

// Shelf.tsx's `stroke`, with black for currentColor: shelfGlyphIcon tints the result.
const OUTLINE = 'fill="none" stroke="black" stroke-linecap="round" stroke-linejoin="round"';
const glyph = (shapes: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="12" height="12">${shapes}</svg>`;

/** A flag, a spark, a knot, an hourglass, a figure and a tag, on a 12 point grid: what ShelfGlyph renders, with black for currentColor. */
export const SHELF_GLYPH_SVG: Record<Shelf, string> = {
  goals: glyph(`<path d="M3 11V1.5M3 1.5h6.2L7.8 4l1.4 2.5H3" ${OUTLINE} stroke-width="1.4"/>`),
  ideas: glyph('<path d="M6 .8 7.2 4.8 11.2 6 7.2 7.2 6 11.2 4.8 7.2.8 6 4.8 4.8Z" fill="black"/>'),
  problems: glyph(
    `<path d="M1.5 6c0-2.2 2.2-3.2 4.5-1.1S10.5 7 10.5 6M1.5 6c0 2.2 2.2 3.2 4.5 1.1S10.5 5 10.5 6" ${OUTLINE} stroke-width="1.4"/>`,
  ),
  memories: glyph(
    `<path d="M3 1.2h6M3 10.8h6M3.6 1.2c0 3.2 4.8 2.8 4.8 4.8S3.6 7.6 3.6 10.8M8.4 1.2c0 3.2-4.8 2.8-4.8 4.8s4.8 1.6 4.8 4.8" ${OUTLINE} stroke-width="1.3"/>`,
  ),
  people: glyph(
    `<circle cx="6" cy="3.4" r="2.1" ${OUTLINE} stroke-width="1.4"/>` +
      `<path d="M1.8 11c0-2.9 1.9-4.4 4.2-4.4s4.2 1.5 4.2 4.4" ${OUTLINE} stroke-width="1.4"/>`,
  ),
  topics: glyph(
    `<path d="M1.2 6V1.2H6L10.8 6 6 10.8Z" ${OUTLINE} stroke-width="1.3"/>` + '<circle cx="3.8" cy="3.8" r=".9" fill="black"/>',
  ),
};

const isShelf = (folder: string): folder is Shelf => (SHELVES as readonly string[]).includes(folder);

/** A shelf's glyph in the shelf's colour, 12 points square, for a menu item; null for a folder that isn't a shelf. */
export function shelfGlyphIcon(shelf: string, dark: boolean, scale: 1 | 2): Bitmap | null {
  if (!isShelf(shelf)) return null;
  return tinted(rasterizeSvg(SHELF_GLYPH_SVG[shelf], scale), SHELF_COLORS[dark ? "dark" : "light"][shelf]);
}
