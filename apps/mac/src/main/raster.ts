// A small SVG rasterizer for the menu bar. Electron can't decode SVG, and the design system's art is SVG text, so this paints the
// subset that art uses into the black-with-alpha bitmaps png.ts encodes. It paints nothing else: whatever falls outside the subset
// throws, naming itself, so a change to the art can't fail silently.
//
//   <svg viewBox="0 0 W H">   its xmlns, width and height are ignored
//   <g>                       passes fill, stroke, stroke-width, stroke-linecap, stroke-linejoin and opacity to its children
//   <circle cx cy r>   <rect x y width height rx>   <path d>
//
// Paths take M m L l H h V v Q q C c S s Z z, with SVG's implicit repeats and compact numbers. Fill, stroke and stroke-width default
// as in SVG: fill black, stroke none, stroke-width 1. Any fill or stroke other than "none" paints, in black. Fills are nonzero.
// Strokes are always round-capped and round-joined, because the art uses only round ones. So leaving stroke-linecap and
// stroke-linejoin out draws round (SVG's own defaults are butt and miter), "round" is the only value they may state, and any other
// value throws. A circle and a rect are measured exactly, never flattened; a curve is flattened into 8 segments (16 at 2x).
//
// Each pixel is 4 × 4 subsamples. A subsample takes the most opaque of the elements over it, so overlapping elements never add up,
// which is what a one-colour template image wants. A group's opacity multiplies into its children's.
//
// Plain TypeScript, so that Node's type stripping can run it: no enums, no parameter properties.
import type { Bitmap } from "./png.ts";

const SUBSAMPLES = 4;
const CURVE_STEPS = 8; // line segments per curve at 1x

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const PAINT = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity"];
/** The two paint attributes that can only say "round", the one cap and join this draws. */
const ROUND_ONLY = ["stroke-linecap", "stroke-linejoin"];
const SHAPES: Record<string, string[]> = {
  g: [],
  circle: ["cx", "cy", "r"],
  rect: ["x", "y", "width", "height", "rx"],
  path: ["d"],
};
const ROOT = ["viewBox", "xmlns", "width", "height"];
/** How many numbers each path command takes, by its lower case letter. */
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, q: 4, c: 6, s: 4, z: 0 };

interface Tag {
  name: string;
  attrs: Map<string, string>;
  children: Tag[];
}

/** What a group hands down to its children. */
interface Style {
  fill: boolean;
  stroke: boolean;
  strokeWidth: number;
  opacity: number;
}

/** One painted shape: where it covers, in the drawing's own units, and how opaque it is. */
interface Layer {
  opacity: number;
  covers: (x: number, y: number) => boolean;
}

interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Subpath {
  points: [number, number][];
  closed: boolean;
}

/**
 * Paints `svg` into a bitmap of its viewBox's size times `scale`: black, with the coverage as alpha. Throws, naming it, on any
 * element, attribute, attribute value (a cap or join that isn't round) or path command outside the subset above.
 */
export function rasterizeSvg(svg: string, scale: 1 | 2): Bitmap {
  const root = parseMarkup(svg);
  if (root.name !== "svg") throw new Error(`rasterizeSvg: the root must be <svg>, not <${root.name}>`);
  for (const [name, value] of root.attrs) {
    if (!ROOT.includes(name)) throw new Error(`rasterizeSvg: ${name}="${value}" on <svg> isn't supported`);
  }
  const [viewWidth, viewHeight] = viewBoxSize(root);

  const layers: Layer[] = [];
  collect(root, { fill: true, stroke: false, strokeWidth: 1, opacity: 1 }, CURVE_STEPS * scale, layers);

  const width = viewWidth * scale;
  const height = viewHeight * scale;
  const rgba = new Uint8Array(width * height * 4);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let covered = 0;
      for (let j = 0; j < SUBSAMPLES; j++) {
        const y = (py + (j + 0.5) / SUBSAMPLES) / scale;
        for (let i = 0; i < SUBSAMPLES; i++) {
          const x = (px + (i + 0.5) / SUBSAMPLES) / scale;
          let best = 0;
          for (const layer of layers) {
            if (layer.opacity > best && layer.covers(x, y)) best = layer.opacity;
          }
          covered += best;
        }
      }
      rgba[(py * width + px) * 4 + 3] = Math.round((covered / (SUBSAMPLES * SUBSAMPLES)) * 255);
    }
  }
  return { width, height, rgba };
}

// ---- Markup: tags, quoted attributes and nothing between them but white space ----

function parseMarkup(svg: string): Tag {
  const next = /\s*<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>\s*/y;
  const attribute = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const open: Tag[] = [];
  let root: Tag | undefined;
  let at = 0;
  while (at < svg.length) {
    next.lastIndex = at;
    const found = next.exec(svg);
    if (!found) throw new Error(`rasterizeSvg: can't read the markup at "${svg.slice(at, at + 24).trim()}"`);
    at = next.lastIndex;
    const [, closing, name = "", attributes = "", selfClosing] = found;
    if (closing) {
      const top = open.pop();
      if (top?.name !== name) throw new Error(`rasterizeSvg: </${name}> doesn't close ${top ? `<${top.name}>` : "anything"}`);
      continue;
    }
    const tag: Tag = { name, attrs: new Map(), children: [] };
    for (const [, key = "", doubleQuoted, singleQuoted] of attributes.matchAll(attribute)) tag.attrs.set(key, doubleQuoted ?? singleQuoted ?? "");
    const parent = open[open.length - 1];
    if (parent) parent.children.push(tag);
    else if (root) throw new Error("rasterizeSvg: there is more than one element at the top");
    else root = tag;
    if (!selfClosing) open.push(tag);
  }
  const unclosed = open[open.length - 1];
  if (unclosed) throw new Error(`rasterizeSvg: <${unclosed.name}> is never closed`);
  if (!root) throw new Error("rasterizeSvg: there is no <svg> element");
  return root;
}

function viewBoxSize(root: Tag): [number, number] {
  const value = root.attrs.get("viewBox");
  if (value === undefined) throw new Error("rasterizeSvg: <svg> needs a viewBox");
  const parts = value.trim().split(/[\s,]+/);
  const [minX = NaN, minY = NaN, width = NaN, height = NaN] = parts.map(Number);
  const whole = (n: number) => Number.isInteger(n) && n > 0;
  if (parts.length !== 4 || !parts.every((part) => NUMBER.test(part)) || minX !== 0 || minY !== 0 || !whole(width) || !whole(height)) {
    throw new Error(`rasterizeSvg: viewBox="${value}" must be "0 0 W H", in whole numbers`);
  }
  return [width, height];
}

// ---- Elements: check each one against the subset, work out its paint, and make its layers ----

function collect(parent: Tag, inherited: Style, steps: number, layers: Layer[]): void {
  for (const tag of parent.children) {
    const allowed = Object.hasOwn(SHAPES, tag.name) ? SHAPES[tag.name] : undefined;
    if (!allowed) throw new Error(`rasterizeSvg: <${tag.name}> isn't supported`);
    for (const [name, value] of tag.attrs) {
      if (!PAINT.includes(name) && !allowed.includes(name)) throw new Error(`rasterizeSvg: ${name}="${value}" on <${tag.name}> isn't supported`);
      if (ROUND_ONLY.includes(name) && value.trim().toLowerCase() !== "round") {
        throw new Error(`rasterizeSvg: ${name}="${value}" on <${tag.name}> isn't supported: strokes are always round`);
      }
    }
    const style = styleOf(tag, inherited);
    if (tag.name === "g") {
      collect(tag, style, steps, layers);
    } else {
      const child = tag.children[0];
      if (child) throw new Error(`rasterizeSvg: <${tag.name}> can't hold <${child.name}>`);
      paint(tag, style, steps, layers);
    }
  }
}

function styleOf(tag: Tag, inherited: Style): Style {
  const fill = tag.attrs.get("fill");
  const stroke = tag.attrs.get("stroke");
  const none = (value: string) => value.trim().toLowerCase() === "none";
  return {
    fill: fill === undefined ? inherited.fill : !none(fill),
    stroke: stroke === undefined ? inherited.stroke : !none(stroke),
    strokeWidth: tag.attrs.has("stroke-width") ? lengthAttr(tag, "stroke-width") : inherited.strokeWidth,
    opacity: inherited.opacity * (tag.attrs.has("opacity") ? Math.min(1, lengthAttr(tag, "opacity")) : 1),
  };
}

function numberAttr(tag: Tag, name: string, fallback?: number): number {
  const value = tag.attrs.get(name);
  if (value === undefined) {
    if (fallback === undefined) throw new Error(`rasterizeSvg: <${tag.name}> needs ${name}`);
    return fallback;
  }
  if (!NUMBER.test(value.trim())) throw new Error(`rasterizeSvg: ${name}="${value}" on <${tag.name}> isn't a plain number`);
  return Number(value);
}

/** A number that can't be negative: a size, a width or an opacity. */
function lengthAttr(tag: Tag, name: string, fallback?: number): number {
  const value = numberAttr(tag, name, fallback);
  if (value < 0) throw new Error(`rasterizeSvg: ${name}="${tag.attrs.get(name)}" on <${tag.name}> can't be negative`);
  return value;
}

/** Makes the layers of one circle, rect or path: its fill, then its stroke. */
function paint(tag: Tag, style: Style, steps: number, layers: Layer[]): void {
  const { opacity } = style;
  const half = style.strokeWidth / 2;

  if (tag.name === "circle") {
    const cx = numberAttr(tag, "cx", 0);
    const cy = numberAttr(tag, "cy", 0);
    const r = lengthAttr(tag, "r");
    if (r === 0) return;
    const away = (x: number, y: number) => Math.hypot(x - cx, y - cy);
    if (style.fill) layers.push({ opacity, covers: (x, y) => away(x, y) <= r });
    if (style.stroke) layers.push({ opacity, covers: (x, y) => Math.abs(away(x, y) - r) <= half });
    return;
  }

  if (tag.name === "rect") {
    const x = numberAttr(tag, "x", 0);
    const y = numberAttr(tag, "y", 0);
    const width = lengthAttr(tag, "width");
    const height = lengthAttr(tag, "height");
    const rx = lengthAttr(tag, "rx", 0);
    // Past half the width or height, SVG's corners turn elliptical, which this doesn't draw.
    if (rx > Math.min(width, height) / 2) throw new Error(`rasterizeSvg: rx="${rx}" on <rect> is more than half its width or height`);
    if (width === 0 || height === 0) return;
    // The distance to the rect's outline, negative inside it: exact for the rounded corners, and a round join on the square ones.
    const signed = (px: number, py: number) => {
      const dx = Math.abs(px - (x + width / 2)) - (width / 2 - rx);
      const dy = Math.abs(py - (y + height / 2)) - (height / 2 - rx);
      return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - rx;
    };
    if (style.fill) layers.push({ opacity, covers: (px, py) => signed(px, py) <= 0 });
    if (style.stroke) layers.push({ opacity, covers: (px, py) => Math.abs(signed(px, py)) <= half });
    return;
  }

  const d = tag.attrs.get("d");
  if (d === undefined) throw new Error("rasterizeSvg: <path> needs d");
  const subpaths = parsePath(d, steps);
  if (style.fill) {
    // Every subpath counts as closed when filling, as in SVG.
    const edges = subpaths.flatMap((subpath) => segments(subpath, true));
    layers.push({ opacity, covers: (px, py) => winding(edges, px, py) !== 0 });
  }
  if (style.stroke) {
    // Within half the width of any segment is a stroke with round caps and joins.
    const edges = subpaths.flatMap((subpath) => segments(subpath, subpath.closed));
    const limit = half * half;
    layers.push({ opacity, covers: (px, py) => edges.some((edge) => within(edge, px, py, limit)) });
  }
}

// ---- Paths ----

/** Where a path command left off, and what the next one starts from. */
interface Pen {
  subpaths: Subpath[];
  /** The subpath being drawn. After a Z there is none, until a command starts the next one where the last began. */
  current: Subpath | undefined;
  x: number;
  y: number;
  /** Where the subpath began, which Z returns to. */
  startX: number;
  startY: number;
  /** The last cubic's second control point, which S reflects. */
  smooth: [number, number] | undefined;
}

function parsePath(d: string, steps: number): Subpath[] {
  const pen: Pen = { subpaths: [], current: undefined, x: 0, y: 0, startX: 0, startY: 0, smooth: undefined };
  const numeral = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const skip = (from: number) => {
    let at = from;
    while (/[\s,]/.test(d.charAt(at))) at++;
    return at;
  };
  let command = ""; // the command in force: an M turns into an L (and an m into an l) once its first pair is read
  let at = 0;
  for (;;) {
    at = skip(at);
    if (at >= d.length) break;
    const char = d.charAt(at);
    if (/[A-Za-z]/.test(char)) {
      command = char;
      at++;
      if (!Object.hasOwn(ARITY, char.toLowerCase())) throw new Error(`rasterizeSvg: unsupported path command "${char}"`);
      if (!pen.subpaths.length && char !== "M" && char !== "m") throw new Error("rasterizeSvg: path data must start with M");
    } else if (command === "") {
      throw new Error("rasterizeSvg: path data must start with M");
    } else if (command === "Z" || command === "z") {
      throw new Error("rasterizeSvg: a number after Z needs a command of its own");
    }
    const lower = command.toLowerCase();
    if (lower === "z") {
      if (pen.current) pen.current.closed = true;
      pen.x = pen.startX;
      pen.y = pen.startY;
      pen.current = undefined;
      pen.smooth = undefined;
      continue;
    }
    const count = ARITY[lower] ?? 0;
    const args: number[] = [];
    for (let k = 0; k < count; k++) {
      at = skip(at);
      numeral.lastIndex = at;
      const found = numeral.exec(d);
      if (!found) throw new Error(`rasterizeSvg: path command "${command}" needs ${count} number${count === 1 ? "" : "s"}`);
      args.push(Number(found[0]));
      at = numeral.lastIndex;
    }
    run(pen, command, args, steps);
    if (command === "M") command = "L";
    else if (command === "m") command = "l";
  }
  return pen.subpaths;
}

function run(pen: Pen, command: string, args: number[], steps: number): void {
  const [n0 = 0, n1 = 0, n2 = 0, n3 = 0, n4 = 0, n5 = 0] = args;
  const lower = command.toLowerCase();
  const ox = command === lower ? pen.x : 0; // a lower case command counts from the current point
  const oy = command === lower ? pen.y : 0;
  switch (lower) {
    case "m":
      pen.x = pen.startX = ox + n0;
      pen.y = pen.startY = oy + n1;
      pen.current = { points: [[pen.x, pen.y]], closed: false };
      pen.subpaths.push(pen.current);
      pen.smooth = undefined;
      break;
    case "l":
      lineTo(pen, ox + n0, oy + n1);
      break;
    case "h":
      lineTo(pen, ox + n0, pen.y);
      break;
    case "v":
      lineTo(pen, pen.x, oy + n0);
      break;
    case "q":
      quadTo(pen, steps, ox + n0, oy + n1, ox + n2, oy + n3);
      break;
    case "c":
      cubicTo(pen, steps, ox + n0, oy + n1, ox + n2, oy + n3, ox + n4, oy + n5);
      break;
    case "s": {
      const [sx, sy] = pen.smooth ?? [pen.x, pen.y]; // with no cubic before it, the first control point is the current point
      cubicTo(pen, steps, 2 * pen.x - sx, 2 * pen.y - sy, ox + n0, oy + n1, ox + n2, oy + n3);
      break;
    }
    default: // a letter added to ARITY without a case above would otherwise draw nothing, silently
      throw new Error(`rasterizeSvg: path command "${command}" isn't drawn`);
  }
}

function lineTo(pen: Pen, x: number, y: number): void {
  if (!pen.current) {
    pen.current = { points: [[pen.x, pen.y]], closed: false };
    pen.subpaths.push(pen.current);
  }
  pen.current.points.push([x, y]);
  pen.x = x;
  pen.y = y;
  pen.smooth = undefined;
}

function quadTo(pen: Pen, steps: number, x1: number, y1: number, x2: number, y2: number): void {
  const [x0, y0] = [pen.x, pen.y];
  const at = (p0: number, p1: number, p2: number, t: number) => (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
  for (let k = 1; k <= steps; k++) lineTo(pen, at(x0, x1, x2, k / steps), at(y0, y1, y2, k / steps));
}

function cubicTo(pen: Pen, steps: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
  const [x0, y0] = [pen.x, pen.y];
  const at = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3;
  for (let k = 1; k <= steps; k++) lineTo(pen, at(x0, x1, x2, x3, k / steps), at(y0, y1, y2, y3, k / steps));
  pen.smooth = [x2, y2];
}

// ---- Geometry ----

/** The straight pieces of a subpath, and the closing one back to its start when `closed`. */
function segments({ points }: Subpath, closed: boolean): Segment[] {
  const found: Segment[] = [];
  points.forEach(([x0, y0], i) => {
    const to = points[i + 1] ?? (closed ? points[0] : undefined);
    if (to) found.push({ x0, y0, x1: to[0], y1: to[1] });
  });
  return found;
}

/** The winding number of `edges` around (x, y): a ray to the right, counting the edges that cross it up and down. */
function winding(edges: Segment[], x: number, y: number): number {
  let wound = 0;
  for (const e of edges) {
    const side = (e.x1 - e.x0) * (y - e.y0) - (x - e.x0) * (e.y1 - e.y0); // positive when (x, y) is left of the edge
    if (e.y0 <= y) {
      if (e.y1 > y && side > 0) wound++;
    } else if (e.y1 <= y && side < 0) {
      wound--;
    }
  }
  return wound;
}

/** Whether (x, y) is within the distance whose square is `limit` of the segment: a capsule with round ends. */
function within(e: Segment, x: number, y: number, limit: number): boolean {
  const dx = e.x1 - e.x0;
  const dy = e.y1 - e.y0;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - e.x0) * dx + (y - e.y0) * dy) / length2));
  const px = e.x0 + t * dx - x;
  const py = e.y0 + t * dy - y;
  return px * px + py * py <= limit;
}
