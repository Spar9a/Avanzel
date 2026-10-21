// The menu bar icon and its menu, rebuilt from MenuInput whenever something changes, and where the icon is on screen.
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage, type Rectangle } from "electron";
import { buildMenuModel, menuLabel, type MenuInput } from "./menu-model.ts";
import { dotIcon, encodePng, trayIcon } from "./png.ts";

const SHELF_COLORS: Record<string, string> = {
  goals: "#34c759", ideas: "#ffcc00", problems: "#ff3b30", memories: "#af52de", people: "#007aff", topics: "#8e8e93",
};

function image(make: (scale: 1 | 2) => { width: number; height: number; rgba: Uint8Array }, template: boolean): NativeImage {
  const img = nativeImage.createEmpty();
  for (const scale of [1, 2] as const) {
    const { width, height, rgba } = make(scale);
    img.addRepresentation({ scaleFactor: scale, buffer: encodePng(width, height, rgba) });
  }
  if (template) img.setTemplateImage(true);
  return img;
}

const dots = new Map<string, NativeImage>();
function dot(shelf: string): NativeImage {
  const color = SHELF_COLORS[shelf] ?? "#8e8e93";
  if (!dots.has(color)) dots.set(color, image((scale) => dotIcon(color, scale), false));
  return dots.get(color)!;
}

export class MenuBar {
  readonly tray: Tray;

  constructor(private readonly onAction: (action: string) => void) {
    this.tray = new Tray(image(trayIcon, true));
    this.tray.setToolTip("Avanzel");
  }

  update(input: MenuInput, now = new Date()): void {
    const template: MenuItemConstructorOptions[] = buildMenuModel(input, now).map((item) => {
      if (item.type === "separator") return { type: "separator" };
      if (item.type === "header") return { type: "header", label: item.label }; // a macOS 14+ section header
      return {
        label: menuLabel(item),
        sublabel: item.sublabel,
        accelerator: item.accelerator,
        registerAccelerator: false,
        enabled: item.enabled ?? true,
        icon: item.shelf ? dot(item.shelf) : undefined,
        click: () => this.onAction(item.action),
      };
    });
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
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
