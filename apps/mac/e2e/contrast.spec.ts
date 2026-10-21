// Every window and capsule state, light and dark: each text the owner reads has WCAG AA contrast
// against what is really behind it (labels on fills: see ON_FILL). Colours come from the pages'
// computed styles, not from pixels.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CapsuleState } from "../src/shared/ipc.ts";
import { call, launch, makeLibrary, screenshotFixture, windowFor } from "./helpers.ts";

type Appearance = "light" | "dark";
type RGB = [number, number, number];
type RGBA = [number, number, number, number];

/** A text as the page draws it, with every element from the root down to it. */
interface Sample {
  selector: string;
  text: string;
  color: string;
  fontSize: number;
  fontWeight: number;
  /** An ON_FILL label that is white on the page's own accent or danger fill. */
  onFill: boolean;
  layers: { background: string; opacity: number }[];
}

/** What shows through a transparent page root, in each appearance. */
type Bases = (mode: Appearance, page: Page) => Promise<string[]>;

const APPEARANCES: Appearance[] = ["light", "dark"];
// Primary buttons, the selected sidebar row and the error badge: white on --accent or --danger, as
// macOS draws them, at 3.4–4.0:1. The fills stay as they are; their labels are held to 3:1 while
// they are white on exactly that fill, and to 4.5:1 otherwise.
const ON_FILL = ".btn.primary, .ni.on, .warn";
// The Settings sidebar's vibrancy, measured from screenshots of the real window.
const sidebar: Bases = async (mode) => [mode === "light" ? "#e1e1e4" : "#464649"];
// The capsule floats over any desktop: the lightest and the darkest.
const desktops: Bases = async () => ["#ffffff", "#000000"];
const windowColour: Bases = async (_mode, page) => [await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--window").trim())];

function rgba(css: string): RGBA {
  const hex = /^#([\da-f]{6})$/i.exec(css);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\)$/.exec(css);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] ? Number(rgb[4]) : 1];
  const srgb = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)$/.exec(css); // what color-mix() computes to
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, srgb[4] ? Number(srgb[4]) : 1];
  throw new Error(`Can't read the colour "${css}"`);
}

/** `top`, with its alpha, laid over the opaque `bottom`. */
const over = (top: RGBA, bottom: RGB): RGB => [0, 1, 2].map((i) => top[i]! * top[3] + bottom[i]! * (1 - top[3])) as RGB;
const linear = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: RGB) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const hex = (c: RGB) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The texts below AA over `base`: 4.5:1, or 3:1 from 24 px, from 18.66 px when bold, and on a fill. */
function failures(samples: Sample[], base: string, where: string): string[] {
  const found: string[] = [];
  for (const t of samples) {
    let background = rgba(base).slice(0, 3) as RGB;
    let opacity = 1;
    for (const layer of t.layers) {
      background = over(rgba(layer.background), background);
      opacity *= layer.opacity;
    }
    const [r, g, b, a] = rgba(t.color);
    const color = over([r, g, b, a * opacity], background);
    const needed = t.fontSize >= 24 || (t.fontSize >= 18.66 && t.fontWeight >= 700) || t.onFill ? 3 : 4.5;
    const ratio = contrast(color, background);
    if (ratio < needed) found.push(`${where}: ${t.selector} "${t.text}" ${hex(color)} on ${hex(background)} is ${ratio.toFixed(2)}:1, needs ${needed}:1`);
  }
  return found;
}

/** Every visible text on the page: elements' own text, inputs' values or placeholders, selects' choices. Disabled controls are exempt. */
async function texts(page: Page): Promise<Sample[]> {
  // The capsule's appear animation and the close button's fade end first; spinners never do.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
  return page.evaluate((onFill) => {
    const name = (el: Element) => el.tagName.toLowerCase() + [...el.classList].map((c) => `.${c}`).join("");
    // This page's accent and danger fills, resolved through a probe element (a page without one leaves it transparent).
    const fills = ["--accent", "--danger"].map((variable) => {
      const probe = document.body.appendChild(document.createElement("i"));
      probe.style.backgroundColor = `var(${variable})`;
      const fill = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return fill;
    }).filter((fill) => fill !== "rgba(0, 0, 0, 0)");
    const found: Sample[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (el.matches("option, optgroup, script, style") || el.closest(":disabled")) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      let text: string;
      let pseudo: string | null = null;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (el instanceof HTMLInputElement && el.type !== "text") continue;
        text = el.value || el.placeholder;
        if (!el.value) pseudo = "::placeholder";
      } else if (el instanceof HTMLSelectElement) {
        text = el.selectedOptions[0]?.label ?? "";
      } else {
        text = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("");
      }
      if (!text.trim()) continue;
      const chain: Element[] = [];
      for (let up: Element | null = el; up; up = up.parentElement) chain.unshift(up);
      const own = getComputedStyle(el);
      const style = pseudo ? getComputedStyle(el, pseudo) : own;
      found.push({
        selector: chain.slice(-3).map(name).join(" > "),
        text: text.trim().slice(0, 50),
        color: style.color,
        fontSize: parseFloat(style.fontSize),
        fontWeight: Number(style.fontWeight),
        onFill: el.matches(onFill) && own.color === "rgb(255, 255, 255)" && fills.includes(own.backgroundColor),
        layers: chain.map((up) => ({ background: getComputedStyle(up).backgroundColor, opacity: Number(getComputedStyle(up).opacity) })),
      });
    }
    return found;
  }, ON_FILL);
}

/** `page` in light and in dark: the native appearance, and the page's colour scheme, which Playwright otherwise holds at light. */
async function readable(app: ElectronApplication, page: Page, surface: string, bases: Bases): Promise<string[]> {
  const found: string[] = [];
  for (const mode of APPEARANCES) {
    await app.evaluate(({ nativeTheme }, source) => {
      nativeTheme.themeSource = source;
    }, mode);
    await page.emulateMedia({ colorScheme: mode });
    const all = await texts(page);
    expect(all.length, `texts found on ${surface}`).toBeGreaterThan(0);
    const under = await bases(mode, page);
    for (const base of under) found.push(...failures(all, base, `${mode} ${surface}${under.length > 1 ? ` over ${base}` : ""}`));
  }
  return found;
}

function capsuleStates(): [string, CapsuleState, string][] {
  const thumbnail = `data:image/png;base64,${readFileSync(screenshotFixture()).toString("base64")}`;
  const said = "I want to launch my podcast about indie game development before the end of the year, and ask Mark to co-host.";
  const pages = [
    { title: "Run a marathon in spring", shelf: "goals", path: "goals/run-a-marathon.md" },
    { title: "Mark Ellison", shelf: "people", path: "people/mark-ellison.md" },
    { title: "Indie game dev podcast", shelf: "ideas", path: "ideas/podcast.md" },
  ];
  const context = { app: "Safari", title: "Shure MV7+ Podcast Microphone", url: "https://www.shure.com/mv7" };
  return [
    ["listening", { kind: "listening", mode: "dictate", startedAt: Date.now(), fakeMic: true, microphoneId: null }, "Auto"],
    ["transcribing", { kind: "transcribing", mode: "dictate" }, "Transcribing on this Mac…"],
    ["filing", { kind: "filing", text: said, agent: "Claude Code", transcribedIn: 1.4, canEdit: true }, "Filing with Claude Code…"],
    [
      "filing, waiting",
      { kind: "filing", text: said, agent: "Claude Code", transcribedIn: 1.4, canEdit: true, waiting: true },
      "Waiting for another Avanzel run to finish…",
    ],
    ["editing", { kind: "editing", text: said }, "Edit before filing"],
    ["filed", { kind: "filed", agent: "Claude Code", seconds: 23, pages, canUndo: true, message: "Filed." }, "Filed by Claude Code"],
    ["saved", { kind: "saved", text: "This mic looks right for the podcast", thumbnail, context, note: "Saved to your inbox for tonight's review" }, "Saved to your inbox"],
    ["error", { kind: "error", message: "Claude Code couldn't file this note", detail: "Error: rate limited\nThe note is still in your inbox; the evening review will try again.", action: "open-settings:agents" }, "Claude Code couldn't file this note"],
    ["preparing", { kind: "preparing", receivedBytes: 412_000_000, totalBytes: 672_807_563 }, "The speech model is still downloading"],
    ["model-failed", { kind: "model-failed" }, "The speech model didn't finish downloading."],
    [
      "shortcut-taken",
      { kind: "shortcut-taken", key: "dictate", accelerator: "Alt+Space", holder: "Alfred", alternatives: ["Control+Shift+Space", "Control+Alt+R"] },
      "⌥Space is used by another app, probably Alfred.",
    ],
    [
      "shortcut-taken, none free",
      { kind: "shortcut-taken", key: "dictate", accelerator: "Alt+Space", holder: null, alternatives: [] },
      "⌥Space is used by another app.",
    ],
    ["shortcut-picked", { kind: "shortcut-picked", key: "dictate", accelerator: "Control+Shift+Space" }, "Record a thought now uses ⌃⇧Space"],
  ];
}

test("every Settings pane, Quick, Ask and capsule state is readable in light and dark", async () => {
  test.setTimeout(240_000);
  const library = await makeLibrary();
  writeFileSync(path.join(library, "tasks", "broken.md"), "---\nschedule: sometimes\n---\nDo things.\n"); // Shadow tasks shows its problem in red
  const app = await launch({ AVANZEL_LIBRARY: library });
  const found: string[] = [];

  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  for (const pane of ["General", "Voice", "Agents", "Shadow tasks", "Tools & MCP", "Privacy"]) {
    await settings.getByRole("button", { name: pane, exact: true }).click();
    await expect(settings.getByRole("heading", { name: pane })).toBeVisible();
    if (pane === "Shadow tasks") await expect(settings.getByText(/Unknown schedule "sometimes"/)).toBeVisible();
    // launch()'s stand-ins for Claude Code and Codex read their sign-in as the pane opens: read the pane once both
    // are done, not while a Check button spins.
    if (pane === "Agents") {
      for (const name of ["Claude Code", "Codex"]) {
        await expect(settings.getByRole("group", { name }).getByRole("status")).toHaveText("Signed in", { timeout: 40_000 });
      }
    }
    found.push(...(await readable(app, settings, `Settings › ${pane}`, sidebar)));
  }

  await call(app, "openQuick");
  const quick = await windowFor(app, "quick");
  found.push(...(await readable(app, quick, "Quick, empty", windowColour)));
  await quick.getByRole("textbox", { name: "Type a thought" }).fill("Plant tulips in October");
  found.push(...(await readable(app, quick, "Quick, typed", windowColour)));
  await call(app, "closeQuick");

  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await expect(ask.getByText(/^Answers come from your library only/)).toBeVisible();
  found.push(...(await readable(app, ask, "Ask, empty", windowColour)));
  // The fake agent repeats the question, so the answer links to a page.
  await ask.getByRole("textbox", { name: "Ask your library" }).fill("What are my goals besides [[Run a marathon]]?");
  await ask.getByRole("textbox", { name: "Ask your library" }).press("Enter");
  await expect(ask.getByRole("link", { name: "Run a marathon" })).toBeVisible({ timeout: 60_000 });
  found.push(...(await readable(app, ask, "Ask, answered", windowColour)));

  const capsule = await windowFor(app, "capsule");
  for (const [name, state, shows] of capsuleStates()) {
    await call(app, "setCapsule", state);
    await expect(capsule.getByText(shows)).toBeVisible();
    await capsule.locator(".hud, .av-hud").first().hover(); // the close button shows on hover
    found.push(...(await readable(app, capsule, `capsule ${name}`, desktops)));
  }
  await app.close();
  expect(found).toEqual([]);
});

test("the welcome screen is readable in light and dark", async () => {
  const app = await launch({});
  const welcome = await windowFor(app, "settings");
  await expect(welcome.getByRole("heading", { name: "Welcome to Avanzel" })).toBeVisible();
  const found = await readable(app, welcome, "Settings › Welcome", sidebar);
  await app.close();
  expect(found).toEqual([]);
});
