// Every window and capsule state, light and dark: each text the owner reads has WCAG AA contrast
// against what is really behind it. Colours come from the pages' computed styles, not from pixels.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CapsuleState } from "../src/shared/ipc.ts";
import { call, filesUnder, filingClaude, firstRun, launch, makeLibrary, screenshotFixture, windowFor } from "./helpers.ts";

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
  layers: { background: string; opacity: number }[];
}

/** What shows through a transparent page root, in each appearance. */
type Bases = (mode: Appearance, page: Page) => Promise<string[]>;

const APPEARANCES: Appearance[] = ["light", "dark"];
// The capsule floats over any desktop: the lightest and the darkest.
const desktops: Bases = async () => ["#ffffff", "#000000"];
// Quick's page is clear, over the popover material macOS draws, which the page can't read: it is read over the window
// surface, the tone that material keeps.
const surface: Bases = async (_mode, page) => [
  await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement("i"));
    probe.style.backgroundColor = "var(--av-surface-window)";
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }),
];

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

/** The texts below AA over `base`: 4.5:1, or 3:1 from 24 px, and from 18.66 px when bold. */
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
    const needed = t.fontSize >= 24 || (t.fontSize >= 18.66 && t.fontWeight >= 700) ? 3 : 4.5;
    const ratio = contrast(color, background);
    if (ratio < needed) found.push(`${where}: ${t.selector} "${t.text}" ${hex(color)} on ${hex(background)} is ${ratio.toFixed(2)}:1, needs ${needed}:1`);
  }
  return found;
}

/** Every visible text on the page: elements' own text, inputs' values or placeholders, selects' choices. Disabled controls are exempt. */
async function texts(page: Page): Promise<Sample[]> {
  // The animations that end (a card landing, a stamp) end first; spinners never do.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
  return page.evaluate(() => {
    const name = (el: Element) => el.tagName.toLowerCase() + [...el.classList].map((c) => `.${c}`).join("");
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
        layers: chain.map((up) => ({ background: getComputedStyle(up).backgroundColor, opacity: Number(getComputedStyle(up).opacity) })),
      });
    }
    return found;
  });
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
  // A page the filing changed, a page it made, and a page it made in a folder that is no shelf, whose row names the folder; and a
  // fourth, which the card only counts.
  const pages = [
    { title: "Run a marathon in spring", shelf: "goals", path: "goals/run-a-marathon.md", created: false },
    { title: "Mark Ellison", shelf: "people", path: "people/mark-ellison.md", created: true },
    { title: "Garden plan", shelf: "projects", path: "projects/garden.md", created: true },
  ];
  const fourth = { title: "Indie game dev podcast", shelf: "ideas", path: "ideas/podcast.md", created: true };
  const context = { app: "Safari", title: "Shure MV7+ Podcast Microphone", url: "https://www.shure.com/mv7" };
  return [
    // The hint's card above the bar, and the bar's one button: this capture's file mode, worded from the evening review.
    [
      "listening",
      { kind: "listening", mode: "dictate", startedAt: Date.now(), fakeMic: true, microphoneId: null, fileMode: "now", hint: "Alt+Space", review: "at 21:00" },
      "Files now",
    ],
    [
      "listening, filing at the review",
      { kind: "listening", mode: "dictate", startedAt: Date.now(), fakeMic: true, microphoneId: null, fileMode: "evening", hint: null, review: "at 21:00" },
      "Files at 21:00",
    ],
    // The longest label: a weekly review's day and time.
    [
      "listening, filing at a weekly review",
      { kind: "listening", mode: "dictate", startedAt: Date.now(), fakeMic: true, microphoneId: null, fileMode: "evening", hint: null, review: "on Sundays at 18:00" },
      "Files on Sundays at 18:00",
    ],
    // With the review off nothing files the capture, so the button says where it stays.
    [
      "listening, review off",
      { kind: "listening", mode: "dictate", startedAt: Date.now(), fakeMic: true, microphoneId: null, fileMode: "evening", hint: null, review: null },
      "Stays in your inbox",
    ],
    // A screen comment: the screenshot on a card labelled with the app, the key that finishes it, and no file mode to switch.
    [
      "listening, a screen comment",
      { kind: "listening", mode: "comment", startedAt: Date.now(), fakeMic: true, microphoneId: null, thumbnail, context, fileMode: null, hint: "Alt+Shift+S", review: "at 21:00" },
      "Safari",
    ],
    ["transcribing", { kind: "transcribing", mode: "dictate", onThisMac: true }, "Transcribing on this Mac…"],
    ["transcribing, slow", { kind: "transcribing", mode: "dictate", onThisMac: true, slow: true }, "Still transcribing…"],
    [
      "filing",
      {
        kind: "filing",
        text: said,
        agent: "Claude Code",
        transcribedIn: 1.4,
        onThisMac: true,
        canEdit: true,
        rows: [],
        startedAt: Date.now(),
        estimate: 15,
        stepAt: Date.now(),
      },
      "Filing with Claude Code…",
    ],
    // Mid-run: the newest step as the card's line, the seconds past the estimate, a note under the origin, and Stop under way.
    [
      "filing, stepping",
      {
        kind: "filing",
        text: said,
        agent: "Claude Code",
        transcribedIn: null,
        onThisMac: true,
        canEdit: false,
        detail: "Only your words were kept: the recording couldn't be saved.",
        rows: [
          { kind: "read", path: "index.md", title: "index", shelf: "" },
          { kind: "new", path: "ideas/podcast.md", title: "Indie game dev podcast", shelf: "ideas" },
        ],
        startedAt: Date.now() - 18_000,
        estimate: 15,
        stepAt: Date.now(),
        cancelling: true,
      },
      "New idea page: Indie game dev podcast",
    ],
    [
      "filing, still working",
      {
        kind: "filing",
        text: said,
        agent: "Claude Code",
        transcribedIn: 1.4,
        onThisMac: true,
        canEdit: true,
        rows: [],
        startedAt: Date.now() - 9_000,
        estimate: 15,
        stepAt: Date.now() - 9_000,
      },
      "Claude Code is still working…",
    ],
    [
      "filing, waiting",
      {
        kind: "filing",
        text: said,
        agent: "Claude Code",
        transcribedIn: 1.4,
        onThisMac: true,
        canEdit: true,
        waiting: true,
        rows: [],
        startedAt: Date.now(),
        estimate: 15,
        stepAt: Date.now(),
      },
      "Waiting for another Avanzel run to finish…",
    ],
    ["editing", { kind: "editing", text: said }, "Edit before filing"],
    // The results: the words on paper, stamped, over a bar of one steady line.
    ["filed", { kind: "filed", text: said, agent: "Claude Code", seconds: 23, pages, canUndo: true, noted: false }, "Filed by Claude Code in 23 s"],
    [
      "filed, four pages",
      { kind: "filed", text: said, agent: "Claude Code", seconds: 8, pages: [...pages, fourth], canUndo: false, noted: false },
      "and 1 more",
    ],
    [
      "filed, nothing new",
      { kind: "filed", text: said, agent: "Claude Code", seconds: 4, pages: [], canUndo: true, noted: true },
      "Nothing new to file",
    ],
    [
      "saved, a dictation",
      { kind: "saved", text: "Call the plumber on Monday", note: "Saved to your inbox for the evening review at 21:00.", detail: "Only your words were kept: the recording couldn't be saved." },
      "Saved to your inbox for the evening review at 21:00.",
    ],
    [
      "saved, a screen comment",
      {
        kind: "saved",
        text: "This mic looks right for the podcast",
        thumbnail,
        context,
        note: "Saved to your inbox for the evening review at 21:00.",
        detail: "Only your words were kept: the recording couldn't be saved.",
      },
      "Safari",
    ],
    ["saved, a screen comment with no words", { kind: "saved", text: "", thumbnail, context, note: "Saved to your inbox." }, "No comment"],
    ["undone", { kind: "saved", text: said, note: "Undone. Your words are back in the inbox for the evening review at 21:00.", undone: true }, "Undone. Your words are back in the inbox for the evening review at 21:00."],
    [
      "stopped, a filing",
      { kind: "cancelled", text: said, agent: "Claude Code", partial: false, leftovers: 0, review: "at 21:00" },
      "Your words are back in the inbox, untouched, and nothing else changed.",
    ],
    [
      "stopped, a filing whose edits stayed",
      { kind: "cancelled", text: said, agent: "Claude Code", partial: true, leftovers: 0, review: "on Sundays at 18:00" },
      "Claude Code's partial edits are kept as their own commit",
    ],
    [
      "stopped, a filing with the review off",
      { kind: "cancelled", text: said, agent: "Claude Code", partial: false, leftovers: 2, review: null },
      "The agent's partial edits stay as they are",
    ],
    ["stopped, a transcription", { kind: "recorded", review: "at 21:00" }, "The evening review turns it into words and files it at 21:00."],
    ["stopped, a transcription with the review off", { kind: "recorded", review: null }, "It's in your inbox."],
    // A problem is a notice: what happened, what is safe, Hide and the one fix. The fix's primary label, a command in the code face,
    // a notice with no fix, and the most one says (a title of two lines, and a body of several) are each read in both appearances.
    [
      "error",
      {
        kind: "error",
        message: "Claude Code has hit its usage limit.",
        detail: "It resets tomorrow at 09:00. Your note is safe in the inbox and will be filed then.",
        action: "refile:codex",
        actionLabel: "File it with Codex now",
      },
      "Claude Code has hit its usage limit.",
    ],
    [
      "error, a command",
      {
        kind: "error",
        message: "Claude Code isn't signed in on this Mac.",
        detail: "Run claude once in Terminal and sign in, and your note will be filed straight away.",
        command: "claude",
        action: "open-terminal",
        actionLabel: "Open Terminal",
      },
      "Claude Code isn't signed in on this Mac.",
    ],
    [
      "error, no fix",
      { kind: "error", message: "This one can't be undone automatically.", detail: "Usually a later change touched the same lines. The library's history keeps both versions." },
      "This one can't be undone automatically.",
    ],
    [
      "error, the most it says",
      {
        kind: "error",
        message: "Avanzel can't use the voice settings in this library's config file.",
        detail:
          "/Users/ana/Documents/Notes/Avanzel/.avanzel/config.toml: invalid TOML at line 2, column 17: incomplete key-value declaration, expected a value. " +
          "Typed thoughts are still saved to your inbox.\nYour words are kept in raw/audio/2026/10/2026-10-27-101500.wav.",
        action: "open-settings:voice",
        actionLabel: "Open Settings",
      },
      "Avanzel can't use the voice settings in this library's config file.",
    ],
    // A thought that couldn't be saved: its one fix opens Type a thought, where the words wait.
    [
      "error, a thought",
      {
        kind: "error",
        message: "That thought couldn't be saved.",
        detail: "EACCES: permission denied… Your words are still in “Type a thought”.",
        action: "type-a-thought",
        actionLabel: "Type a thought",
      },
      "That thought couldn't be saved.",
    ],
    ["preparing", { kind: "preparing", receivedBytes: 412_000_000, totalBytes: 672_807_563 }, "The speech model is still downloading"],
    [
      "model-failed",
      { kind: "model-failed", reason: "Could not download silero_vad.onnx: terminated (other side closed)", resumable: true },
      "The speech model didn't finish downloading.",
    ],
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
  writeFileSync(path.join(library, "tasks", "broken.md"), "---\nschedule: sometimes\n---\nDo things.\n"); // Reviews lists it, with why
  writeFileSync(path.join(library, "goals", "run-a-marathon.md"), "# Run a marathon\n"); // the page Ask's answer links
  const app = await launch({ AVANZEL_LIBRARY: library });
  const found: string[] = [];

  // The window is opaque: its page draws the window's own surface, so what lies under it doesn't show through.
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  for (const pane of ["General", "Voice", "Agents", "Reviews", "Privacy"]) {
    await settings.getByRole("radio", { name: pane, exact: true }).click();
    await expect(settings.getByRole("heading", { name: pane, exact: true })).toBeVisible();
    if (pane === "Reviews") await expect(settings.getByText(/Unknown schedule "sometimes"/)).toBeVisible();
    // launch()'s stand-ins for Claude Code and Codex read their sign-in as the pane opens: read the pane once both
    // are done, not while a Check button spins.
    if (pane === "Agents") {
      for (const name of ["Claude Code", "Codex"]) {
        await expect(settings.getByRole("group", { name }).getByText("Signed in", { exact: true })).toBeVisible({ timeout: 40_000 });
      }
    }
    found.push(...(await readable(app, settings, `Settings › ${pane}`, desktops)));
    // A review's editor, open in its group: its rows, its instructions and its Save.
    if (pane === "Reviews") {
      await settings.getByRole("group", { name: "Weekly review", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
      await expect(settings.getByRole("textbox", { name: "Instructions" })).toBeVisible();
      found.push(...(await readable(app, settings, "Settings › Reviews, editing", desktops)));
    }
  }

  await call(app, "openQuick");
  const quick = await windowFor(app, "quick");
  found.push(...(await readable(app, quick, "Quick, empty", surface)));
  await quick.getByRole("textbox", { name: "Type a thought" }).fill("Plant tulips in October");
  found.push(...(await readable(app, quick, "Quick, typed", surface)));
  await call(app, "closeQuick");

  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await expect(ask.getByText(/^Answers come from your library only/)).toBeVisible();
  found.push(...(await readable(app, ask, "Ask, empty", desktops)));
  // The fake agent repeats the question, so the answer links to a page: its shelf and its button are read too.
  await ask.getByRole("textbox", { name: "Ask your library" }).fill("What are my goals besides [[run-a-marathon]]?");
  await ask.getByRole("textbox", { name: "Ask your library" }).press("Enter");
  await expect(ask.getByRole("button", { name: "Run a marathon" })).toBeVisible({ timeout: 60_000 });
  found.push(...(await readable(app, ask, "Ask, answered", desktops)));

  const capsule = await windowFor(app, "capsule");
  for (const [name, state, shows] of capsuleStates()) {
    await call(app, "setCapsule", state);
    await expect(capsule.getByText(shows)).toBeVisible();
    // Every piece the page draws takes the pointer. The page's wrapper and the stack take none (the transparent corners pass it to the
    // apps below), so a state whose root were a bare piece, and not a notice or a stack, could not be hovered, and would be put away
    // under the pointer: each state's pieces are the stack's children, or the notice itself.
    const pieces = await capsule.evaluate(() =>
      [...document.querySelectorAll(".app > *")]
        .flatMap((root) => (root.matches(".stack") ? [...root.children] : [root]))
        .map((piece) => ({ piece: piece.className || piece.tagName.toLowerCase(), pointerEvents: getComputedStyle(piece).pointerEvents })),
    );
    expect(pieces.length, `capsule ${name}: pieces`).toBeGreaterThan(0);
    for (const { piece, pointerEvents } of pieces) expect(pointerEvents, `capsule ${name}: ${piece}`).toBe("auto");
    found.push(...(await readable(app, capsule, `capsule ${name}`, desktops)));
  }
  await app.close();
  expect(found).toEqual([]);
});

test("Settings without a library is readable in light and dark", async () => {
  const app = await launch(firstRun().env); // without a library, setup opens by itself
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  await expect(settings.getByText("Avanzel has no library open.", { exact: true })).toBeVisible();
  const found = await readable(app, settings, "Settings › General, no library", desktops);
  await app.close();
  expect(found).toEqual([]);
});

test("every setup step and the bubble are readable in light and dark", async () => {
  test.setTimeout(240_000);
  const { env, home } = firstRun({ claude: filingClaude() });
  // Another app holds ⌥Space, so Think shows its Notice. The menu bar icon has a place, so the bubble opens under it.
  const app = await launch({ ...env, AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space", AVANZEL_FAKE_TRAY_BOUNDS: "1000,0,24,24" });
  const found: string[] = [];

  // Hello, once Zel is awake and the stamp has landed.
  const setup = await windowFor(app, "setup");
  await expect(setup.getByRole("img", { name: /^Hello, / })).toBeVisible({ timeout: 15_000 });
  // The HELLO stamp is in the Card's own stamp slot, as Filing's FILED is: readable() walks its DOM ancestors, so it is
  // read over the card's paper.
  found.push(...(await readable(app, setup, "Setup › Hello", desktops)));

  // Found, once both agents' sign-in is read and Claude Code is chosen. The speech model can't download here, so the
  // footer says so.
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(2, { timeout: 20_000 });
  await expect(setup.getByRole("img", { name: "Chosen" })).toBeVisible();
  await expect(setup.getByText("The speech model didn't finish downloading.")).toBeVisible();
  found.push(...(await readable(app, setup, "Setup › Found", desktops)));

  // Think, with the Notice for the shortcut another app holds; then its box for typing, empty and with words in it.
  await setup.getByRole("button", { name: "Looks good" }).click();
  await expect(setup.getByRole("heading", { name: "What's on your mind this week?" })).toBeVisible({ timeout: 20_000 });
  await expect(setup.getByRole("alert").getByText(/^⌥Space is used by another app/)).toBeVisible();
  found.push(...(await readable(app, setup, "Setup › Think, shortcut taken", desktops)));
  await setup.getByRole("button", { name: "Type it instead" }).click();
  const box = setup.getByRole("textbox", { name: "Your thought" });
  await expect(box).toBeFocused();
  found.push(...(await readable(app, setup, "Setup › Think, typing", desktops)));
  await box.fill("Plant tulips in October");
  found.push(...(await readable(app, setup, "Setup › Think, typed", desktops)));

  // Filing, once filed: the card stamped, the page the filing wrote, and Undo.
  await setup.getByRole("button", { name: "File it", exact: true }).click();
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByRole("img", { name: /^Filed, / })).toBeVisible();
  found.push(...(await readable(app, setup, "Setup › Filing, filed", desktops)));

  // Ask, answered: the question names the new page, so the answer shows the page it used.
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByRole("heading", { name: "Ask me about it." })).toBeVisible();
  const [idea = ""] = filesUnder(path.join(home, "Avanzel"), "ideas");
  const question = setup.getByRole("textbox", { name: "Ask your library" });
  await question.fill(`What is in [[${idea.replace(/\.md$/, "")}]]?`);
  await question.press("Enter");
  await expect(setup.getByText("Pages I used:", { exact: true })).toBeVisible({ timeout: 30_000 });
  found.push(...(await readable(app, setup, "Setup › Ask, answered", desktops)));

  // Done, with its two switches.
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByRole("heading", { name: "You're all set." })).toBeVisible();
  await expect(setup.getByRole("switch")).toHaveCount(2);
  found.push(...(await readable(app, setup, "Setup › Done", desktops)));

  // Start using Avanzel flies the window to the icon, and Zel's bubble opens under it.
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  const bubble = await windowFor(app, "up-here");
  await expect(bubble.getByText("I'm up here.", { exact: true })).toBeVisible();
  found.push(...(await readable(app, bubble, "Setup › the bubble", desktops)));
  await app.close();
  expect(found).toEqual([]);
});
