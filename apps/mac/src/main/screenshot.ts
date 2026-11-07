// A screenshot of the display under the pointer (or a fixture image in tests).
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { desktopCapturer, nativeImage, screen, type NativeImage } from "electron";

export async function captureDisplay(): Promise<NativeImage> {
  const fake = process.env.AVANZEL_FAKE_SCREEN;
  if (fake) return nativeImage.createFromPath(fake);
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const size = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  };
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: size });
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  return source?.thumbnail ?? nativeImage.createEmpty();
}

/**
 * A part of the screen the person picks: macOS's own crosshair (`screencapture -i`), which also lets them press Space to pick a
 * window. Null when they press Esc, or the picture can't be made. In tests, the fixture image, as `captureDisplay` gives it.
 */
export async function captureRegion(): Promise<NativeImage | null> {
  const fake = process.env.AVANZEL_FAKE_SCREEN;
  if (fake) return nativeImage.createFromPath(fake);
  const dir = mkdtempSync(path.join(tmpdir(), "avanzel-shot-"));
  const file = path.join(dir, "region.png");
  try {
    await new Promise<void>((resolve) => {
      execFile("/usr/sbin/screencapture", ["-i", "-x", "-t", "png", file], () => resolve());
    });
    if (!existsSync(file)) return null; // Esc: nothing was picked
    const image = nativeImage.createFromPath(file);
    return image.isEmpty() ? null : image;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** macOS hands back an empty or all-black picture when Screen Recording is not allowed. */
export function looksBlank(image: NativeImage): boolean {
  if (image.isEmpty()) return true;
  const small = image.resize({ width: 32 });
  const bitmap = small.toBitmap();
  for (let i = 0; i < bitmap.length; i += 4) {
    if ((bitmap[i] ?? 0) > 8 || (bitmap[i + 1] ?? 0) > 8 || (bitmap[i + 2] ?? 0) > 8) return false;
  }
  return true;
}


/** How wide a file's preview is made, in pixels: twice the panel's column, for a sharp picture on a Retina screen. */
const PREVIEW_WIDTH = 960;
const PICTURE = /\.(png|jpe?g|gif|webp|heic|heif|tiff?|bmp)$/i;

/**
 * A preview of `file`, as wide as PREVIEW_WIDTH at most, in its own proportions: a picture itself, scaled down; anything else (a
 * video's frame, a PDF's first page) as macOS's Quick Look draws it (`qlmanage`, which keeps the proportions, as Electron's own
 * thumbnail does not). Null when there is none.
 */
export async function previewOf(file: string): Promise<NativeImage | null> {
  if (PICTURE.test(file)) {
    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) return null;
    return image.getSize().width > PREVIEW_WIDTH ? image.resize({ width: PREVIEW_WIDTH, quality: "good" }) : image;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "avanzel-preview-"));
  try {
    await new Promise<void>((resolve) => {
      execFile("/usr/bin/qlmanage", ["-t", "-s", String(PREVIEW_WIDTH), "-o", dir, file], { timeout: 15_000 }, () => resolve());
    });
    const made = path.join(dir, `${path.basename(file)}.png`);
    if (!existsSync(made)) return null;
    const image = nativeImage.createFromPath(made);
    return image.isEmpty() ? null : image;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
