// The menu bar icon (Zel's face, its title beside it, and its tooltip in words), whose click brings up the panel, and where the icon is
// on screen.
import type { MenuBarState } from "@avanzel/ui/menu-bar";
import { Tray, nativeImage, nativeTheme, type NativeImage, type Rectangle } from "electron";
import { colorBadge, encodePng, faceIcon, type Bitmap } from "./png.ts";
import { trayTooltip, type TrayView } from "./tray-state.ts";

function image(make: (scale: 1 | 2) => Bitmap, template: boolean): NativeImage {
  const img = nativeImage.createEmpty();
  for (const scale of [1, 2] as const) {
    const { width, height, rgba } = make(scale);
    img.addRepresentation({ scaleFactor: scale, buffer: encodePng(width, height, rgba) });
  }
  if (template) img.setTemplateImage(true);
  return img;
}

export class MenuBar {
  readonly tray: Tray;
  /** One image for each face, made the first time it shows: a template image, so macOS tints it for the menu bar and its appearance. */
  private readonly faces = new Map<string, NativeImage>();
  /** How many thoughts are being filed, as the badge on the face counts them (`show`). */
  private badge = 0;
  private current: TrayView = { face: "idle", title: "" };
  /** The words last given to `Tray.setToolTip`, which has no getter. */
  private words = trayTooltip("idle");

  /**
   * `onClick`: the icon was clicked, which brings up the panel; a right click or a Control-click does the same, for Avanzel draws its own
   * panel and no menu macOS draws.
   */
  constructor(onClick: () => void) {
    this.tray = new Tray(this.faceImage("idle"));
    this.tray.setToolTip(this.words);
    // Optional: a stand-in for Electron (the tests') may have no events.
    if (typeof nativeTheme.on === "function") nativeTheme.on("updated", () => this.repaint());
    if (typeof this.tray.on === "function") {
      this.tray.on("click", () => onClick());
      this.tray.on("right-click", () => onClick());
    }
  }

  /** What the icon and its title show now (`show`). */
  get shown(): TrayView {
    return this.current;
  }

  /** The words the icon's tooltip holds now: the face's own (`trayTooltip`). Electron's Tray can't be asked for them, so the e2e tests read them here. */
  get tooltip(): string {
    return this.words;
  }

  private faceImage(state: MenuBarState, badge = 0): NativeImage {
    // A problem's face has its own mark where the badge would go: it shows alone. Ten and more read as one badge, "+".
    const count = state === "needs-you" ? 0 : Math.min(badge, 10);
    // With a count, the badge is red and the icon in colour, so it is drawn for the menu bar's appearance (`colorBadge`); else a template.
    const dark = count > 0 && nativeTheme.shouldUseDarkColors;
    const key = `${state}:${count}:${dark}`;
    let face = this.faces.get(key);
    if (!face) {
      face = count > 0
        ? image((scale) => colorBadge(faceIcon(state, scale), count, scale, dark), false)
        : image((scale) => faceIcon(state, scale), true);
      this.faces.set(key, face);
    }
    return face;
  }

  /** The appearance changed: a coloured icon (one with a badge) is drawn again in the new ink. */
  private repaint(): void {
    if (this.tray.isDestroyed() || this.badge === 0) return;
    this.tray.setImage(this.faceImage(this.current.face, this.badge));
  }

  /**
   * Shows `view`: Zel's face as the icon with its words as the tooltip, and beside it the title, in digits of one width so that a count
   * doesn't shake as it goes. Each is set only when it changes (the face and the tooltip together), so this may run as often as the count
   * needs it. Nothing once the tray is destroyed.
   */
  show(view: TrayView, badge = 0): void {
    if (this.tray.isDestroyed()) return;
    if (view.face !== this.current.face || badge !== this.badge) {
      this.tray.setImage(this.faceImage(view.face, badge));
      this.badge = badge;
    }
    if (view.face !== this.current.face) {
      this.words = trayTooltip(view.face);
      this.tray.setToolTip(this.words);
    }
    if (view.title !== this.current.title) this.tray.setTitle(view.title, { fontType: "monospacedDigit" });
    this.current = { face: view.face, title: view.title };
  }

  /**
   * Where the icon is on screen, in points; with no width or height while macOS isn't showing it, as people can hide
   * it. With AVANZEL_TEST=1, AVANZEL_FAKE_TRAY_BOUNDS ("x,y,width,height") stands in for it, so the flight at the end
   * of setup and the bubble under the icon don't depend on this Mac's own menu bar.
   */
  bounds(): Rectangle {
    const fake = process.env.AVANZEL_TEST === "1" ? process.env.AVANZEL_FAKE_TRAY_BOUNDS : undefined;
    if (!fake) return this.tray.getBounds();
    const [x = 0, y = 0, width = 0, height = 0] = fake.split(",").map(Number);
    return { x, y, width, height };
  }
}
