// A tiny PNG encoder plus Zel's menu bar faces, so the app needs no image files or image libraries. Plain TypeScript, so that Node's
// type stripping can run it (scripts/make-icon.mjs does): no enums, no parameter properties.
import { deflateSync } from "node:zlib";
import { menuBarFaceSvg, type MenuBarState } from "@avanzel/ui/menu-bar";
import { rasterizeSvg } from "./raster.ts";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export interface Bitmap {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** Zel's menu bar face in `state`: 18 points square, black on transparent, for an Electron template image. */
export function faceIcon(state: MenuBarState, scale: 1 | 2): Bitmap {
  return rasterizeSvg(menuBarFaceSvg(state), scale);
}

/** Where the badge sits on the 18-point face: its centre and radius, in points; the ring cleared around it, so it reads apart. */
const BADGE = { x: 14, y: 4, r: 4, ring: 1 };

/** Each count's figure as strokes in a 2.4 × 4 point box, its top left at (0, 0): 1 to 9, and + for more. */
const FIGURES: Record<string, string> = {
  "1": "M1.4 0 V4 M0.5 0.8 L1.4 0",
  "2": "M0.1 0.9 Q0.3 0 1.2 0 Q2.3 0 2.3 1.1 Q2.2 1.9 0.1 4 H2.4",
  "3": "M0.1 0.4 Q1.2 -0.2 2 0.4 Q2.4 1.2 1.1 1.9 Q2.5 2.2 2.2 3.3 Q1.4 4.3 0 3.6",
  "4": "M1.8 4 V0 L0 2.8 H2.4",
  "5": "M2.2 0 H0.3 L0.1 1.8 Q1.4 1.3 2.1 2 Q2.6 3 1.9 3.7 Q1 4.3 0 3.7",
  "6": "M2 0.2 Q0.2 0.3 0.1 2.4 Q0.2 4 1.2 4 Q2.3 4 2.3 2.8 Q2.2 1.7 1.2 1.7 Q0.4 1.7 0.1 2.4",
  "7": "M0 0 H2.4 L0.9 4",
  "8": "M1.2 1.8 Q0.2 1.7 0.2 0.9 Q0.3 0 1.2 0 Q2.1 0 2.2 0.9 Q2.2 1.7 1.2 1.8 Q0 1.9 0 2.9 Q0.1 4 1.2 4 Q2.3 4 2.4 2.9 Q2.4 1.9 1.2 1.8",
  "9": "M0.4 3.8 Q2.2 3.7 2.3 1.6 Q2.2 0 1.2 0 Q0.1 0 0.1 1.2 Q0.2 2.3 1.2 2.3 Q2 2.3 2.3 1.6",
  "+": "M1.2 0.8 V3.2 M0 2 H2.4",
};

/** `d`, a path of absolute M, L, H, V and Q commands only, moved by (`dx`, `dy`). */
function moved(d: string, dx: number, dy: number): string {
  const out: string[] = [];
  let command = "";
  let axis = 0;
  for (const token of d.match(/[MLHVQ]|-?\d*\.?\d+/g) ?? []) {
    if (/[MLHVQ]/.test(token)) {
      command = token;
      axis = 0;
      out.push(token);
      continue;
    }
    const n = Number(token);
    const shift = command === "H" ? dx : command === "V" ? dy : axis % 2 === 0 ? dx : dy;
    out.push(String(Math.round((n + shift) * 1000) / 1000));
    axis++;
  }
  return out.join(" ");
}

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18">${body}</svg>`;

/**
 * `face` with a badge at its top right, as an app's icon counts what is unread: a disc with `count` cut out of it (1 to 9, then +),
 * cleared from the face by a ring so the two read apart. One ink, so it stays a template image that macOS tints for the menu bar.
 * `face` as it is for a count of 0.
 */
export function withBadge(face: Bitmap, count: number, scale: 1 | 2): Bitmap {
  if (count <= 0) return face;
  const ring = rasterizeSvg(svg(`<circle cx="${BADGE.x}" cy="${BADGE.y}" r="${BADGE.r + BADGE.ring}"/>`), scale);
  const disc = rasterizeSvg(svg(`<circle cx="${BADGE.x}" cy="${BADGE.y}" r="${BADGE.r}"/>`), scale);
  const figure = FIGURES[count > 9 ? "+" : String(count)] ?? FIGURES["+"]!;
  const cut = rasterizeSvg(svg(`<path d="${moved(figure, BADGE.x - 1.2, BADGE.y - 2)}" fill="none" stroke="black" stroke-width="0.9"/>`), scale);
  const rgba = new Uint8Array(face.rgba);
  for (let i = 3; i < rgba.length; i += 4) {
    const kept = (rgba[i] ?? 0) * (1 - (ring.rgba[i] ?? 0) / 255); // the face, cleared under the ring
    const badge = (disc.rgba[i] ?? 0) * (1 - (cut.rgba[i] ?? 0) / 255); // the disc, the figure cut out of it
    rgba[i] = Math.round(Math.max(kept, badge));
  }
  return { width: face.width, height: face.height, rgba };
}

/** The badge's red, as macOS draws an app's count of what is unread; its figure is white. */
const BADGE_RED = [255, 59, 48] as const;

/**
 * `withBadge`, in colour, as an app's icon counts what is unread: the face in the menu bar's own ink (white on a dark menu bar, black
 * on a light one: `dark`), and the badge a red disc with its count in white. Not a template image: macOS doesn't tint it, so the
 * face's ink is chosen here, and the icon is made again when the appearance changes.
 */
export function colorBadge(face: Bitmap, count: number, scale: 1 | 2, dark: boolean): Bitmap {
  const shape = withBadge(face, count, scale); // the face cleared by the ring, the disc and the figure cut out of it: their alphas
  const disc = rasterizeSvg(svg(`<circle cx="${BADGE.x}" cy="${BADGE.y}" r="${BADGE.r}"/>`), scale);
  const ink = dark ? 255 : 0;
  const rgba = new Uint8Array(shape.rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const inDisc = (disc.rgba[i + 3] ?? 0) / 255;
    const red = (shape.rgba[i + 3] ?? 0) / 255; // where the badge (or the face, outside it) is
    if (inDisc > 0) {
      // Inside the disc: red where the shape is, white where the figure was cut out of it, blended at the edges.
      const white = Math.max(0, inDisc - red);
      const alpha = Math.min(1, red + white);
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(alpha ? ((BADGE_RED[c] ?? 0) * red + 255 * white) / alpha : 0);
      rgba[i + 3] = Math.round(alpha * 255);
    } else {
      rgba[i] = ink;
      rgba[i + 1] = ink;
      rgba[i + 2] = ink;
      rgba[i + 3] = shape.rgba[i + 3] ?? 0;
    }
  }
  return { width: shape.width, height: shape.height, rgba };
}
