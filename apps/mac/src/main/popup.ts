// Choose…, in Settings: a native pop-up menu, which macOS draws and a page can't. The page sends the options and a
// point; main checks them (pickRequest), pops the menu up over the window (popupChoice), and sends back the value
// picked. The menu bar's own choices (which call to take notes on) pop up under its icon (trayChoice).
import { Menu, type BrowserWindow, type Tray } from "electron";
import type { PickOption } from "../shared/ipc.ts";

/** The most items a menu is given: more than a person scrolls through, and a bound on what a page can ask for. */
const MAX_OPTIONS = 50;

/** A point in window points, as menu.popup takes it, or null for anything else: the menu then opens at the pointer. */
function pickPoint(at: unknown): { x: number; y: number } | null {
  if (typeof at !== "object" || at === null) return null;
  const { x, y } = at as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  // menu.popup takes whole numbers, and none above the window's left or top edge.
  return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
}

/**
 * The page's request, checked: each option an object with a non-empty string label and a string value (checked:
 * `=== true`), the first 50 at most; `at` with finite numbers, rounded and at least 0, else null. Null with no option.
 */
export function pickRequest(options: unknown, at: unknown): { options: PickOption[]; at: { x: number; y: number } | null } | null {
  if (!Array.isArray(options)) return null;
  const kept = options
    .flatMap((option: unknown): PickOption[] => {
      if (typeof option !== "object" || option === null) return [];
      const { label, value, checked } = option as Record<string, unknown>;
      return typeof label === "string" && label !== "" && typeof value === "string" ? [{ label, value, checked: checked === true }] : [];
    })
    .slice(0, MAX_OPTIONS);
  return kept.length > 0 ? { options: kept, at: pickPoint(at) } : null;
}

/**
 * A native menu of `options` pops up over `win`, at `at` (window points; null: at the pointer). Resolves with the value
 * of the item picked, or null when the menu closes without one.
 *
 * On macOS a picked item's click runs first, and the close callback follows it (`menuDidClose:` in Electron's
 * electron_menu_controller.mm), so the callback's null changes nothing once a value has resolved.
 */
export function popupChoice(win: BrowserWindow, options: readonly PickOption[], at: { x: number; y: number } | null): Promise<string | null> {
  return new Promise((resolve) => {
    const menu = Menu.buildFromTemplate(
      options.map((option) => ({ label: option.label, type: "checkbox", checked: option.checked, click: () => resolve(option.value) })),
    );
    menu.popup({ window: win, ...(at ?? {}), callback: () => resolve(null) });
  });
}

/**
 * A native menu of `labels` pops up under the menu bar icon, as the icon's own menu does; `onPick` gets the index of the item chosen.
 * Nothing when the menu closes without one.
 */
export function trayChoice(tray: Tray, labels: readonly string[], onPick: (index: number) => void): void {
  tray.popUpContextMenu(Menu.buildFromTemplate(labels.map((label, index) => ({ label, click: () => onPick(index) }))));
}
