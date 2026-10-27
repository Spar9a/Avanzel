import { describe, expect, it } from "vitest";
import type { Bitmap } from "../src/main/png.ts";
import { rasterizeSvg } from "../src/main/raster.ts";

// The rasterizer paints the little subset of SVG that the menu bar's art uses. These tests pin each piece of the subset, and
// that anything outside it throws. "At (x, y)" means the pixel that holds that point of the drawing.

const svg = (size: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${body}</svg>`;
const STROKE = 'fill="none" stroke="black"';

const alphaAt = (bitmap: Bitmap, scale: 1 | 2, x: number, y: number): number =>
  bitmap.rgba[(Math.floor(y * scale) * bitmap.width + Math.floor(x * scale)) * 4 + 3] ?? -1;
const alphas = (bitmap: Bitmap): number[] => Array.from(bitmap.rgba).filter((_, i) => i % 4 === 3);
const area = (bitmap: Bitmap): number => alphas(bitmap).reduce((sum, a) => sum + a, 0) / 255;

describe("rasterizeSvg", () => {
  it("makes a bitmap of the viewBox times the scale, in black with the coverage as alpha", () => {
    for (const scale of [1, 2] as const) {
      const bitmap = rasterizeSvg('<svg viewBox="0 0 5 3"><rect x="0" y="0" width="5" height="3"/></svg>', scale);
      expect([bitmap.width, bitmap.height]).toEqual([5 * scale, 3 * scale]);
      expect(bitmap.rgba.length).toBe(5 * 3 * scale * scale * 4);
      expect(Array.from(bitmap.rgba).filter((_, i) => i % 4 !== 3).every((v) => v === 0)).toBe(true);
      expect(alphas(bitmap).every((a) => a === 255)).toBe(true);
    }
  });

  it("a filled rect covers its pixels exactly", () => {
    const bitmap = rasterizeSvg('<svg viewBox="0 0 4 4"><rect x="1" y="1" width="2" height="2" fill="black"/></svg>', 1);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const inside = x >= 1 && x <= 2 && y >= 1 && y <= 2;
        expect(alphaAt(bitmap, 1, x, y), `pixel ${x},${y}`).toBe(inside ? 255 : 0);
      }
    }
  });

  it("a circle's coverage is its area", () => {
    const circle = svg(12, '<circle cx="6" cy="6" r="5" fill="black"/>');
    expect(Math.abs(area(rasterizeSvg(circle, 1)) - Math.PI * 25) / (Math.PI * 25)).toBeLessThan(0.02);
    // at 2x a pixel is a quarter of the area, so the same circle covers four times as many
    expect(Math.abs(area(rasterizeSvg(circle, 2)) / 4 - Math.PI * 25) / (Math.PI * 25)).toBeLessThan(0.02);
  });

  it("a stroked circle is round", () => {
    const ring = rasterizeSvg(svg(12, `<circle cx="6" cy="6" r="5" ${STROKE} stroke-width="1"/>`), 2);
    const ray = (radius: number) => [6 + radius * Math.cos(Math.PI / 8), 6 + radius * Math.sin(Math.PI / 8)] as const;
    // On the 22.5 degree ray the ring reaches out to radius 5.5. A circle flattened to an octagon has its edge at 5 * cos(22.5) = 4.62
    // there, so its stroke would end at 5.12 and leave this pixel mostly bare.
    expect(alphaAt(ring, 2, ...ray(5.4))).toBeGreaterThan(200);
    expect(alphaAt(ring, 2, ...ray(6))).toBe(0); // beyond the outer edge
    expect(alphaAt(ring, 2, 6, 6)).toBe(0); // and the ring is hollow
  });

  it("a stroke has round caps", () => {
    const line = rasterizeSvg(svg(10, `<path d="M2 5H8" ${STROKE} stroke-width="2"/>`), 1);
    // The cap is a half circle of radius 1 around each end. A butt cap would leave 1.5 bare, and a square one would fill it.
    expect(alphaAt(line, 1, 1.5, 5)).toBeGreaterThan(0);
    expect(alphaAt(line, 1, 1.5, 5)).toBeLessThan(255);
    expect(alphaAt(line, 1, 0.5, 5)).toBe(0);
    expect(alphaAt(line, 1, 8.5, 5)).toBeGreaterThan(0);
    expect(alphaAt(line, 1, 9.5, 5)).toBe(0);
    expect(alphaAt(line, 1, 5, 5)).toBe(255);
    expect(alphaAt(line, 1, 5, 4)).toBe(255);
    expect(alphaAt(line, 1, 5, 3)).toBe(0);
  });

  it("a quadratic and a cubic pass through their midpoints", () => {
    // q5 10 10 0 peaks at (5, 5) at t = .5. The control point (5, 10) is not on the curve.
    const quadratic = rasterizeSvg(svg(12, `<path d="M0 0 q5 10 10 0" ${STROKE}/>`), 1);
    expect(alphaAt(quadratic, 1, 5, 5)).toBeGreaterThan(0);
    expect(alphaAt(quadratic, 1, 4.5, 4.5)).toBeGreaterThan(0);
    expect(alphaAt(quadratic, 1, 5, 9)).toBe(0);
    expect(alphaAt(quadratic, 1, 5, 1)).toBe(0);
    // c0 10 10 10 10 0 passes (5, 7.5) at t = .5, with its control points at (0, 10) and (10, 10)
    const cubic = rasterizeSvg(svg(12, `<path d="M0 0 c0 10 10 10 10 0" ${STROKE}/>`), 1);
    expect(alphaAt(cubic, 1, 5, 7.5)).toBeGreaterThan(128);
    expect(alphaAt(cubic, 1, 5, 9.5)).toBe(0);
    expect(alphaAt(cubic, 1, 5, 5)).toBe(0);
  });

  it("relative h and l: the asleep face's z mark", () => {
    const mark = rasterizeSvg(
      svg(18, '<path d="M13.6 1.4h2.6l-2.6 3h2.6" fill="none" stroke="black" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'),
      1,
    );
    for (const [x, y] of [[13.6, 1.4], [16.2, 1.4], [13.6, 4.4], [16.2, 4.4]] as const) {
      expect(alphaAt(mark, 1, x, y), `corner ${x},${y}`).toBeGreaterThan(0);
    }
    expect(alphaAt(mark, 1, 14.9, 2.9)).toBeGreaterThan(0); // the diagonal's middle
    expect(alphaAt(mark, 1, 13.6, 2.9)).toBe(0); // a z is open on the left, between its bars
    expect(alphaAt(mark, 1, 2.6, 1.4)).toBe(0); // h is relative: an absolute H2.6 would run off to the left
  });

  it("implicit line-tos and compact numbers", () => {
    // The ideas glyph: extra pairs after M are line-tos, "Z" closes, and 7.2.8 is 7.2 then .8.
    const spark = rasterizeSvg(svg(12, '<path d="M6 .8 7.2 4.8 11.2 6 7.2 7.2 6 11.2 4.8 7.2.8 6 4.8 4.8Z" fill="black"/>'), 1);
    for (const [x, y] of [[5, 5], [6, 5], [5, 6], [6, 6]] as const) expect(alphaAt(spark, 1, x, y), `centre ${x},${y}`).toBe(255);
    expect(alphaAt(spark, 1, 1, 6)).toBeGreaterThan(0); // the west tip, which is the .8 after 7.2
    expect(alphaAt(spark, 1, 6, 1.5)).toBeGreaterThan(0); // the north arm, which is still thin this near its tip at (6, .8)
    expect(alphaAt(spark, 1, 10, 1)).toBe(0); // the notch between the tips
    // a sign starts a number as well: 0-2.2 is 0 then -2.2
    const same = (compact: string, spaced: string) => {
      const draw = (d: string) => rasterizeSvg(svg(12, `<path d="${d}" ${STROKE}/>`), 1);
      expect(Array.from(draw(compact).rgba)).toEqual(Array.from(draw(spaced).rgba));
      expect(area(draw(compact))).toBeGreaterThan(1);
    };
    same("M1.5 6c0-2.2 2.2-3.2 4.5-1.1", "M 1.5 6 c 0 -2.2 2.2 -3.2 4.5 -1.1");
    same("M1,6L10.8,6,6,10.8", "M1 6 L 10.8 6 L 6 10.8");
    same("M1 6h.5.5.5", "M1 6 h 0.5 h 0.5 h 0.5");
  });

  it("a closed path strokes its closing edge", () => {
    const closed = rasterizeSvg(svg(10, `<path d="M1 1H9V9z" ${STROKE}/>`), 1);
    const open = rasterizeSvg(svg(10, `<path d="M1 1H9V9" ${STROKE}/>`), 1);
    expect(alphaAt(closed, 1, 5, 5)).toBeGreaterThan(200); // on the diagonal back to the start
    expect(alphaAt(open, 1, 5, 5)).toBe(0);
  });

  it("opacity halves alpha", () => {
    const half = rasterizeSvg('<svg viewBox="0 0 4 4"><rect x="1" y="1" width="2" height="2" opacity=".5"/></svg>', 1);
    expect([127, 128]).toContain(alphaAt(half, 1, 1, 1));
    expect(alphaAt(half, 1, 0, 0)).toBe(0);
  });

  it("unknowns throw with their name", () => {
    const body = (inner: string) => () => rasterizeSvg(svg(10, inner), 1);
    expect(body('<ellipse cx="5" cy="5" rx="3" ry="2"/>')).toThrow(/ellipse/);
    expect(body('<rect x="1" y="1" width="2" height="2" transform="rotate(45)"/>')).toThrow(/transform/);
  });
});

describe("rasterizeSvg paint", () => {
  it("fills with the nonzero rule", () => {
    // Two squares drawn the same way round: the inner one is wound twice, which nonzero fills (even-odd would leave a hole).
    const same = rasterizeSvg(svg(10, '<path d="M1 1H9V9H1Z M3 3H7V7H3Z"/>'), 1);
    expect(alphaAt(same, 1, 5, 5)).toBe(255);
    // Drawn the other way round, the inner square cancels the outer one's winding and leaves a hole.
    const opposite = rasterizeSvg(svg(10, '<path d="M1 1H9V9H1Z M3 3V7H7V3Z"/>'), 1);
    expect(alphaAt(opposite, 1, 5, 5)).toBe(0);
    expect(alphaAt(opposite, 1, 2, 5)).toBe(255);
  });

  it("uses SVG's defaults: fill black, stroke none, stroke-width 1", () => {
    expect(alphaAt(rasterizeSvg(svg(10, '<rect x="1" y="1" width="2" height="2"/>'), 1), 1, 1, 1)).toBe(255);
    expect(area(rasterizeSvg(svg(10, '<path d="M1 5H9"/>'), 1))).toBe(0); // a line has no area to fill, and no stroke
    const line = rasterizeSvg(svg(10, '<path d="M1 5H9" stroke="black"/>'), 1);
    expect([127, 128]).toContain(alphaAt(line, 1, 5, 4)); // 1 wide, centred on y = 5
    expect([127, 128]).toContain(alphaAt(line, 1, 5, 5));
    expect(alphaAt(line, 1, 5, 3)).toBe(0);
    expect(area(rasterizeSvg(svg(10, '<rect x="1" y="1" width="2" height="2" fill="none"/>'), 1))).toBe(0);
  });

  it("draws round caps and joins, whether the art says round or says nothing", () => {
    const draw = (attributes: string) =>
      Array.from(rasterizeSvg(svg(10, `<path d="M2 5H8V9" ${STROKE} stroke-width="2" ${attributes}/>`), 1).rgba);
    const unstated = draw("");
    expect(unstated.some((v) => v > 0)).toBe(true);
    expect(draw('stroke-linecap="round" stroke-linejoin="round"')).toEqual(unstated);
    expect(draw('stroke-linecap="Round"')).toEqual(unstated); // a CSS keyword, so case doesn't matter
    const grouped = rasterizeSvg(svg(10, `<g stroke-linecap="round" stroke-linejoin="round"><path d="M2 5H8V9" ${STROKE} stroke-width="2"/></g>`), 1);
    expect(Array.from(grouped.rgba)).toEqual(unstated);
  });

  it.each(["black", "red", "#ff0000", "currentColor"])("paints any fill other than none, in black: %s", (fill) => {
    const bitmap = rasterizeSvg(svg(10, `<rect x="1" y="1" width="2" height="2" fill="${fill}"/>`), 1);
    expect(alphaAt(bitmap, 1, 1, 1)).toBe(255);
    expect(Array.from(bitmap.rgba).filter((_, i) => i % 4 !== 3).every((v) => v === 0)).toBe(true);
  });

  it("a g passes its paint to its children, and a child's own wins", () => {
    const draw = (body: string) => Array.from(rasterizeSvg(svg(10, body), 1).rgba);
    expect(draw(`<g ${STROKE} stroke-width="2"><path d="M1 5H9"/></g>`)).toEqual(draw(`<path d="M1 5H9" ${STROKE} stroke-width="2"/>`));
    expect(draw(`<g ${STROKE}><g stroke-width="3"><path d="M1 5H9"/></g></g>`)).toEqual(draw(`<path d="M1 5H9" ${STROKE} stroke-width="3"/>`));
    const disc = rasterizeSvg(svg(10, `<g ${STROKE}><circle cx="5" cy="5" r="3" fill="black" stroke="none"/></g>`), 1);
    expect(alphaAt(disc, 1, 5, 5)).toBe(255);
    expect(area(disc)).toBeGreaterThan(Math.PI * 9 * 0.98);
    expect(area(disc)).toBeLessThan(Math.PI * 9 * 1.02);
  });

  it("multiplies the opacity of a g into its children", () => {
    const bitmap = rasterizeSvg(svg(10, '<g opacity=".5"><rect x="1" y="1" width="2" height="2" opacity=".5"/><rect x="5" y="5" width="2" height="2"/></g>'), 1);
    expect([63, 64]).toContain(alphaAt(bitmap, 1, 1, 1));
    expect([127, 128]).toContain(alphaAt(bitmap, 1, 5, 5));
  });

  it("takes the greatest coverage where elements overlap, never the sum", () => {
    const halves = rasterizeSvg(svg(6, '<rect x="0" y="0" width="4" height="4" opacity=".5"/><rect x="2" y="2" width="4" height="4" opacity=".5"/>'), 1);
    expect([127, 128]).toContain(alphaAt(halves, 1, 3, 3)); // both over it: still one half, not three quarters
    expect([127, 128]).toContain(alphaAt(halves, 1, 0, 0));
    expect([127, 128]).toContain(alphaAt(halves, 1, 5, 5));
    const mixed = rasterizeSvg(svg(6, '<rect x="0" y="0" width="4" height="4" opacity=".5"/><rect x="2" y="2" width="4" height="4"/>'), 1);
    expect(alphaAt(mixed, 1, 3, 3)).toBe(255);
    expect([127, 128]).toContain(alphaAt(mixed, 1, 0, 0));
    // a stroke and a fill of the same element overlap the same way
    const both = rasterizeSvg(svg(10, '<circle cx="5" cy="5" r="3" fill="black" stroke="black" stroke-width="2" opacity=".5"/>'), 1);
    expect([127, 128]).toContain(alphaAt(both, 1, 5, 5));
    expect([127, 128]).toContain(alphaAt(both, 1, 5, 2)); // on the ring
  });

  it("rounds a rect's corners with rx", () => {
    const pill = rasterizeSvg('<svg viewBox="0 0 12 8"><rect x="1" y="1" width="10" height="6" rx="2"/></svg>', 1);
    expect(Math.abs(area(pill) - (60 - (4 - Math.PI) * 4)) / 56.5).toBeLessThan(0.01);
    expect(alphaAt(pill, 1, 1, 1)).toBeLessThan(128); // the corner pixel, which a square corner would fill
    expect(alphaAt(pill, 1, 5, 1)).toBe(255);
    const outline = rasterizeSvg(svg(10, `<rect x="2" y="2" width="6" height="4" ${STROKE}/>`), 1);
    expect([127, 128]).toContain(alphaAt(outline, 1, 4, 2)); // the top edge, half in each of the two rows it crosses
    expect([127, 128]).toContain(alphaAt(outline, 1, 4, 1));
    expect(alphaAt(outline, 1, 5, 4)).toBe(0);
    expect(alphaAt(outline, 1, 1, 1)).toBeGreaterThan(0); // the round join outside the corner
    expect(alphaAt(outline, 1, 1, 1)).toBeLessThan(128);
  });
});

describe("rasterizeSvg path data", () => {
  const TWINS: [what: string, one: string, other: string][] = [
    ["l is L, relative", "M2 2l6 0l0 6", "M2 2L8 2L8 8"],
    ["h and v are H and V, relative", "M2 2h6v6", "M2 2H8V8"],
    ["q is Q, relative", "M2 2q4 6 8 0", "M2 2Q6 8 10 2"],
    ["c is C, relative", "M2 2c0 6 8 6 8 0", "M2 2C2 8 10 8 10 2"],
    ["s is S, relative", "M1 6C3 1 7 1 9 6s6 5 8 0", "M1 6C3 1 7 1 9 6S15 11 17 6"],
    ["S after a cubic reflects its second control point", "M1 6C3 1 7 1 9 6S15 11 17 6", "M1 6C3 1 7 1 9 6C11 11 15 11 17 6"],
    ["S after anything else starts from the current point", "M1 6L9 6S15 11 17 6", "M1 6L9 6C9 6 15 11 17 6"],
    ["m is M, relative to the current point", "M1 1m2 2l4 0", "M1 1M3 3L7 3"],
    ["a command after z starts again from the start of the subpath", "M2 2h6v6zl3 0", "M2 2H8V8ZL5 2"],
    ["extra pairs after m are relative line-tos", "M2 2m1 1 2 0 0 2", "M2 2M3 3L5 3L5 5"],
    ["extra groups repeat the command", "M2 2q2 4 4 0 2 -4 4 0", "M2 2Q4 6 6 2Q8 -2 10 2"],
  ];

  it.each(TWINS)("%s", (_what, one, other) => {
    const draw = (d: string) => rasterizeSvg(svg(20, `<path d="${d}" ${STROKE} stroke-width="1.2"/>`), 2);
    expect(Array.from(draw(one).rgba)).toEqual(Array.from(draw(other).rgba));
    expect(area(draw(one))).toBeGreaterThan(1); // so two empty bitmaps can't pass
  });
});

describe("rasterizeSvg outside the subset", () => {
  const CASES: [what: string, body: string, name: RegExp][] = [
    ["an element: ellipse", '<ellipse cx="5" cy="5" rx="3" ry="2"/>', /ellipse/],
    ["an element: line", '<line x1="1" y1="1" x2="9" y2="9" stroke="black"/>', /line/],
    ["an element: text", '<text x="1" y="5"/>', /<text>/],
    ["an element: defs", '<defs><path d="M0 0"/></defs>', /defs/],
    ["an attribute: transform", '<rect x="1" y="1" width="2" height="2" transform="rotate(45)"/>', /transform/],
    ["an attribute: fill-rule", '<path d="M1 1H9V9z" fill-rule="evenodd"/>', /fill-rule/],
    ["an attribute: fill-opacity", '<path d="M1 1H9V9z" fill-opacity=".5"/>', /fill-opacity/],
    ["an attribute: stroke-dasharray", '<path d="M1 1H9" stroke="black" stroke-dasharray="1 1"/>', /stroke-dasharray/],
    ["an attribute: style", '<path d="M1 1H9V9z" style="fill:red"/>', /style/],
    ["an attribute on a g: clip-path", '<g clip-path="url(#c)"><path d="M1 1H9V9z"/></g>', /clip-path/],
    ["an attribute: ry", '<rect x="1" y="1" width="4" height="4" rx="1" ry="2"/>', /ry="2"/],
    ["a cap that isn't round: stroke-linecap", '<path d="M1 5H9" fill="none" stroke="black" stroke-linecap="butt"/>', /stroke-linecap="butt"/],
    ["a join that isn't round: stroke-linejoin", '<path d="M1 1H9V9" fill="none" stroke="black" stroke-linejoin="miter"/>', /stroke-linejoin="miter"/],
    ["a cap on a g that isn't round", '<g stroke-linecap="square"><path d="M1 5H9" fill="none" stroke="black"/></g>', /stroke-linecap="square"/],
    ["an attribute of another element: r on a rect", '<rect x="1" y="1" width="4" height="4" r="2"/>', /\br\b/],
    ["a path command: A", '<path d="M1 5A4 4 0 0 1 9 5"/>', /"A"/],
    ["a path command: T", '<path d="M1 5Q5 0 9 5T17 5"/>', /"T"/],
    ["a path that doesn't start with M", '<path d="L1 1 5 5"/>', /M/],
    ["a number after z", '<path d="M1 1H9V9z 3 3"/>', /after Z/],
    ["too few numbers for a command", '<path d="M1 1 5"/>', /"L" needs 2 numbers/],
    ["no number for a one-number command", '<path d="M1 1H"/>', /"H" needs 1 number$/],
    ["a size that isn't a plain number", '<circle cx="5" cy="5" r="2px"/>', /r="2px"/],
    ["a missing radius", '<circle cx="5" cy="5"/>', /\br\b/],
    ["a negative stroke width", '<path d="M1 1H9" stroke="black" stroke-width="-1"/>', /stroke-width/],
    ["a corner rounder than half the rect", '<rect x="1" y="1" width="4" height="2" rx="2"/>', /rx/],
    ["a child inside a circle", '<circle cx="5" cy="5" r="2"><path d="M0 0"/></circle>', /circle/],
  ];

  it.each(CASES)("throws on %s, naming it", (_what, body, name) => {
    expect(() => rasterizeSvg(svg(10, body), 1)).toThrow(name);
  });

  it("throws on an attribute of the svg element, and on a missing or odd viewBox", () => {
    expect(() => rasterizeSvg('<svg viewBox="0 0 4 4" transform="scale(2)"></svg>', 1)).toThrow(/transform/);
    expect(() => rasterizeSvg('<svg viewBox="0 0 4 4" fill="black"><rect x="1" y="1" width="2" height="2"/></svg>', 1)).toThrow(/fill/);
    expect(() => rasterizeSvg('<svg width="4" height="4"></svg>', 1)).toThrow(/viewBox/);
    expect(() => rasterizeSvg('<svg viewBox="1 1 4 4"></svg>', 1)).toThrow(/viewBox/);
    expect(() => rasterizeSvg('<svg viewBox="0 0 4.5 4"></svg>', 1)).toThrow(/viewBox/);
    expect(() => rasterizeSvg('<g viewBox="0 0 4 4"></g>', 1)).toThrow(/svg/);
  });

  it("ignores the svg element's xmlns, width and height", () => {
    const bitmap = rasterizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="99" height="77" viewBox="0 0 4 4"><rect x="1" y="1" width="2" height="2"/></svg>', 2);
    expect([bitmap.width, bitmap.height]).toEqual([8, 8]);
  });

  it("throws on markup it can't read", () => {
    expect(() => rasterizeSvg('<svg viewBox="0 0 4 4"><rect x="1" y="1" width="2" height="2"', 1)).toThrow();
    expect(() => rasterizeSvg('<svg viewBox="0 0 4 4"><g></svg>', 1)).toThrow();
    expect(() => rasterizeSvg('<svg viewBox="0 0 4 4"></svg><svg viewBox="0 0 4 4"></svg>', 1)).toThrow();
    expect(() => rasterizeSvg('<svg viewBox="0 0 4 4">stray</svg>', 1)).toThrow(/stray/);
    expect(() => rasterizeSvg('<svg viewBox="0 0 4 4"><!-- hi --></svg>', 1)).toThrow(/<!--/);
    expect(() => rasterizeSvg("", 1)).toThrow();
  });
});
