// Renders the app icon (Zel's face, white on a violet rounded square: src/main/app-icon.ts) into build/icon.icns.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appIconPng } from "../src/main/app-icon.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const iconset = path.join(mkdtempSync(path.join(tmpdir(), "avz-icon-")), "icon.iconset");
mkdirSync(iconset);
for (const base of [16, 32, 128, 256, 512]) {
  writeFileSync(path.join(iconset, `icon_${base}x${base}.png`), appIconPng(base));
  writeFileSync(path.join(iconset, `icon_${base}x${base}@2x.png`), appIconPng(base * 2));
}
mkdirSync(path.join(root, "build"), { recursive: true });
execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(root, "build", "icon.icns")]);
writeFileSync(path.join(root, "build", "icon.png"), appIconPng(512));
console.log("wrote build/icon.icns");
