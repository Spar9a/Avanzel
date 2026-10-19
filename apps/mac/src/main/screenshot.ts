// A screenshot of the display under the pointer (or a fixture image in tests).
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
