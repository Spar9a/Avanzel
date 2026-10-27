// A tiny PNG encoder plus Zel's menu bar faces and shelf-colour dots, so the app needs no image files or image libraries. Plain
// TypeScript, so that Node's type stripping can run it (scripts/make-icon.mjs does): no enums, no parameter properties.
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

/** `bitmap` with every pixel's colour set to `hex` ("#rrggbb") and its alpha kept. */
export function tinted(bitmap: Bitmap, hex: string): Bitmap {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`tinted: "${hex}" isn't a #rrggbb colour`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const rgba = new Uint8Array(bitmap.rgba.length);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([r, g, b, bitmap.rgba[i + 3] ?? 0], i);
  return { width: bitmap.width, height: bitmap.height, rgba };
}

/** A filled, anti-aliased circle in `hex` colour, for menu items that show a shelf. */
export function dotIcon(hex: string, scale: 1 | 2): Bitmap {
  const size = 12 * scale;
  const rgba = new Uint8Array(size * size * 4);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const centre = size / 2;
  const radius = 4 * scale;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - distance));
      const i = (y * size + x) * 4;
      rgba.set([r, g, b, Math.round(coverage * 255)], i);
    }
  }
  return { width: size, height: size, rgba };
}
