// The gallery as people see it. Each section is photographed in light and dark; a component that
// looks different fails here until the owner approves the new look. Every text in the gallery is
// also measured against what is really behind it, so a token or a component can't drop below
// WCAG AA without a test noticing.
import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const GALLERY = pathToFileURL(path.join(import.meta.dirname, "..", "gallery", "dist", "index.html")).href;
const SECTIONS = ["colour", "type", "buttons", "controls", "feedback", "zel", "paper", "capsule", "speech", "settings", "letter", "icons", "parts", "panel"];

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(GALLERY);
  await page.evaluate(() => document.fonts.ready);
  // With Reduce Motion every animation runs once and ends at its resting frame; wait for that frame.
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 2000))]));
  expect(errors).toEqual([]);
});

test("the gallery shows every section", async ({ page }) => {
  const shown = await page.$$eval("[data-gallery]", (els) => els.map((e) => (e as HTMLElement).dataset.gallery));
  expect(shown).toEqual(SECTIONS);
});

for (const id of SECTIONS) {
  test(`looks right: ${id}`, async ({ page }) => {
    await expect(page.locator(`[data-gallery="${id}"]`)).toHaveScreenshot(`${id}.png`);
  });
}

test("every text has AA contrast against what is behind it", async ({ page }) => {
  const failures = await page.evaluate(() => {
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    /** Any CSS colour as [r, g, b, a], by letting the canvas paint it. */
    const rgba = (css: string): [number, number, number, number] => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = "#000";
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = probe.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: number[], bottom: number[]) => [0, 1, 2].map((i) => top[i]! * top[3]! + bottom[i]! * (1 - top[3]!));
    const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
    const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
    const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]; return (hi + 0.05) / (lo + 0.05); };

    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || !node.textContent?.trim()) continue;
      const panel = el.closest(".g-panel");
      // Decorative or exempt: outside the specimens, inside drawings (Zel's z's), disabled controls,
      // the stamp's ink, and the live line's deliberate fade.
      if (!panel || el.closest("svg, :disabled, [data-disabled], .av-stamp, .av-capsule-live[data-flow='stream']")) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const chain: Element[] = [];
      for (let e: Element | null = el; e && e !== panel.parentElement; e = e.parentElement) chain.unshift(e);
      let behind = [255, 255, 255];
      let opacity = 1;
      for (const e of chain) {
        const s = getComputedStyle(e);
        behind = over(rgba(s.backgroundColor), behind);
        opacity *= Number(s.opacity);
      }
      if (opacity === 0) continue;
      const [r, g, b, a] = rgba(style.color);
      const ink = over([r, g, b, a * opacity], behind);
      const size = parseFloat(style.fontSize);
      const needed = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
      const got = ratio(ink, behind);
      if (got < needed) found.push(`${panel.getAttribute("data-appearance")}: "${node.textContent.trim().slice(0, 40)}" is ${got.toFixed(2)}:1, needs ${needed}:1`);
    }
    return found;
  });
  expect(failures).toEqual([]);
});
