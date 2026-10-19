// Renders the app icon (voice bars on a shelf, on a deep-blue rounded square) into build/icon.icns.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/main/png.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function render(size) {
  const rgba = new Uint8Array(size * size * 4);
  const inset = size * 0.1; // macOS icons leave a margin around the tile
  const tile = size - 2 * inset;
  const radius = tile * 0.225;
  const bars = [[0.22, 0.45, 0.62], [0.36, 0.26, 0.62], [0.5, 0.39, 0.62], [0.64, 0.52, 0.62]]; // x, top, bottom (fractions of tile)
  const barW = 0.085;
  const shelf = [0.17, 0.69, 0.66, 0.045]; // x, y, w, h
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tx = x + 0.5 - inset;
      const ty = y + 0.5 - inset;
      // rounded-rectangle coverage
      const dx = Math.max(radius - tx, 0, tx - (tile - radius));
      const dy = Math.max(radius - ty, 0, ty - (tile - radius));
      const outside = Math.hypot(dx, dy) - radius;
      const coverage = Math.max(0, Math.min(1, 0.5 - outside));
      if (coverage <= 0) continue;
      const u = tx / tile;
      const v = ty / tile;
      // diagonal gradient #4f6bed → #23307d
      let r = 79 + (35 - 79) * (u + v) / 2;
      let g = 107 + (48 - 107) * (u + v) / 2;
      let b = 237 + (125 - 237) * (u + v) / 2;
      const inBar = bars.some(([bx, top, bottom]) => u >= bx && u <= bx + barW && v >= top && v <= bottom);
      const inShelf = u >= shelf[0] && u <= shelf[0] + shelf[2] && v >= shelf[1] && v <= shelf[1] + shelf[3];
      if (inBar || inShelf) [r, g, b] = [255, 255, 255];
      const i = (y * size + x) * 4;
      rgba.set([Math.round(r), Math.round(g), Math.round(b), Math.round(coverage * 255)], i);
    }
  }
  return encodePng(size, size, rgba);
}

const iconset = path.join(mkdtempSync(path.join(tmpdir(), "avz-icon-")), "icon.iconset");
mkdirSync(iconset);
for (const base of [16, 32, 128, 256, 512]) {
  writeFileSync(path.join(iconset, `icon_${base}x${base}.png`), render(base));
  writeFileSync(path.join(iconset, `icon_${base}x${base}@2x.png`), render(base * 2));
}
mkdirSync(path.join(root, "build"), { recursive: true });
execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(root, "build", "icon.icns")]);
writeFileSync(path.join(root, "build", "icon.png"), render(512));
console.log("wrote build/icon.icns");
