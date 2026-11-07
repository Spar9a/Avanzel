// The app's icon: Zel's face, as the menu bar draws it, in white on a violet rounded square (the design's accent, deepening to its
// darker shade). scripts/make-icon.mjs writes it into build/icon.icns for the packaged app; a development build sets it on the Dock
// itself, where Electron would show its own. Plain TypeScript, so that Node's type stripping can run it: no enums, no parameter properties.
import { menuBarFaceSvg } from "@avanzel/ui/menu-bar";
import { encodePng } from "./png.ts";
import { rasterizeSvg } from "./raster.ts";

/** The accent's two shades, top left to bottom right (the design's --av-accent-fill, dark and light). */
const FROM = [107, 82, 238] as const;
const TO = [76, 52, 190] as const;

/** The icon, `size` pixels square, as a PNG. */
export function appIconPng(size: number): Buffer {
  const rgba = new Uint8Array(size * size * 4);
  const inset = size * 0.1; // macOS icons leave a margin around the tile
  const tile = size - 2 * inset;
  const radius = tile * 0.225;
  // The face, 18 points drawn at a whole scale near 60% of the tile, centred on it, a little above the middle as the face sits high.
  const scale = Math.max(1, Math.floor((tile * 0.62) / 18));
  const face = rasterizeSvg(menuBarFaceSvg("idle"), scale as 1 | 2);
  const left = Math.round((size - face.width) / 2);
  const top = Math.round((size - face.height) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tx = x + 0.5 - inset;
      const ty = y + 0.5 - inset;
      const dx = Math.max(radius - tx, 0, tx - (tile - radius));
      const dy = Math.max(radius - ty, 0, ty - (tile - radius));
      const coverage = Math.max(0, Math.min(1, 0.5 - (Math.hypot(dx, dy) - radius)));
      if (coverage <= 0) continue;
      const t = Math.max(0, Math.min(1, (tx + ty) / (2 * tile)));
      let rgb = FROM.map((c, k) => c + ((TO[k] ?? c) - c) * t);
      const fx = x - left;
      const fy = y - top;
      if (fx >= 0 && fy >= 0 && fx < face.width && fy < face.height) {
        const a = (face.rgba[(fy * face.width + fx) * 4 + 3] ?? 0) / 255;
        rgb = rgb.map((c) => c + (255 - c) * a);
      }
      rgba.set([...rgb.map(Math.round), Math.round(coverage * 255)], (y * size + x) * 4);
    }
  }
  return encodePng(size, size, rgba);
}
