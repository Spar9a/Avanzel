// The setup window: a Mac with no library opens it instead of Settings, and Zel walks the person through the first
// run there. Every test launches as a first run (firstRun): a new HOME, an empty Hugging Face cache, and only
// stand-in agents on PATH: Claude Code and Codex, and the others a test adds, or none at all (noAgents).
import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { git, loadSettings, saveSettings, Vault } from "../../../packages/engine/src/index.ts";
import type { MenuItemModel } from "../src/main/menu-model.ts";
import type { FirstRun } from "../src/main/store.ts";
import type { SettingsSnapshot, SetupSnapshot } from "../src/shared/ipc.ts";
import {
  agentCalls,
  agentStubs,
  answerAs,
  call,
  capsuleKind,
  closeModelHubs,
  exists,
  fakeModelHub,
  filesUnder,
  filingClaude,
  firstRun,
  gitOut,
  launch,
  noAgents,
  onceMarker,
  read,
  recentlyFiled,
  SIGNED_IN,
  SIGNED_OUT_CLAUDE,
  SIGNED_OUT_CODEX,
  snap,
  speechWav,
  throughFound,
  toDone,
  typeFirstThought,
  UNREADABLE_CLAUDE,
  windowFor,
} from "./helpers.ts";

test.afterEach(closeModelHubs);

/** Whether a window of renderer `page` (say "setup") is on screen. */
const shown = (app: ElectronApplication, page: string) =>
  app.evaluate(
    ({ BrowserWindow }, name) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes(`/renderer/${name}/`) && w.isVisible()),
    page,
  );

/**
 * How many windows have `title` ("Set up Avanzel", "Avanzel Settings"), shown or not. A window has its title from the
 * moment it is made, while its address is "" until its page starts loading, so this counts one made a moment ago.
 */
const windowsTitled = (app: ElectronApplication, title: string) =>
  app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows().filter((w) => w.getTitle() === wanted).length, title);

/** What the setup window is sent now. */
const setupSnap = async (app: ElectronApplication) => (await call(app, "setupSnapshot")) as SetupSnapshot;

/** What Settings is sent now: which library is open. */
const settingsSnap = async (app: ElectronApplication) => (await call(app, "snapshot")) as SettingsSnapshot;

/** Found's footnote while the chosen agent's harness keeps it in the library folder (Claude Code, OpenCode). */
const LIMITS = "Your agent works only inside the library folder: no shell, no web.";

/** Found's line under a library place that holds files of its own. */
const HAS_FILES = "This folder has files already. I'll add the shelves, an AGENTS.md for your agent, and git history that keeps them.";

/** The heading of the step after Found. */
const THINK = "What's on your mind this week?";

/** The first-thought step's instruction, which holds Record a thought's shortcut. */
const INSTRUCTION = /^Press .+, ramble for half a minute, then press it again\. I'll sort it out\.$/;

/** The nudge the first-thought step shows when no press of the shortcut arrives within the wait. */
const NUDGE = /^Did .+ do nothing\?$/;

/** The install commands Found shows when no agent is installed: each vendor's own, as its install docs give it. */
const CLAUDE_INSTALL = "curl -fsSL https://claude.ai/install.sh | bash";
const CODEX_INSTALL = "curl -fsSL https://chatgpt.com/codex/install.sh | sh";

/** A line Found shows for an agent that answered its one short question. */
const REPLIED = /^Replied in \d+\.\d s$/;

/** What the check of agent `name` found, as the setup window is sent it. */
const statusKind = async (app: ElectronApplication, name: string) =>
  (await setupSnap(app)).agents.find((agent) => agent.name === name)?.status?.kind ?? null;

/** How the app has called the stand-in for `binary` so far, oldest first. */
const callsTo = async (app: ElectronApplication, binary: string) => (await agentCalls(app)).filter((line) => line.startsWith(`${binary} `));

/**
 * Stands in for the folder picker: it answers that `dir` was chosen, and keeps how it was asked (the title of the window
 * it is a sheet on, and its options) for `pickerAsked`.
 */
async function stubPicker(app: ElectronApplication, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async (...args: unknown[]) => {
      const [parent, options] = args.length > 1 ? args : [null, args[0]];
      (globalThis as { pickerAsked?: unknown }).pickerAsked = { sheetOn: (parent as { getTitle(): string } | null)?.getTitle() ?? null, options };
      return { canceled: false, filePaths: [chosen] };
    };
  }, dir);
}

const pickerAsked = (app: ElectronApplication) => app.evaluate(() => (globalThis as { pickerAsked?: unknown }).pickerAsked ?? null);

/** Whether `control` lies within the step's width, so none of it is cut off at the step's edge. */
async function withinStep(control: Locator, step: Locator): Promise<boolean> {
  const [box, area] = [await control.boundingBox(), await step.boundingBox()];
  return !!box && !!area && box.x >= area.x && box.x + box.width <= area.x + area.width;
}

/** How far the setup step scrolls sideways: 0 while every line fits its width, a long path's included. */
const sideways = (setup: Page) => setup.getByRole("main").evaluate((el) => el.scrollWidth - el.clientWidth);

/** From now on, notes the kind of every state sent to the capsule, for sentToCapsule. */
async function watchCapsule(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const capsule = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"));
    if (!capsule) throw new Error("There is no capsule window to watch.");
    const sent: string[] = [];
    (globalThis as { sentToCapsule?: string[] }).sentToCapsule = sent;
    const send = capsule.webContents.send.bind(capsule.webContents);
    capsule.webContents.send = (channel: string, ...args: unknown[]) => {
      if (channel === "capsule:state") sent.push((args[0] as { kind: string }).kind);
      send(channel, ...args);
    };
  });
}

const sentToCapsule = (app: ElectronApplication) => app.evaluate(() => (globalThis as { sentToCapsule?: string[] }).sentToCapsule ?? []);

/** The stage's keycaps, as the first-thought step draws Record a thought's shortcut. */
const keycaps = (setup: Page) => setup.locator('kbd[data-size="key"]');

/**
 * A press of Record a thought's shortcut: the callback it registered runs, as when the person presses the keys. Record
 * a thought in the menu (menuAction "dictate") and toggleDictate aren't presses of it.
 */
const pressShortcut = (app: ElectronApplication) => call(app, "pressShortcutForTests", "dictate");

/**
 * The person reaches for the shortcut and doesn't press it: modifier `key`, as a keydown names it, goes down in the
 * setup window and comes back up. Only the shortcut's first modifier (⌥ for ⌥Space) starts the press test's wait.
 */
async function reachFor(setup: Page, key: "Alt" | "Control" | "Shift" | "Meta"): Promise<void> {
  await setup.keyboard.down(key);
  await setup.keyboard.up(key);
}

/** Closes the setup window, as its red button does, and waits until it has gone. */
async function closeSetup(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }) => {
    const open = BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes("/renderer/setup/"));
    await Promise.all(open.map((w) => new Promise<void>((resolve) => {
      w.once("closed", () => resolve());
      w.close();
    })));
  });
}

test("a first launch without a library opens setup on Hello, not Settings", async () => {
  const app = await launch(firstRun().env);
  const setup = await windowFor(app, "setup");
  await expect(setup.getByRole("heading", { name: "Hi, I'm Zel." })).toBeVisible();
  await expect(setup.getByText(/Talk to me anytime with/)).toContainText("⌥Space");
  await expect(setup.getByRole("img", { name: /^Hello, \d{1,2} [A-Z][a-z]{2} \d{4}$/ })).toBeVisible();
  await expect(setup.getByText("Speech model, 673 MB. Downloads when you continue.")).toBeVisible();
  const title = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/setup/"))?.getTitle());
  expect(title).toBe("Set up Avanzel");
  expect(await shown(app, "settings")).toBe(false);
  await snap(setup, "setup-hello");
  await app.close();
});

test("Set me up moves to Here's what I found, and Back returns", async () => {
  const app = await launch(firstRun().env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByRole("heading", { name: "Here's what I found." })).toBeVisible();
  await expect.poll(() => call(app, "setupStepForTests")).toBe("found");
  await setup.getByRole("button", { name: "Back" }).click();
  await expect(setup.getByRole("heading", { name: "Hi, I'm Zel." })).toBeVisible();
  await expect.poll(() => call(app, "setupStepForTests")).toBe("hello");
  await app.close();
});

test("under Reduce Motion, Zel is awake and the hello stamp is there from the start", async () => {
  const app = await launch(firstRun().env);
  const setup = await windowFor(app, "setup");
  await setup.emulateMedia({ reducedMotion: "reduce" });
  // Hello is drawn afresh on the way back from the next step, now under Reduce Motion.
  await setup.getByRole("button", { name: "Set me up" }).click();
  await setup.getByRole("button", { name: "Back" }).click();
  await expect(setup.getByRole("heading", { name: "Hi, I'm Zel." })).toBeVisible();
  // At once: with motion, Zel would still be asleep and the stamp 1.6 s away.
  const first = await setup.evaluate(() => ({
    mood: document.querySelector("svg[data-mood]")?.getAttribute("data-mood"),
    stamped: document.querySelector('[role="img"][aria-label^="Hello, "]') !== null,
  }));
  expect(first).toEqual({ mood: "idle", stamped: true });
  await app.close();
});

test("with no library, the shortcut, Quick and Ask bring setup forward and the capsule stays hidden", async () => {
  const app = await launch(firstRun().env);
  await windowFor(app, "setup");
  await expect.poll(() => shown(app, "setup")).toBe(true);
  for (const method of ["toggleDictate", "openQuick", "openAsk"]) {
    await closeSetup(app);
    expect(await shown(app, "setup")).toBe(false);
    await call(app, method);
    await expect.poll(() => shown(app, "setup"), { message: `${method} brings setup forward` }).toBe(true);
    expect(await capsuleKind(app)).toBe("hidden");
  }
  expect(await shown(app, "quick")).toBe(false);
  expect(await shown(app, "ask")).toBe(false);
  await app.close();
});

test("the menu's Set up Avanzel… opens setup, and so does opening Avanzel again", async () => {
  const app = await launch(firstRun().env);
  await windowFor(app, "setup");
  await expect.poll(() => shown(app, "setup")).toBe(true);
  const [setUp] = (await call(app, "menuForTests")) as MenuItemModel[];
  expect(setUp).toMatchObject({ label: "Set up Avanzel…", action: "setup" });
  await closeSetup(app);
  await call(app, "menuAction", "setup");
  await expect.poll(() => shown(app, "setup")).toBe(true);
  await closeSetup(app);
  await app.evaluate(({ app: electronApp }) => electronApp.emit("activate"));
  await expect.poll(() => shown(app, "setup")).toBe(true);
  await app.close();
});

test("while setup is open, the shortcut and opening Avanzel again bring it forward, even once a library exists", async () => {
  const { env, home } = firstRun();
  const app = await launch(env);
  await windowFor(app, "setup");
  await expect.poll(() => shown(app, "setup")).toBe(true);
  await call(app, "toggleDictate");
  expect(await windowsTitled(app, "Set up Avanzel")).toBe(1);
  expect(await windowsTitled(app, "Avanzel Settings")).toBe(0);
  // A later step makes the library while setup stays open (here through Settings' own route). Opening Avanzel again
  // still brings setup forward, not Settings beside it.
  await call(app, "createLibrary", path.join(home, "Avanzel"));
  expect((await setupSnap(app)).libraryReady).toBe(true);
  await app.evaluate(({ app: electronApp }) => electronApp.emit("activate"));
  expect(await windowsTitled(app, "Set up Avanzel")).toBe(1);
  expect(await windowsTitled(app, "Avanzel Settings")).toBe(0);
  expect(await shown(app, "setup")).toBe(true);
  await app.close();
});

test("Set me up starts both speech models downloading, shown in the footer", async () => {
  const hub = await fakeModelHub("stall");
  const app = await launch({ ...firstRun().env, AVANZEL_MODELS_URL: hub.url });
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("Getting my ears ready")).toBeVisible();
  await expect(setup.getByRole("progressbar", { name: "Downloading the speech model" })).toBeVisible();
  await expect(setup.getByText(/^\d+ of 673 MB$/)).toBeVisible();
  // One download for both, smallest first: Silero's file is the first one asked for.
  await expect.poll(() => hub.requests.length).toBeGreaterThan(0);
  expect(hub.requests[0]).toContain("silero-vad-onnx");
  await app.close();
});

test("Here's what I found reads Claude Code's and Codex's sign-in, asks no agent anything, and chooses Claude Code", async () => {
  const app = await launch(firstRun().env);
  const setup = await windowFor(app, "setup");
  // Whether the no-agent Notice ever shows, even for a frame while Found waits for Set me up's first look.
  await setup.evaluate(() => {
    const page = window as { sawNoAgent?: boolean };
    page.sawNoAgent = false;
    new MutationObserver(() => {
      if (document.body.textContent?.includes("Avanzel needs an AI agent")) page.sawNoAgent = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(2, { timeout: 20_000 });
  await expect(setup.getByText("~/Avanzel", { exact: true })).toBeVisible();
  await expect(setup.getByText("A new library: Markdown files with git history.")).toBeVisible();
  await expect(setup.getByText("Best results")).toBeVisible();
  await expect(setup.getByText(LIMITS)).toBeVisible();
  await expect(setup.getByRole("button", { name: "Use Codex" })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Use Claude Code" })).toHaveCount(0);
  await expect(setup.getByRole("img", { name: "Chosen" })).toHaveCount(1);
  expect((await setupSnap(app)).agent).toBe("claude");
  // Only the sign-in commands ran: the stand-ins note every call, and no prompt was sent.
  expect((await agentCalls(app)).sort()).toEqual(["claude auth status", "codex login status"]);
  // Two agents and a new library fit without scrolling, the room kept under the step's end included.
  expect(await setup.getByRole("main").evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  expect(await setup.evaluate(() => (window as { sawNoAgent?: boolean }).sawNoAgent)).toBe(false);
  await snap(setup, "setup-found");
  await app.close();
});

test("Codex is chosen while Claude Code isn't signed in", async () => {
  const app = await launch(firstRun({ claude: SIGNED_OUT_CLAUDE }).env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("Not signed in", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(1, { timeout: 20_000 });
  expect((await setupSnap(app)).agent).toBe("codex");
  // Codex's harness doesn't keep it in the library folder, so the footnote doesn't say it does.
  await expect(setup.getByRole("img", { name: "Chosen" })).toHaveCount(1);
  await expect(setup.getByRole("button", { name: "Use Codex" })).toHaveCount(0);
  await expect(setup.getByText(LIMITS)).toHaveCount(0);
  const useClaude = setup.getByRole("button", { name: "Use Claude Code" });
  await expect(useClaude).toBeVisible();
  // The person's pick wins over the best agent, and only an installed agent can be picked.
  await useClaude.click();
  await expect(setup.getByRole("button", { name: "Use Codex" })).toBeVisible();
  expect((await setupSnap(app)).agent).toBe("claude");
  await expect(setup.getByText(LIMITS)).toBeVisible();
  await call(app, "chooseSetupAgent", "gemini");
  expect((await setupSnap(app)).agent).toBe("claude");
  expect((await agentCalls(app)).sort()).toEqual(["claude auth status", "codex login status"]);
  await app.close();
});

test("with no agent, setup shows how to install one, copies the command, and notices when one arrives", async () => {
  const { env, bin } = noAgents();
  const app = await launch(env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  const none = setup.getByText("Avanzel needs an AI agent to do the filing.", { exact: true });
  await expect(none).toBeVisible();
  await expect(setup.getByText("Claude Code works best. Install one in Terminal, and I'll notice when it's ready.", { exact: true })).toBeVisible();
  await expect(setup.getByText(CLAUDE_INSTALL, { exact: true })).toBeVisible();
  await expect(setup.getByText(CODEX_INSTALL, { exact: true })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Looks good" })).toBeDisabled();
  const copies = setup.getByRole("button", { name: /^(Copy|Copied)$/ });
  await expect(copies).toHaveText(["Copy", "Copy"]);
  await copies.first().click();
  await expect(copies).toHaveText(["Copied", "Copy"]);
  expect(await call(app, "copiedForTests")).toEqual([CLAUDE_INSTALL]);
  await expect(copies).toHaveText(["Copy", "Copy"], { timeout: 10_000 }); // "Copied" for 2 s
  // Claude Code is installed now, and its stand-in reads as signed in: setup notices, reads it and chooses it.
  copyFileSync(path.join(agentStubs(), "claude"), path.join(bin, "claude"));
  chmodSync(path.join(bin, "claude"), 0o755);
  await expect(setup.getByText("Signed in", { exact: true })).toBeVisible({ timeout: 15_000 });
  expect((await setupSnap(app)).agent).toBe("claude");
  await expect(none).toHaveCount(0);
  await app.close();
});

test("an agent whose sign-in can't be read stays Installed, and setup asks it nothing", async () => {
  const app = await launch(firstRun({ claude: UNREADABLE_CLAUDE }).env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(1, { timeout: 20_000 });
  await expect(setup.getByText("Installed", { exact: true })).toBeVisible({ timeout: 20_000 });
  expect((await setupSnap(app)).agent).toBe("codex");
  // Reading the sign-in said nothing, and the check stopped there: no prompt, which would cost the person's quota.
  expect((await agentCalls(app)).sort()).toEqual(["claude auth status", "codex login status"]);
  await app.close();
});

test("a signed-out Claude Code, once picked, says how to sign in, and Check again only reads the sign-in again", async () => {
  const { env, home } = firstRun({ claude: SIGNED_OUT_CLAUDE });
  const app = await launch(env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect.poll(async () => (await setupSnap(app)).agent, { timeout: 20_000 }).toBe("codex");
  await setup.getByRole("button", { name: "Use Claude Code" }).click();
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code isn't signed in on this Mac.", { exact: true })).toBeVisible();
  await expect(notice).toContainText("Run claude once in Terminal and sign in, then check again.");
  await expect(notice.getByText("claude", { exact: true })).toBeVisible(); // the command, set as code
  // Check again is the moment's primary, brought into view below the agents. The footer's button steps back and waits
  // for an agent that works, and so does the controller: it makes no library with this one.
  const checkAgain = notice.getByRole("button", { name: "Check again" });
  await expect(checkAgain).toHaveAttribute("data-variant", "primary");
  await expect(checkAgain).toBeInViewport({ ratio: 1 });
  const looksGood = setup.getByRole("button", { name: "Looks good" });
  await expect(looksGood).toHaveAttribute("data-variant", "secondary");
  await expect(looksGood).toBeDisabled();
  expect(((await call(app, "createSetupLibrary")) as SetupSnapshot).libraryReady).toBe(false);
  expect(existsSync(path.join(home, "Avanzel"))).toBe(false);
  await notice.getByRole("button", { name: "Open Terminal" }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["Terminal"]);
  await checkAgain.click();
  await expect.poll(async () => (await callsTo(app, "claude")).length, { timeout: 20_000 }).toBe(2);
  await expect.poll(() => statusKind(app, "claude"), { timeout: 20_000 }).toBe("signed-out");
  // The sign-in said no again, and the check stopped there: asking the model would cost the person's quota.
  expect(await callsTo(app, "claude")).toEqual(["claude auth status", "claude auth status"]);
  await expect(notice.getByText("Claude Code isn't signed in on this Mac.", { exact: true })).toBeVisible();
  await app.close();
});

test("with no agent signed in, Found says at once how to sign Claude Code in, and notices the sign-in on return", async () => {
  const { env } = firstRun({ claude: SIGNED_OUT_CLAUDE, codex: SIGNED_OUT_CODEX });
  const app = await launch(env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  // Nothing clicked: of the agents that need the person, Claude Code is chosen, and its Notice says how to sign it in.
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code isn't signed in on this Mac.", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(notice.getByRole("button", { name: "Open Terminal" })).toBeVisible();
  await expect(notice.getByRole("button", { name: "Check again" })).toHaveAttribute("data-variant", "primary");
  await expect(setup.getByText("Not signed in", { exact: true })).toHaveCount(2);
  expect((await setupSnap(app)).agent).toBe("claude");
  const looksGood = setup.getByRole("button", { name: "Looks good" });
  await expect(looksGood).toBeDisabled();
  // The person signs Claude Code in, in Terminal, and comes back: the window has the focus again.
  const [stubs = ""] = env.PATH!.split(":");
  answerAs(stubs, "claude", SIGNED_IN.claude!);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/setup/"))?.emit("focus");
  });
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(1, { timeout: 20_000 });
  await expect(notice).toHaveCount(0);
  await expect(looksGood).toBeEnabled();
  await expect(looksGood).toHaveAttribute("data-variant", "primary");
  // Only the sign-ins were read, Codex's again too since it was signed out: no agent was asked anything.
  expect((await agentCalls(app)).sort()).toEqual(["claude auth status", "claude auth status", "codex login status", "codex login status"]);
  await app.close();
});

test("an agent without a sign-in command is asked one question only when picked", async () => {
  const app = await launch(firstRun({ opencode: "echo ready" }).env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(2, { timeout: 20_000 });
  // OpenCode has no sign-in to read, so nothing is asked of it until the person picks it.
  await expect(setup.getByText("Installed", { exact: true })).toHaveCount(1);
  expect(await callsTo(app, "opencode")).toEqual([]);
  await setup.getByRole("button", { name: "Use OpenCode" }).click();
  await expect(setup.getByText(REPLIED)).toBeVisible({ timeout: 20_000 });
  const asked = await callsTo(app, "opencode");
  expect(asked).toHaveLength(1);
  expect(asked[0]?.startsWith("opencode run ")).toBe(true);
  expect(asked[0]?.endsWith("Reply with the single word: ready.")).toBe(true);
  expect((await setupSnap(app)).agent).toBe("opencode");
  await expect(setup.getByRole("button", { name: "Looks good" })).toBeEnabled();
  await app.close();
});

test("an agent picked while its sign-in is still being read is asked its question once the sign-in says nothing", async () => {
  // Claude Code's first sign-in read takes 5 s to say nothing a check understands, as an older one may; later ones
  // answer at once. Codex reads as signed in at once.
  const read = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-read-")), "read");
  const slow = `if [ "$1 $2" = "auth status" ]; then [ -e '${read}' ] || { touch '${read}'; sleep 5; }; echo "unknown command: auth"; exit 1; else echo ready; fi`;
  const app = await launch(firstRun({ claude: slow }).env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect.poll(async () => (await setupSnap(app)).agent, { timeout: 20_000 }).toBe("codex");
  expect(await statusKind(app, "claude")).toBe("checking");
  await setup.getByRole("button", { name: "Use Claude Code" }).click();
  await expect(setup.getByText(REPLIED)).toBeVisible({ timeout: 20_000 });
  expect((await callsTo(app, "claude")).filter((line) => line.startsWith("claude -p "))).toHaveLength(1);
  await expect(setup.getByRole("button", { name: "Looks good" })).toBeEnabled();
  await app.close();
});

test("a picked agent that fails says what it said, and Check again asks it again", async () => {
  // OpenCode fails the first time it is asked, as at a usage limit, and replies after that, taking 2 s.
  const asked = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-asked-")), "asked");
  const opencode = `if [ -e '${asked}' ]; then sleep 2; echo ready; else touch '${asked}'; echo 'Error: usage limit reached' >&2; exit 1; fi`;
  const app = await launch(firstRun({ opencode }).env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(2, { timeout: 20_000 });
  await setup.getByRole("button", { name: "Use OpenCode" }).click();
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("OpenCode didn't work.", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(notice.getByText("Usage limit reached.", { exact: true })).toBeVisible();
  await expect(notice.getByRole("button", { name: "Open Terminal" })).toHaveCount(0); // signing in isn't the fix
  const looksGood = setup.getByRole("button", { name: "Looks good" });
  await expect(looksGood).toHaveAttribute("data-variant", "secondary");
  const checkAgain = notice.getByRole("button", { name: "Check again" });
  await checkAgain.click();
  // While OpenCode is asked again, the Notice stays and its button is busy, so the focus stays where it was.
  await expect(checkAgain).toHaveAttribute("aria-busy", "true");
  await expect(setup.getByText(REPLIED)).toBeVisible({ timeout: 20_000 });
  await expect(notice).toHaveCount(0);
  await expect(looksGood).toHaveAttribute("data-variant", "primary");
  await expect(looksGood).toBeEnabled();
  expect(await callsTo(app, "opencode")).toHaveLength(2);
  await app.close();
});

test("before there is a library, a picked agent is asked in a scratch folder, which goes when Avanzel quits", async () => {
  const cwdLog = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-cwd-")), "cwd.log");
  const app = await launch(firstRun({ opencode: `pwd -P >> '${cwdLog}'; echo ready` }).env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(2, { timeout: 20_000 });
  await setup.getByRole("button", { name: "Use OpenCode" }).click();
  await expect(setup.getByText(REPLIED)).toBeVisible({ timeout: 20_000 });
  const [scratch = ""] = readFileSync(cwdLog, "utf8").split("\n").filter(Boolean);
  expect(path.dirname(scratch)).toBe(realpathSync(tmpdir()));
  expect(path.basename(scratch)).toMatch(/^avanzel-check-/);
  expect(existsSync(scratch)).toBe(true);
  await app.close();
  expect(existsSync(scratch)).toBe(false);
});

test("a scratch folder that can't be made is each check's failure, and Check again tries again", async () => {
  const app = await launch(firstRun().env);
  // The system's temporary folder refuses new folders for now, as a full disk would.
  await app.evaluate(() => {
    const fs = process.getBuiltinModule("node:fs");
    const make = fs.mkdtempSync;
    const state = globalThis as { refuseScratch?: boolean };
    state.refuseScratch = true;
    fs.mkdtempSync = ((prefix: string, options?: never) => {
      if (state.refuseScratch && prefix.includes("avanzel-check-")) throw new Error("ENOSPC: no space left on device, mkdtemp");
      return make(prefix, options);
    }) as typeof fs.mkdtempSync;
    process.getBuiltinModule("node:module").syncBuiltinESMExports();
  });
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect.poll(async () => [await statusKind(app, "claude"), await statusKind(app, "codex")], { timeout: 20_000 }).toEqual(["failed", "failed"]);
  // Neither works, so Claude Code is chosen for its problem, and its Notice shows with nothing clicked: the line is
  // each row's, and the Notice's too.
  expect((await setupSnap(app)).agent).toBe("claude");
  await expect(setup.getByText("ENOSPC: no space left on device, mkdtemp.", { exact: true })).toHaveCount(3);
  await app.evaluate(() => {
    (globalThis as { refuseScratch?: boolean }).refuseScratch = false;
  });
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code didn't work.", { exact: true })).toBeVisible();
  await notice.getByRole("button", { name: "Check again" }).click();
  await expect.poll(() => statusKind(app, "claude"), { timeout: 20_000 }).toBe("signed-in");
  await expect(notice).toHaveCount(0);
  expect((await setupSnap(app)).agent).toBe("claude");
  await app.close();
});

test("a failed download says so in the footer, with Try the download again", async () => {
  const hub = await fakeModelHub("missing");
  const app = await launch({ ...firstRun().env, AVANZEL_MODELS_URL: hub.url });
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("The speech model didn't finish downloading.")).toBeVisible();
  const retry = setup.getByRole("button", { name: "Try the download again" });
  await expect(retry).toBeVisible();
  const asked = hub.requests.length;
  await retry.click();
  await expect.poll(() => hub.requests.length).toBeGreaterThan(asked);
  await expect(setup.getByRole("heading", { name: "Here's what I found." })).toBeVisible();
  await app.close();
});

test("Looks good makes the library at ~/Avanzel with Claude Code, and moves on", async () => {
  const { env, home } = firstRun();
  const app = await launch(env);
  await throughFound(app);
  const library = path.join(home, "Avanzel");
  expect(existsSync(path.join(library, ".avanzel", "config.toml"))).toBe(true);
  expect(loadSettings(library).harness).toBe("claude");
  expect(gitOut(library, "log", "--format=%s")).toContain("avanzel: new library");
  expect((await settingsSnap(app)).library?.path).toBe(library);
  const menu = (await call(app, "menuForTests")) as MenuItemModel[];
  expect(menu.some((item) => item.type === "item" && item.label === "Record a thought")).toBe(true);
  await app.close();
});

test("a taken shortcut isn't named in the capsule when Looks good makes the library", async () => {
  const app = await launch({ ...firstRun().env, AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space" });
  await throughFound(app);
  expect((await settingsSnap(app)).library).not.toBeNull();
  // Settings' way of making a library names it at once (shortcuts.spec); setup leaves it to its own next step, where
  // the person presses the shortcut.
  expect(await capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("an existing folder with files becomes the library through Use this folder, keeping them", async () => {
  const { env, home } = firstRun();
  const library = path.join(home, "Avanzel");
  const notes = "# Notes\n\nPlant tulips in October.\n";
  mkdirSync(library);
  writeFileSync(path.join(library, "notes.md"), notes);
  const app = await launch(env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText(HAS_FILES)).toBeVisible();
  await expect(setup.getByRole("button", { name: "Looks good" })).toHaveCount(0);
  await setup.getByRole("button", { name: "Use this folder" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  expect(readFileSync(path.join(library, "notes.md"), "utf8")).toBe(notes);
  expect(gitOut(library, "ls-files").split("\n")).toContain("notes.md");
  expect(loadSettings(library).harness).toBe("claude");
  await app.close();
});

test("an existing library is used as it is", async () => {
  const { env, home } = firstRun();
  const library = path.join(home, "Avanzel");
  const plant = "# Plant tulips\n\nIn October, before the frost.\n";
  await Vault.init(library, { git: true });
  writeFileSync(path.join(library, "ideas", "plant.md"), plant);
  const app = await launch(env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("This folder is already an Avanzel library.")).toBeVisible();
  await setup.getByRole("button", { name: "Use this folder" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  expect(readFileSync(path.join(library, "ideas", "plant.md"), "utf8")).toBe(plant);
  expect((await settingsSnap(app)).library?.path).toBe(library);
  expect(loadSettings(library).harness).toBe("claude");
  await app.close();
});

test("an existing library whose settings don't load says so, and Found doesn't claim this Mac has no agent", async () => {
  const { env, home } = firstRun();
  const library = path.join(home, "Avanzel");
  await Vault.init(library, { git: false });
  writeFileSync(path.join(library, ".avanzel", "config.toml"), "harness = [\n");
  const app = await launch(env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(2, { timeout: 20_000 });
  await setup.getByRole("button", { name: "Use this folder" }).click();
  await expect(setup.getByRole("alert").getByText("I couldn't make the library at ~/Avanzel.", { exact: true })).toBeVisible({ timeout: 20_000 });
  // Its agents can't be read from its settings now, but they are installed: nothing says to install one.
  await expect(setup.getByText("Avanzel needs an AI agent to do the filing.", { exact: true })).toHaveCount(0);
  await app.close();
});

test("an existing library keeps its own agent while that agent works here, rather than the best one", async () => {
  const { env, home } = firstRun();
  const library = path.join(home, "Avanzel");
  await Vault.init(library, { git: true });
  saveSettings(library, { ...loadSettings(library), harness: "codex" }); // say, a library brought from another Mac
  const app = await launch(env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(2, { timeout: 20_000 });
  expect((await setupSnap(app)).agent).toBe("codex");
  await expect(setup.getByRole("button", { name: "Use Claude Code" })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Use Codex" })).toHaveCount(0);
  await setup.getByRole("button", { name: "Use this folder" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  expect(loadSettings(library).harness).toBe("codex");
  await app.close();
});

test("Found again once the library is made: Use this folder saves the agent picked, and makes nothing", async () => {
  const { env, home } = firstRun();
  const library = path.join(home, "Avanzel");
  const app = await launch(env);
  const setup = await throughFound(app);
  const commits = gitOut(library, "log", "--format=%H");
  await setup.getByRole("button", { name: "Back" }).click();
  await expect(setup.getByText("This folder is already an Avanzel library.")).toBeVisible();
  await setup.getByRole("button", { name: "Use Codex" }).click();
  await setup.getByRole("button", { name: "Use this folder" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  expect(loadSettings(library).harness).toBe("codex");
  expect(gitOut(library, "log", "--format=%H")).toBe(commits);
  expect((await settingsSnap(app)).library?.path).toBe(library);
  await app.close();
});

test("Change… picks another folder", async () => {
  const other = mkdtempSync(path.join(tmpdir(), "avz-e2e-other-"));
  const app = await launch(firstRun().env);
  await stubPicker(app, other);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await setup.getByRole("button", { name: "Change…" }).click();
  // Outside the home folder, so the row shows it whole, and its lines break within the row.
  await expect(setup.getByText(other, { exact: true })).toBeVisible();
  expect(await sideways(setup)).toBe(0);
  // The picker is a sheet on the setup window.
  expect(await pickerAsked(app)).toEqual({
    sheetOn: "Set up Avanzel",
    options: { title: "Choose your library folder", properties: ["openDirectory", "createDirectory"] },
  });
  // Nothing is made until Looks good.
  expect(existsSync(path.join(other, ".avanzel"))).toBe(false);
  await setup.getByRole("button", { name: "Looks good" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  expect((await settingsSnap(app)).library?.path).toBe(other);
  expect(existsSync(path.join(other, ".avanzel", "config.toml"))).toBe(true);
  await app.close();
});

test("a library that can't be made says why, and Change… is the way out", async () => {
  const { env, home } = firstRun();
  writeFileSync(path.join(home, "Avanzel"), "Not a folder.\n"); // a file where the library would go
  const other = mkdtempSync(path.join(tmpdir(), "avz-e2e-other-"));
  const app = await launch(env);
  await stubPicker(app, other);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  const use = setup.getByRole("button", { name: "Use this folder" });
  await use.click();
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("I couldn't make the library at ~/Avanzel.", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(setup.getByRole("heading", { name: "Here's what I found." })).toBeVisible();
  expect((await setupSnap(app)).libraryReady).toBe(false);
  expect(await sideways(setup)).toBe(0); // the message names a long path
  // The Notice's Change… is the one way out, and the moment's primary; the footer's button steps back.
  const change = notice.getByRole("button", { name: "Change…" });
  await expect(change).toHaveAttribute("data-variant", "primary");
  await expect(setup.getByRole("button", { name: "Change…" })).toHaveCount(1);
  await expect(use).toHaveAttribute("data-variant", "secondary");
  await snap(setup, "setup-found-problem");
  await change.click();
  await expect(notice).toHaveCount(0);
  await expect(setup.getByText(other, { exact: true })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Looks good" })).toHaveAttribute("data-variant", "primary");
  await setup.getByRole("button", { name: "Looks good" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  expect((await settingsSnap(app)).library?.path).toBe(other);
  await app.close();
});

test("Found holds four agents, a folder with files and its problem: the step scrolls under a fixed footer, and nothing is cut off", async () => {
  const hub = await fakeModelHub("stall");
  const { env, home } = firstRun({ opencode: "echo ready", "cursor-agent": "echo ready" });
  writeFileSync(path.join(home, "Avanzel"), "Not a folder.\n"); // Found takes it for a folder with files; no library can be made there
  const app = await launch({ ...env, AVANZEL_MODELS_URL: hub.url });
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(2, { timeout: 20_000 });
  await expect(setup.getByText("Installed", { exact: true })).toHaveCount(2);
  await expect(setup.getByText(HAS_FILES)).toBeVisible();
  const use = setup.getByRole("button", { name: "Use this folder" });
  await expect(use).toBeEnabled();
  await snap(setup, "setup-found-four-agents");
  const step = setup.getByRole("main");
  // Every row's control fits beside its agent, none past the step's edge.
  const controls = [setup.getByRole("img", { name: "Chosen" }), ...["Use Codex", "Use OpenCode", "Use Cursor Agent"].map((name) => setup.getByRole("button", { name }))];
  for (const control of controls) expect(await withinStep(control, step)).toBe(true);
  // The note under the agents and the footnote under it start at one edge.
  const note = await setup.getByText(/^Checking Claude Code or Codex reads their sign-in\./).boundingBox();
  const footnote = await setup.getByText(LIMITS).boundingBox();
  expect(footnote?.x).toBeCloseTo(note?.x ?? Number.NaN, 0);
  // Scrolled to its end, the step moves under the footer, which stays put.
  const footer = await use.boundingBox();
  await step.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect(await use.boundingBox()).toEqual(footer);
  await expect(use).toBeInViewport({ ratio: 1 });
  // It keeps a little room under its last line, so a focus ring drawn there isn't cut off at the step's edge.
  const room = await step.evaluate((el) => el.getBoundingClientRect().bottom - (el.lastElementChild?.getBoundingClientRect().bottom ?? 0));
  expect(room).toBeGreaterThanOrEqual(4);
  // The problem shows in view, its way out whole, though the step was scrolled to its end (five agents: below).
  await use.click();
  const change = setup.getByRole("alert").getByRole("button", { name: "Change…" });
  await expect(change).toBeInViewport({ ratio: 1, timeout: 20_000 });
  expect(await sideways(setup)).toBe(0);
  await snap(setup, "setup-found-four-agents-problem");
  // When the choice changes, the chosen agent's row comes into view, so its controls are never cut off.
  await step.evaluate((el) => el.scrollTo(0, 0));
  await expect(setup.getByRole("button", { name: "Use Cursor Agent" })).not.toBeInViewport({ ratio: 1 });
  await call(app, "chooseSetupAgent", "cursor-agent");
  await expect(setup.getByRole("img", { name: "Chosen" })).toBeInViewport({ ratio: 1 });
  // Nothing had asked Cursor Agent yet, so picking it asks its one question; once it has replied, it can file.
  await expect(setup.getByText(REPLIED)).toBeVisible({ timeout: 20_000 });
  await expect(use).toBeEnabled();
  expect(await callsTo(app, "cursor-agent")).toHaveLength(1);
  await app.close();
});

test("with five agents, a problem that shows above the part of the list in view comes into view", async () => {
  const { env, home } = firstRun({ opencode: "echo ready", "cursor-agent": "echo ready", gemini: "echo ready" });
  writeFileSync(path.join(home, "Avanzel"), "Not a folder.\n");
  const app = await launch(env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(2, { timeout: 20_000 });
  await expect(setup.getByText("Installed", { exact: true })).toHaveCount(3);
  // Scrolled to the end of a list this long, the place where the problem shows is above the part in view.
  await setup.getByRole("main").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await setup.getByRole("button", { name: "Use this folder" }).click();
  await expect(setup.getByRole("alert").getByRole("button", { name: "Change…" })).toBeInViewport({ ratio: 1, timeout: 20_000 });
  await app.close();
});

// The first-thought step tests the shortcut with a real press: macOS lets an app register a shortcut another app holds,
// so only a press that arrives says it works. firstRun() makes the wait 60 s, so these tests set it when they need it.

test("a press of the shortcut is heard, and setup says it is free", async () => {
  const app = await launch(firstRun().env);
  const setup = await throughFound(app);
  await expect(setup.getByText(INSTRUCTION)).toContainText("⌥Space");
  await expect(setup.getByText("If you're stuck, try a goal, someone you work with, or an idea you keep coming back to.", { exact: true })).toBeVisible();
  await expect(setup.getByText("Your words will appear here.", { exact: true })).toBeVisible();
  // The stage draws the shortcut as keycaps, one per key.
  await expect(keycaps(setup)).toHaveText(["⌥", "Space"]);
  await expect.poll(() => call(app, "setupStepForTests")).toBe("think");
  await pressShortcut(app);
  await expect(setup.getByText("⌥Space is free on this Mac, so it works in every app.", { exact: true })).toBeVisible();
  // The speech model can't download here (its server is a dead port), so the press only says that the shortcut works:
  // nothing records, the capsule shows nothing, and nothing promises that Esc cancels.
  expect(await capsuleKind(app)).toBe("hidden");
  await expect(setup.getByText(/Esc cancels/)).toHaveCount(0);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  await app.close();
});

test("no press within the wait offers two free shortcuts, and the one picked is the one to press", async () => {
  const app = await launch({ ...firstRun().env, AVANZEL_PRESS_WAIT_MS: "300" });
  const setup = await throughFound(app);
  // Entering the step starts no wait: nobody has reached for the shortcut.
  await setup.waitForTimeout(1_000);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  // ⌥ goes down, and no press follows.
  await reachFor(setup, "Alt");
  await expect(setup.getByText("Did ⌥Space do nothing?", { exact: true })).toBeVisible();
  // Whatever this Mac runs: a running Alfred, Raycast, ChatGPT or Superwhisper is named as the likely holder.
  await expect(setup.getByText(/^Another app may be using it(, probably \w+)?\. Try another shortcut\.$/)).toBeVisible();
  // The best one last, as the primary.
  const uses = setup.getByRole("button", { name: /^Use / });
  await expect(uses).toHaveText(["Use ⌃⌥R", "Use ⌃⇧Space"]);
  await expect(uses.last()).toHaveAttribute("data-variant", "primary");
  // Whether the step is ever without the nudge from here on, even for a frame.
  await setup.evaluate(() => {
    const page = window as { cleared?: boolean };
    page.cleared = false;
    new MutationObserver(() => {
      if (!/do nothing\?/.test(document.querySelector("main")?.textContent ?? "")) page.cleared = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await setup.getByRole("button", { name: "Use ⌃⇧Space" }).click();
  await expect.poll(async () => (await settingsSnap(app)).app.shortcuts.dictate).toBe("Control+Shift+Space");
  await expect(setup.getByText(INSTRUCTION)).toContainText("⌃⇧Space");
  await expect(keycaps(setup)).toHaveText(["⌃", "⇧", "Space"]);
  // The test starts over for the new shortcut: the nudge goes with the pick, and stays gone until the person reaches
  // for the new one (⌃ goes down) and doesn't press it; a press ends it.
  await setup.waitForTimeout(1_000);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  expect(await setup.evaluate(() => (window as { cleared?: boolean }).cleared)).toBe(true);
  await reachFor(setup, "Alt"); // ⌥ isn't the new shortcut's first modifier: it starts nothing
  await setup.waitForTimeout(1_000);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  await reachFor(setup, "Control");
  await expect(setup.getByText("Did ⌃⇧Space do nothing?", { exact: true })).toBeVisible();
  await pressShortcut(app);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  await expect(setup.getByText("⌃⇧Space is free on this Mac, so it works in every app.", { exact: true })).toBeVisible();
  await app.close();
});

test("the nudge waits for the person to reach for the shortcut, and then for the real 3 s", async () => {
  // The real wait: none of the tests' own.
  const app = await launch({ ...firstRun().env, AVANZEL_PRESS_WAIT_MS: "" });
  const setup = await throughFound(app);
  // The person reads, thinks and types, with ⌥ in the box for a typed thought, where it types a character: for longer
  // than the wait, and nothing asks whether ⌥Space did nothing.
  await setup.getByRole("button", { name: "Type it instead" }).click();
  const box = setup.getByRole("textbox", { name: "Your thought" });
  await expect(box).toBeFocused();
  await reachFor(setup, "Alt");
  await setup.waitForTimeout(4_000);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  expect((await setupSnap(app)).press.silent).toBe(false);
  // Out of the box, ⌥ goes down and no press follows: 3 s later, and not before, the step asks.
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(box).toHaveCount(0);
  const reached = Date.now();
  await reachFor(setup, "Alt");
  await setup.waitForTimeout(2_000);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  await expect(setup.getByText("Did ⌥Space do nothing?", { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - reached).toBeGreaterThanOrEqual(3_000);
  await app.close();
});

test("a ⌥Space another app holds is named at once, and the capsule doesn't name it too", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const app = await launch({ ...firstRun().env, AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space", AVANZEL_USER_DATA: userData });
  await call(app, "snapshot"); // it has started: a launch notice would show by now
  expect(await capsuleKind(app)).toBe("hidden");
  await watchCapsule(app);
  const setup = await throughFound(app);
  const notice = setup.getByRole("alert");
  await expect(notice.getByText(/^⌥Space is used by another app/)).toBeVisible();
  await expect(notice.getByText("Pick another shortcut.", { exact: true })).toBeVisible();
  await expect(notice.getByRole("button", { name: /^Use / })).toHaveText(["Use ⌃⌥R", "Use ⌃⇧Space"]);
  await expect(notice.getByRole("button", { name: "Use ⌃⇧Space" })).toHaveAttribute("data-variant", "primary");
  // From launch to here the capsule showed nothing: no state but hidden was sent to it.
  expect(await capsuleKind(app)).toBe("hidden");
  expect((await sentToCapsule(app)).filter((kind) => kind !== "hidden")).toEqual([]);
  // Named here, so the capsule won't name it at the next launch either.
  expect(JSON.parse(readFileSync(path.join(userData, "noticed-shortcuts.json"), "utf8"))).toContain("Alt+Space");
  await app.close();
});

test("with no free shortcut, setup offers Settings, and the shortcut set there is the one it listens for", async () => {
  const app = await launch({
    ...firstRun().env,
    AVANZEL_PRESS_WAIT_MS: "300",
    // ⌥Space and every one Record a thought could move to.
    AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space,Control+Shift+Space,Control+Alt+R,Control+Alt+D",
  });
  const setup = await throughFound(app);
  const taken = setup.getByRole("alert");
  await expect(taken.getByText(/^⌥Space is used by another app/)).toBeVisible();
  await expect(taken.getByText("Pick another one in Settings → Voice.", { exact: true })).toBeVisible();
  await expect(setup.getByRole("button", { name: /^Use / })).toHaveCount(0);
  const open = taken.getByRole("button", { name: "Open Settings" });
  await expect(open).toHaveAttribute("data-variant", "primary");
  await open.click();
  const settings = await windowFor(app, "settings");
  await expect(settings.getByRole("heading", { name: "Voice" })).toBeVisible();
  // A shortcut set in Settings is the one the step listens for now, from the start of a new wait.
  await call(app, "setApp", { shortcuts: { ...(await settingsSnap(app)).app.shortcuts, dictate: "Control+Alt+K" } });
  await expect(taken).toHaveCount(0);
  await expect(setup.getByText(INSTRUCTION)).toContainText("⌃⌥K");
  await reachFor(setup, "Control");
  await expect(setup.getByText("Did ⌃⌥K do nothing?", { exact: true })).toBeVisible();
  await expect(setup.getByText("Another app may be using it. Pick another one in Settings → Voice.", { exact: true })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Open Settings" })).toHaveAttribute("data-variant", "primary");
  await app.close();
});

test("the keycaps press themselves twice each time the step opens, and stay still under Reduce Motion", async () => {
  const app = await launch(firstRun().env);
  const setup = await windowFor(app, "setup");
  // Each keycap drawn pressed, by its key, from before the step first opens.
  await setup.evaluate(() => {
    const page = window as { presses?: string[] };
    page.presses = [];
    new MutationObserver((records) => {
      for (const { target } of records) {
        if (target instanceof Element && target.hasAttribute("data-pressed")) page.presses?.push(target.textContent ?? "");
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-pressed"] });
  });
  const presses = () => setup.evaluate(() => (window as { presses?: string[] }).presses ?? []);
  await throughFound(app);
  await expect.poll(presses, { timeout: 10_000 }).toEqual(["⌥", "Space", "⌥", "Space"]);
  await expect(setup.locator("kbd[data-pressed]")).toHaveCount(0); // they end up, unpressed
  // Again on the way back to the step.
  await setup.getByRole("button", { name: "Back" }).click();
  await setup.getByRole("button", { name: "Use this folder" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  await expect.poll(presses, { timeout: 10_000 }).toHaveLength(8);
  // Under Reduce Motion the step opens on their last frame, unpressed, and they stay so.
  await setup.emulateMedia({ reducedMotion: "reduce" });
  await setup.getByRole("button", { name: "Back" }).click();
  await setup.getByRole("button", { name: "Use this folder" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  await setup.waitForTimeout(2_500); // past the time of both presses
  expect(await presses()).toHaveLength(8);
  await expect(keycaps(setup)).toHaveText(["⌥", "Space"]);
  await app.close();
});

// The first thought, typed: setup files it in its own window while the person watches, with the time, Cancel, and
// one fix when it fails. The stand-in Claude Code runs the engine's fake agent (filingClaude), and ~/Avanzel is the
// library Looks good made.

/** The captures waiting in `library`'s inbox. */
const inbox = (library: string) => filesUnder(library, "inbox");

/** Zel's mood on the stage. */
const zel = (setup: Page) => setup.locator("svg[data-mood]");

/** A `claude` that is signed in, but whose filing fails: it prints `line` on stderr and exits 1, as a CLI does. */
const failingClaude = (line: string) => `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; else echo '${line}' >&2; exit 1; fi`;

test("a typed first thought is filed in the window, with the time shown", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch({ ...env, FAKE_AGENT_DELAY_MS: "1500", FAKE_AGENT_DELAY_TASK: "file" });
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await typeFirstThought(setup, "Plant tulips in October");
  await expect(setup.getByRole("heading", { name: "Watch me file it." })).toBeVisible();
  await expect(setup.getByText(/^Claude Code is working: \d+ s of about 15$/)).toBeVisible();
  await expect(setup.getByRole("heading", { name: /^All filed\. Claude Code took \d+ s\.$/ })).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByRole("listitem")).toHaveCount(1); // the receipt: the new page, on its shelf
  await expect(setup.getByRole("listitem")).toContainText(["Plant tulips in October"]);
  await expect(setup.getByRole("listitem")).toContainText(["Ideas"]);
  await expect(zel(setup)).toHaveAttribute("data-mood", "filed");
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveAttribute("data-variant", "primary");
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(inbox(library)).toEqual([]);
  // The setup window showed the filing, so the capsule showed nothing.
  expect(await capsuleKind(app)).toBe("hidden");
  // Only the first-thought step takes a typed thought: one sent from here (a second click, say) makes no capture.
  await call(app, "typeSetupThought", "A second thought");
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("an empty thought isn't filed, and the box says why", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch(env);
  const setup = await throughFound(app);
  await setup.getByRole("button", { name: "Type it instead" }).click();
  const box = setup.getByRole("textbox", { name: "Your thought" });
  await expect(box).toBeFocused();
  await box.fill("   ");
  await box.press("Enter"); // Return files, as File it does
  await expect(box).toHaveAccessibleDescription("Type a thought first.");
  expect(inbox(path.join(home, "Avanzel"))).toEqual([]);
  expect(await call(app, "setupStepForTests")).toBe("think");
  // Cancel puts the box away, and Type it instead brings it back.
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(box).toHaveCount(0);
  await setup.getByRole("button", { name: "Type it instead" }).click();
  await expect(box).toBeVisible();
  await app.close();
});

test("Cancel stops the agent, takes back what it did, and File it again files it", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch({ ...env, FAKE_AGENT_MODE: "slow-once", FAKE_AGENT_ONCE: onceMarker() });
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await typeFirstThought(setup, "Plant tulips in October");
  // The stalled run has changed something, and hangs.
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true);
  await expect(setup.getByText(/^Claude Code is working: \d+ s( of about 15)?$/)).toBeVisible();
  await expect(zel(setup)).toHaveAttribute("data-mood", "thinking");
  // While it runs, Cancel is the only way on: the footer has no Continue, and no step has Back here.
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  // Whether the stopped run is ever shown as a failure, even for a frame, before it is cancelled.
  await setup.evaluate(() => {
    const page = window as { sawFailure?: boolean };
    page.sawFailure = false;
    new MutationObserver(() => {
      if (document.querySelector('[role="alert"]')) page.sawFailure = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup.getByRole("heading", { name: "Cancelled." })).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByText("Your words are back in the inbox, untouched, and nothing else changed.", { exact: true })).toBeVisible();
  expect(await setup.evaluate(() => (window as { sawFailure?: boolean }).sawFailure)).toBe(false);
  expect(exists(library, "goals/half.md")).toBe(false);
  expect(inbox(library)).toHaveLength(1);
  await expect(zel(setup)).toHaveAttribute("data-mood", "idle");
  // File it again is the moment's primary; Continue steps back (one primary per moment).
  const again = setup.getByRole("button", { name: "File it again" });
  await expect(again).toHaveAttribute("data-variant", "primary");
  await expect(again).toBeFocused(); // where Cancel was
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveAttribute("data-variant", "secondary");
  await again.click();
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("a filing that asks to sign in names it and offers Open Terminal", async () => {
  const { env, home } = firstRun({ claude: failingClaude("Error: not logged in") });
  const app = await launch(env);
  const setup = await throughFound(app);
  await typeFirstThought(setup, "Plant tulips in October");
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code isn't signed in on this Mac.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(notice).toContainText("Run claude once in Terminal and sign in, then try again. Your words are safe in the inbox.");
  await expect(notice.getByText("claude", { exact: true })).toBeVisible(); // the command, set as code
  const tryAgain = notice.getByRole("button", { name: "Try again", exact: true });
  await expect(tryAgain).toHaveAttribute("data-variant", "primary");
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveAttribute("data-variant", "secondary");
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  await expect(zel(setup)).toHaveAttribute("data-mood", "needs-you");
  expect(inbox(path.join(home, "Avanzel"))).toHaveLength(1);
  await notice.getByRole("button", { name: "Open Terminal" }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["Terminal"]);
  await app.close();
});

test("another failure shows its own line", async () => {
  const { env, home } = firstRun({ claude: failingClaude("Error: usage limit reached") });
  const app = await launch(env);
  const setup = await throughFound(app);
  await typeFirstThought(setup, "Plant tulips in October");
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code couldn't file it.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(notice.getByText("Usage limit reached. Your words are safe in the inbox.", { exact: true })).toBeVisible();
  await expect(notice.getByRole("button", { name: "Open Terminal" })).toHaveCount(0); // signing in isn't the fix
  expect(inbox(path.join(home, "Avanzel"))).toHaveLength(1);
  // Try again files the same note again: the agent is asked once more.
  const filings = async () => (await callsTo(app, "claude")).filter((line) => line.startsWith("claude -p ")).length;
  expect(await filings()).toBe(1);
  await notice.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(filings, { timeout: 30_000 }).toBe(2);
  await expect(notice.getByText("Claude Code couldn't file it.", { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(inbox(path.join(home, "Avanzel"))).toHaveLength(1);
  await app.close();
});

test("a filing that waits for the library says so, and a note gone from the inbox meanwhile is named", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  // Another Avanzel run has the library: this test holds its lock, and the filing waits for it.
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    await typeFirstThought(setup, "Plant tulips in October");
    await expect(setup.getByText("Waiting for another Avanzel run to finish…", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(setup.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    // Meanwhile the note leaves the inbox, as when another Avanzel files it.
    for (const name of inbox(library)) rmSync(path.join(library, "inbox", name));
  } finally {
    letGo();
    await held;
  }
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code couldn't file it.", { exact: true })).toBeVisible({ timeout: 30_000 });
  // Nothing says the words are safe in the inbox, and there is nothing to try again: Continue is the way on.
  await expect(notice.getByText("The note isn't in the inbox any more.", { exact: true })).toBeVisible();
  await expect(notice.getByRole("button")).toHaveCount(0);
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveAttribute("data-variant", "primary");
  await app.close();
});

test("closing setup during the filing still files the thought and says so", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const words = "Plant tulips in October";
  const voice = { AVANZEL_USER_DATA: userData, AVANZEL_FAKE_AUDIO: speechWav(words), AVANZEL_FAKE_TRANSCRIPT: words };
  const app = await launch({ ...env, ...voice, FAKE_AGENT_DELAY_MS: "3000", FAKE_AGENT_DELAY_TASK: "file" });
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await typeFirstThought(setup, words);
  await expect(setup.getByRole("heading", { name: "Watch me file it." })).toBeVisible();
  await closeSetup(app);
  await call(app, "idleForTests");
  const notes = (await call(app, "notificationsForTests")) as { title: string; body: string }[];
  expect(notes.map((note) => note.title)).toContain("Filed by Claude Code");
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(await shown(app, "setup")).toBe(false);
  // The shortcut works as it does everywhere: a dictation starts in the capsule.
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "cancelRecording");
  await app.close();
  // The next launch has a library, so setup doesn't open.
  const next = await launch({ ...env, ...voice });
  expect((await settingsSnap(next)).library?.path).toBe(library);
  expect(await shown(next, "setup")).toBe(false);
  expect(await windowsTitled(next, "Set up Avanzel")).toBe(0);
  await next.close();
});

// The first thought, spoken. The first press asks about the microphone when macOS hasn't yet, then the real capsule
// records; once the words exist, the setup window takes over. A mic check gets a warm answer. AVANZEL_FAKE_AUDIO stands
// in for the microphone, AVANZEL_FAKE_TRANSCRIPT for the speech model (no test downloads one), and
// AVANZEL_FAKE_MIC_ANSWER for the answer to macOS's prompt.

/** What the first-thought step says while a recording runs. */
const LISTENING = "I'm listening.";

/** Zel's answer to a mic check. */
const HEARD_YOU = "Heard you. Want to try a real thought?";

/** The footnote a press of the shortcut brings, while nothing records. */
const FREE = /is free on this Mac, so it works in every app\.$/;

/** The same footnote while the capsule records, which Esc cancels. */
const FREE_RECORDING = /is free on this Mac, so it works in every app\. Esc cancels\.$/;

/** Esc's promise, which holds only while a recording runs. */
const ESC = /Esc cancels/;

/** A first run whose microphone hears "Plant tulips in October", filed by the stand-in Claude Code; `env` adds to it. */
function spokenRun(env: Record<string, string> = {}): { env: Record<string, string>; home: string } {
  const run = firstRun({ claude: filingClaude() });
  return { home: run.home, env: { ...run.env, AVANZEL_FAKE_AUDIO: speechWav("Plant tulips in October"), ...env } };
}

/** The first press records, and a second one stops it: what the person says is then the thought. */
async function sayThought(app: ElectronApplication, setup: Page): Promise<void> {
  await pressShortcut(app);
  await expect(setup.getByText(LISTENING)).toBeVisible();
  await pressShortcut(app);
}

test("the first press asks about the microphone behind one Continue, then records, and the words are filed", async () => {
  const { env, home } = spokenRun({
    AVANZEL_FAKE_PERMISSIONS: "microphone:not-determined",
    AVANZEL_FAKE_MIC_ANSWER: "granted",
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
  });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await pressShortcut(app);
  const primer = setup.getByRole("dialog");
  await expect(primer.getByText("Next, macOS asks about the microphone.", { exact: true })).toBeVisible();
  // The primer is the step: its one button is Continue, with no Back beside it, and nothing records until macOS asks.
  await expect(setup.getByRole("main").getByRole("button")).toHaveText(["Continue"]);
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  expect(await capsuleKind(app)).toBe("hidden");
  await snap(setup, "setup-think-primer");
  await primer.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await expect(setup.getByText(LISTENING)).toBeVisible();
  await expect(zel(setup)).toHaveAttribute("data-mood", "listening");
  await expect(setup.getByText(FREE_RECORDING)).toBeVisible(); // the first press was heard, and Esc cancels now
  await snap(setup, "setup-think-listening");
  await pressShortcut(app);
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  // Filed from the inbox with its recording kept, and the capsule hid once the words existed.
  expect(inbox(library)).toEqual([]);
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(filesUnder(library, "raw/audio")).toHaveLength(1);
  expect(await capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("a denied microphone says where to allow it, and offers typing", async () => {
  const { env } = spokenRun({ AVANZEL_FAKE_PERMISSIONS: "microphone:denied", AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October" });
  const app = await launch(env);
  const setup = await throughFound(app);
  await pressShortcut(app);
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Avanzel can't hear you yet.", { exact: true })).toBeVisible();
  await expect(notice.getByText("Allow it in System Settings, under Microphone.", { exact: true })).toBeVisible();
  const open = notice.getByRole("button", { name: "Open System Settings" });
  await expect(open).toHaveAttribute("data-variant", "primary");
  // One Type it instead: the Notice's, in place of the step's own.
  await expect(setup.getByRole("button", { name: "Type it instead" })).toHaveCount(1);
  await expect(notice.getByRole("button", { name: "Type it instead" })).toHaveAttribute("data-variant", "secondary");
  expect(await capsuleKind(app)).toBe("hidden");
  await expect(zel(setup)).toHaveAttribute("data-mood", "needs-you");
  // The press was heard, but nothing records, so nothing says Esc cancels.
  await expect(setup.getByText(FREE)).toBeVisible();
  await expect(setup.getByText(ESC)).toHaveCount(0);
  await snap(setup, "setup-think-denied");
  // With AVANZEL_TEST=1 System Settings stays shut, and openedForTests says which pane it would have opened.
  await open.click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["System Settings → Microphone"]);
  await notice.getByRole("button", { name: "Type it instead" }).click();
  await expect(setup.getByRole("textbox", { name: "Your thought" })).toBeFocused();
  await app.close();
});

test("testing, testing gets a warm answer, and Try again starts over", async () => {
  // A short wait, which Try again doesn't start: the nudge would show within it.
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Testing, testing.", AVANZEL_PRESS_WAIT_MS: "300" });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await sayThought(app, setup);
  await expect(setup.getByText(HEARD_YOU, { exact: true })).toBeVisible({ timeout: 30_000 });
  // The words are on the card, kept in the inbox with their recording; nothing is filed, and the capsule has hidden.
  await expect(setup.getByText("Testing, testing.", { exact: true })).toBeVisible();
  expect(inbox(library)).toHaveLength(1);
  expect(filesUnder(library, "raw/audio")).toHaveLength(1);
  expect(await capsuleKind(app)).toBe("hidden");
  const tryAgain = setup.getByRole("button", { name: "Try again", exact: true });
  await expect(tryAgain).toHaveAttribute("data-variant", "primary");
  await expect(setup.getByRole("button", { name: "File it anyway" })).toHaveAttribute("data-variant", "secondary");
  await expect(setup.getByText(INSTRUCTION)).toHaveCount(0);
  await snap(setup, "setup-think-test");
  await tryAgain.click();
  await expect(setup.getByText(INSTRUCTION)).toBeVisible();
  await expect.poll(() => inbox(library)).toEqual([]);
  expect(filesUnder(library, "raw/audio")).toEqual([]);
  await expect(setup.getByText(HEARD_YOU, { exact: true })).toHaveCount(0);
  // The step asks afresh, but nobody has reached for the shortcut since: nothing asks whether it did nothing.
  await setup.waitForTimeout(1_000);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  await app.close();
});

test("File it anyway files a mic check", async () => {
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Testing, testing." });
  const app = await launch(env);
  const setup = await throughFound(app);
  await sayThought(app, setup);
  await setup.getByRole("button", { name: "File it anyway" }).click();
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  expect(inbox(path.join(home, "Avanzel"))).toEqual([]);
  await app.close();
});

/**
 * What isn't the mic check's, put in `library` before it is said: a note of the person's own in the inbox, and an older
 * recording under raw/audio/ that no note there names. Their names, as `inbox` and filesUnder(…, "raw/audio") list them.
 */
function bystanders(library: string): { note: string; recording: string } {
  const note = new Vault(library).newCapture("Plant tulips in October", { source: "text", now: new Date(2026, 8, 30, 8, 0) });
  const recording = path.join(library, "raw", "audio", "2026", "09", "2026-09-30-0800.wav");
  mkdirSync(path.dirname(recording), { recursive: true });
  writeFileSync(recording, "RIFF");
  return { note: path.basename(note.path), recording: path.relative(path.join(library, "raw", "audio"), recording) };
}

/** The person says "Testing, testing." (the run's fake transcript), and Zel answers. */
async function sayMicCheck(app: ElectronApplication, setup: Page): Promise<void> {
  await sayThought(app, setup);
  await expect(setup.getByText(HEARD_YOU, { exact: true })).toBeVisible({ timeout: 30_000 });
}

test("Try again removes only the mic check's own note and recording", async () => {
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Testing, testing." });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  const kept = bystanders(library);
  await sayMicCheck(app, setup);
  expect(inbox(library)).toHaveLength(2);
  expect(filesUnder(library, "raw/audio")).toHaveLength(2);
  await setup.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(setup.getByText(INSTRUCTION)).toBeVisible();
  await expect.poll(() => inbox(library)).toEqual([kept.note]);
  expect(filesUnder(library, "raw/audio")).toEqual([kept.recording]);
  await app.close();
});

test("a press on a mic check's answer removes only its note and recording, and records again", async () => {
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Testing, testing." });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  const kept = bystanders(library);
  await sayMicCheck(app, setup);
  await pressShortcut(app);
  await expect(setup.getByText(LISTENING)).toBeVisible();
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  expect(inbox(library)).toEqual([kept.note]);
  expect(filesUnder(library, "raw/audio")).toEqual([kept.recording]);
  await call(app, "cancelRecording");
  await app.close();
});

test("Try again keeps a file outside raw/audio/ that the mic check's note names as its recording", async () => {
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Testing, testing." });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await sayMicCheck(app, setup);
  // A page of the person's, which the note's audio line now names by a path that starts in raw/audio/ and leaves it.
  const page = path.join(library, "ideas", "plant-tulips.md");
  const words = "# Plant tulips\n\nIn October, before the frost.\n";
  writeFileSync(page, words);
  const [name = ""] = inbox(library);
  const note = path.join(library, "inbox", name);
  writeFileSync(note, readFileSync(note, "utf8").replace(/^audio: .*$/m, "audio: raw/audio/../../ideas/plant-tulips.md"));
  expect(readFileSync(note, "utf8")).toContain("\naudio: raw/audio/../../ideas/plant-tulips.md\n");
  await setup.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(setup.getByText(INSTRUCTION)).toBeVisible();
  await expect.poll(() => inbox(library)).toEqual([]);
  expect(existsSync(page) ? readFileSync(page, "utf8") : null).toBe(words);
  await app.close();
});

test("while the ears are still arriving, a press says so and typing is the way", async () => {
  const hub = await fakeModelHub("stall");
  const { env } = spokenRun({ AVANZEL_MODELS_URL: hub.url });
  const app = await launch(env);
  const setup = await throughFound(app);
  await pressShortcut(app);
  await expect(setup.getByText(FREE)).toBeVisible();
  await expect(setup.getByText(ESC)).toHaveCount(0);
  await expect(setup.getByText("My ears are still arriving. Type it instead, or talk to me once they land.", { exact: true })).toBeVisible();
  // The press records nothing: no capsule, and typing is the moment's one primary.
  expect(await capsuleKind(app)).toBe("hidden");
  await expect(setup.getByRole("button", { name: "Type it instead" })).toHaveAttribute("data-variant", "primary");
  await expect(setup.getByText(LISTENING)).toHaveCount(0);
  await snap(setup, "setup-think-ears");
  await app.close();
});

test("Esc while listening cancels, and setup asks again", async () => {
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October" });
  const app = await launch(env);
  // Esc's own callback, as a recording registers it: the test presses it.
  await app.evaluate(({ globalShortcut }) => {
    const register = globalShortcut.register.bind(globalShortcut);
    globalShortcut.register = (accelerator: string, callback: () => void) => {
      if (accelerator === "Escape") (globalThis as { pressEsc?: () => void }).pressEsc = callback;
      return register(accelerator, callback);
    };
  });
  const setup = await throughFound(app);
  await pressShortcut(app);
  await expect(setup.getByText(LISTENING)).toBeVisible();
  await expect(setup.getByText(INSTRUCTION)).toHaveCount(0);
  await expect(setup.getByText(FREE_RECORDING)).toBeVisible();
  expect(await app.evaluate(() => {
    const pressEsc = (globalThis as { pressEsc?: () => void }).pressEsc;
    pressEsc?.();
    return !!pressEsc;
  })).toBe(true);
  await expect(setup.getByText(INSTRUCTION)).toBeVisible();
  await expect(setup.getByText(LISTENING)).toHaveCount(0);
  // Nothing records now, so Esc's promise goes with the recording.
  await expect(setup.getByText(FREE)).toBeVisible();
  await expect(setup.getByText(ESC)).toHaveCount(0);
  expect(await capsuleKind(app)).toBe("hidden");
  expect(inbox(path.join(home, "Avanzel"))).toEqual([]);
  // And again: a press records, and cancelling it (what Esc calls) asks again.
  await pressShortcut(app);
  await expect(setup.getByText(LISTENING)).toBeVisible();
  await call(app, "cancelRecording");
  await expect(setup.getByText(INSTRUCTION)).toBeVisible();
  expect(inbox(path.join(home, "Avanzel"))).toEqual([]);
  await app.close();
});

test("a recording that goes wrong says so in the window, not in the capsule, and Try again asks again", async () => {
  const { env } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October", AVANZEL_AUDIO_TIMEOUT_MS: "1000" });
  const app = await launch(env);
  const setup = await throughFound(app);
  // The audio is lost on its way from the capsule.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("capsule:audio");
    ipcMain.handle("capsule:audio", () => undefined);
  });
  await watchCapsule(app);
  await sayThought(app, setup);
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("The recording didn't arrive", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(notice.getByText("Try again; if it keeps happening, check the microphone in Settings → Voice.", { exact: true })).toBeVisible();
  // The capsule hid and showed no card: the window says it. Nothing records now, so nothing says Esc cancels.
  expect(await capsuleKind(app)).toBe("hidden");
  expect(await sentToCapsule(app)).not.toContain("error");
  await expect(setup.getByText(FREE)).toBeVisible();
  await expect(setup.getByText(ESC)).toHaveCount(0);
  const tryAgain = notice.getByRole("button", { name: "Try again", exact: true });
  await expect(tryAgain).toHaveAttribute("data-variant", "primary");
  await expect(setup.getByRole("button", { name: "Type it instead" })).toHaveAttribute("data-variant", "secondary");
  await tryAgain.click();
  await expect(notice).toHaveCount(0);
  await expect(setup.getByText(INSTRUCTION)).toBeVisible();
  await app.close();
});

test("words slow to come say how long they have taken, from 10 s on", async () => {
  const { env } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October", AVANZEL_AUDIO_TIMEOUT_MS: "60000" });
  const app = await launch(env);
  const setup = await throughFound(app);
  // The audio is held on its way from the capsule, so the words take as long as the test likes. The window's clock is
  // the test's to move.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("capsule:audio");
    ipcMain.handle("capsule:audio", () => undefined);
  });
  await setup.clock.install();
  await sayThought(app, setup);
  const line = setup.getByText(/^Turning your voice into text on this Mac…/);
  await expect(line).toHaveText("Turning your voice into text on this Mac…");
  await expect(zel(setup)).toHaveAttribute("data-mood", "thinking");
  await setup.clock.fastForward(11_000);
  await expect(line).toHaveText(/^Turning your voice into text on this Mac… \d+ s$/);
  await app.close();
});

test("Record a thought in the menu records on the first-thought step, but isn't a press of the shortcut", async () => {
  const { env } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October" });
  const app = await launch(env);
  const setup = await throughFound(app);
  await call(app, "menuAction", "dictate");
  await expect(setup.getByText(LISTENING)).toBeVisible();
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  // Nothing pressed the shortcut, so nothing says it is free.
  await expect(setup.getByText(/is free on this Mac/)).toHaveCount(0);
  await call(app, "menuAction", "dictate"); // Stop recording
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  await app.close();
});

// The first filing's end: the FILED stamp on its card, its pages on the shelves' tabs and in the receipt, and Undo (or
// ⌘Z), which puts everything back as it was. Each test types its thought, which the stand-in Claude Code files as an
// idea.

/** The heading once the first thought is filed. */
const FILED = /^All filed\. Claude Code took \d+ s\.$/;

/** The stage's shelf tabs, each read as its name and then its count, when it has one: "Ideas1". */
const tabs = (setup: Page) => setup.locator('[data-shelf][data-variant="tab"]');

/** The commits that undid a filing, in `library`'s history. */
const undoCommits = (library: string) => gitOut(library, "log", "--format=%s").split("\n").filter((subject) => subject.startsWith("avanzel: undo "));

/**
 * From now on, what Avanzel would open in this Mac's own apps (a page, the library) is noted for `openedWith`
 * instead, so no test opens anything here.
 */
async function stubOpening(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { openedWith?: string[] }).openedWith = opened;
    shell.openPath = async (file: string) => {
      opened.push(file);
      return "";
    };
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
}

const openedWith = (app: ElectronApplication) => app.evaluate(() => (globalThis as { openedWith?: string[] }).openedWith ?? []);

/** A first run launched with `env`, where "Plant tulips in October" is typed and filed: the app and its setup window, once filed. */
async function filedFirstThought(env: Record<string, string>): Promise<{ app: ElectronApplication; setup: Page }> {
  const app = await launch(env);
  const setup = await throughFound(app);
  await typeFirstThought(setup, "Plant tulips in October");
  await expect(setup.getByRole("heading", { name: FILED })).toBeVisible({ timeout: 30_000 });
  return { app, setup };
}

test("a filed thought shows its stamp, its page and how to undo it, and Undo puts everything back", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought(env);
  const library = path.join(home, "Avanzel");
  const [page = ""] = filesUnder(library, "ideas");
  // The card is stamped FILED, with the day, and the page went in behind the Ideas tab.
  await expect(setup.getByRole("img", { name: /^Filed, / })).toBeVisible();
  await expect(tabs(setup)).toHaveText(["Goals", "Ideas1", "Problems", "Memories", "People", "Topics"]);
  // The step, in order: the heading, Zel's praise, what the filing wrote, how to undo it, the receipt and its buttons.
  await expect(setup.getByText("Your first idea has a home.", { exact: true })).toBeVisible();
  await expect(setup.getByText("1 new page, all plain Markdown in ~/Avanzel.", { exact: true })).toBeVisible();
  await expect(setup.getByText("Press ⌘Z or Undo to put everything back.", { exact: true })).toBeVisible();
  await expect(setup.getByText("Your exact words are kept.")).toHaveCount(0); // the agent left them be
  await expect(setup.getByRole("listitem")).toHaveText(["Plant tulips in OctoberIdeas"]);
  await expect(setup.getByRole("main")).toHaveText(
    /^All filed\. .+Your first idea has a home\.1 new page, .+Press ⌘Z or Undo .+Plant tulips in OctoberIdeasUndoOpen the page$/,
  );
  // Continue is the one primary, and there is no Back.
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["Continue"]);
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  expect(await recentlyFiled(app)).toEqual(["Plant tulips in October"]);
  // Open the page opens the new page.
  await stubOpening(app);
  await setup.getByRole("button", { name: "Open the page" }).click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  expect(realpathSync((await openedWith(app))[0] ?? "")).toBe(realpathSync(path.join(library, "ideas", page)));
  // Undo puts everything back: the words in the inbox, no page, and nothing in the menu's Recently filed.
  await setup.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(setup.getByRole("heading", { name: "Undone." })).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByText("Everything is back as it was, and your words are in the inbox.", { exact: true })).toBeVisible();
  expect(inbox(library)).toHaveLength(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(await recentlyFiled(app)).toEqual([]);
  await expect(setup.getByRole("img", { name: /^Filed, / })).toHaveCount(0);
  await expect(tabs(setup)).toHaveText(["Goals", "Ideas", "Problems", "Memories", "People", "Topics"]);
  // File it again is the moment's one primary (Ruling P24), and has the focus Undo had; Continue steps back.
  const again = setup.getByRole("button", { name: "File it again" });
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["File it again"]);
  await expect(again).toBeFocused();
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveAttribute("data-variant", "secondary");
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  await again.click();
  await expect(setup.getByRole("heading", { name: FILED })).toBeVisible({ timeout: 30_000 });
  expect(inbox(library)).toEqual([]);
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  await app.close();
});

test("⌘Z undoes it too", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought(env);
  const library = path.join(home, "Avanzel");
  // Pressed twice in a row, it undoes once: the second press comes while the first is under way.
  await setup.keyboard.press("Meta+z");
  await setup.keyboard.press("Meta+z");
  await expect(setup.getByRole("heading", { name: "Undone." })).toBeVisible({ timeout: 30_000 });
  await call(app, "idleForTests");
  expect((await setupSnap(app)).filing?.kind).toBe("undone");
  expect(undoCommits(library)).toHaveLength(1);
  expect(inbox(library)).toHaveLength(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  // On a keyboard without Latin letters, ⌘ and the key in Z's place is ⌘Z too, as macOS reads it.
  await setup.getByRole("button", { name: "File it again" }).click();
  await expect(setup.getByRole("heading", { name: FILED })).toBeVisible({ timeout: 30_000 });
  await setup.evaluate(() =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "я", code: "KeyZ", metaKey: true, bubbles: true, cancelable: true })),
  );
  await expect(setup.getByRole("heading", { name: "Undone." })).toBeVisible({ timeout: 30_000 });
  expect(undoCommits(library)).toHaveLength(2);
  await app.close();
});

test("a filing that changed the words says they are kept", async () => {
  const { env } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought({ ...env, FAKE_AGENT_MODE: "tamper" });
  await expect(setup.getByText("Your exact words are kept.", { exact: true })).toBeVisible();
  await app.close();
});

test("a filing that wrote no page says its agent noted it in the log, and Continue goes to the end", async () => {
  const { env } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought({ ...env, FAKE_AGENT_MODE: "logonly" });
  await expect(setup.getByText("Claude Code noted it in the log.", { exact: true })).toBeVisible();
  // No line claims a page, no tab counts one, and nothing offers to open one (Review Focus 5).
  await expect(setup.getByText("Your first idea has a home.")).toHaveCount(0);
  await expect(setup.getByText(/plain Markdown|in other folders/)).toHaveCount(0);
  await expect(setup.getByRole("listitem")).toHaveCount(0);
  await expect(tabs(setup)).toHaveText(["Goals", "Ideas", "Problems", "Memories", "People", "Topics"]);
  await expect(setup.getByRole("button", { name: /^Open / })).toHaveCount(0);
  // It is filed all the same, as its own commit: the stamp, and Undo.
  await expect(setup.getByRole("img", { name: /^Filed, / })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => call(app, "setupStepForTests")).toBe("done");
  await app.close();
});

test("an Undo that git refuses says so, and Undo goes away", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought(env);
  const library = path.join(home, "Avanzel");
  // Meanwhile the new page is edited by hand, and the edit committed: undoing the filing would take the edit with it.
  const [page = ""] = filesUnder(library, "ideas");
  const file = path.join(library, "ideas", page);
  writeFileSync(file, "# Tulips, by hand\n");
  expect(await git.commitAll(library, "An edit by hand")).not.toBeNull();
  await setup.getByRole("button", { name: "Undo", exact: true }).click();
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("This one can't be undone automatically.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(notice.getByText("The library's history keeps both versions.", { exact: true })).toBeVisible();
  // Nothing offers to undo it any more, and the filing stays as it is, the edit by hand included.
  await expect(setup.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
  await expect(setup.getByText(/^Press ⌘Z or Undo/)).toHaveCount(0);
  await expect(setup.getByRole("heading", { name: FILED })).toBeVisible();
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["Continue"]);
  expect(readFileSync(file, "utf8")).toBe("# Tulips, by hand\n");
  expect(inbox(library)).toEqual([]);
  expect(undoCommits(library)).toEqual([]);
  await app.close();
});

test("Continue goes to Ask after a filing, and to the end after an undo", async () => {
  // Those steps draw nothing yet (Tasks 9 and 10): the step the session is on says where Continue went.
  const filed = await filedFirstThought(firstRun({ claude: filingClaude() }).env);
  await filed.setup.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => call(filed.app, "setupStepForTests")).toBe("ask");
  await filed.app.close();
  const second = firstRun({ claude: filingClaude() });
  const undone = await filedFirstThought(second.env);
  // While the undo waits for the library (another run has it: this test holds its lock), Undo is busy and Continue
  // waits, since the pages it would go on with are on their way out.
  let letGo = () => {};
  const held = new Vault(path.join(second.home, "Avanzel")).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    await undone.setup.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(undone.setup.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute("aria-busy", "true");
    await expect(undone.setup.getByRole("button", { name: "Continue" })).toBeDisabled();
  } finally {
    letGo();
    await held;
  }
  await expect(undone.setup.getByRole("heading", { name: "Undone." })).toBeVisible({ timeout: 30_000 });
  await undone.setup.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => call(undone.app, "setupStepForTests")).toBe("done");
  await undone.app.close();
});

test("in a library Obsidian has opened as a vault, the new page opens in Obsidian", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  // Obsidian is installed (a stand-in answers for its links), and has opened the library: it has an .obsidian folder.
  await app.evaluate((electron) => {
    electron.app.getApplicationNameForProtocol = () => "Obsidian";
  });
  mkdirSync(path.join(library, ".obsidian"));
  await stubOpening(app);
  await typeFirstThought(setup, "Plant tulips in October");
  await expect(setup.getByRole("heading", { name: FILED })).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByRole("button", { name: "Open the page" })).toHaveCount(0);
  await setup.getByRole("button", { name: "Open in Obsidian" }).click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  const [url = ""] = await openedWith(app);
  const [page = ""] = filesUnder(library, "ideas");
  expect(url).toMatch(/^obsidian:\/\/open\?path=/);
  expect(realpathSync(decodeURIComponent(url.slice("obsidian://open?path=".length)))).toBe(realpathSync(path.join(library, "ideas", page)));
  await app.close();
});

// Ask me about it: a question about the new pages, answered from the library only, with the pages the answer used. The
// stand-in Claude Code runs the engine's fake agent, which answers "Q: <the question>" and then lists the library's
// pages; a [[link]] in the question comes back in its answer, as an agent cites a page.

/** The question setup suggests once "Plant tulips in October" is filed as an idea. */
const SUGGESTED = "What did I say about Plant tulips in October?";

/** A first run launched with `env`, where "Plant tulips in October" is typed and filed, then Continue pressed: on Ask. */
async function onAsk(env: Record<string, string>): Promise<{ app: ElectronApplication; setup: Page }> {
  const { app, setup } = await filedFirstThought(env);
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByRole("heading", { name: "Ask me about it." })).toBeVisible();
  return { app, setup };
}

/** A `claude` that files as filingClaude's does, but fails every question: it prints `line` on stderr and exits 1. */
const failingAnswers = (line: string) => `case "$2" in "Avanzel task: ask"*) echo '${line}' >&2; exit 1;; esac\n${filingClaude()}`;

/** How many questions the stand-in Claude Code has been asked. */
const questionsAsked = async (app: ElectronApplication) => (await callsTo(app, "claude")).filter((line) => line.startsWith("claude -p Avanzel task: ask")).length;

/** The button that asks the suggested `question`, which the card shows: Ask this, in a group named for its question. */
const askThis = (setup: Page, question = SUGGESTED) => setup.getByRole("group", { name: question }).getByRole("button", { name: "Ask this" });

test("Ask suggests a question about the new page and answers it", async () => {
  const { app, setup } = await filedFirstThought(firstRun({ claude: filingClaude() }).env);
  // Only the Ask step asks: a question sent while Filing shows asks nothing.
  await call(app, "askInSetup", SUGGESTED);
  expect((await setupSnap(app)).answer).toBeNull();
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByRole("heading", { name: "Ask me about it." })).toBeVisible();
  await expect(setup.getByText("I answer from your library only, and show you the pages I used.", { exact: true })).toBeVisible();
  // The suggestion is on the stage's card, and a secondary Ask this asks it. Before an answer, Skip is the quiet way on,
  // nothing is primary, and there is no Back.
  await expect(setup.getByRole("article")).toContainText(SUGGESTED);
  const suggestion = askThis(setup);
  await expect(suggestion).toHaveAttribute("data-variant", "secondary");
  await expect(setup.getByRole("button", { name: "Skip" })).toHaveAttribute("data-variant", "quiet");
  await expect(setup.locator('button[data-variant="primary"]')).toHaveCount(0);
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  const field = setup.getByRole("textbox", { name: "Ask your library" });
  await field.fill("And the bulbs");
  await suggestion.click();
  // The suggestion goes while it is answered, and the focus it had goes to Ask your library, not to nowhere. What the
  // person was typing there stays.
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("And the bulbs");
  await expect(setup.getByText(`Q: ${SUGGESTED}`, { exact: true })).toBeVisible({ timeout: 30_000 });
  // Answered: the question over its answer, Zel at rest, and Continue the one primary, where Skip was.
  await expect(setup.getByRole("main").getByText(SUGGESTED, { exact: true })).toBeVisible();
  await expect(zel(setup)).toHaveAttribute("data-mood", "idle");
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["Continue"]);
  await expect(setup.getByRole("button", { name: "Skip" })).toHaveCount(0);
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => call(app, "setupStepForTests")).toBe("done");
  await app.close();
});

test("an answer's links become the pages it used", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const { app, setup } = await onAsk(env);
  const library = path.join(home, "Avanzel");
  const name = (filesUnder(library, "ideas")[0] ?? "").replace(/\.md$/, "");
  const field = setup.getByRole("textbox", { name: "Ask your library" });
  await expect(field).toHaveAttribute("placeholder", "Ask your library…");
  await field.fill(`What is in [[${name}]]?`);
  await field.press("Enter");
  await expect(field).toHaveValue(""); // asked: the box is ready for the next one
  await expect(setup.getByText("Pages I used:", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByText("Ideas", { exact: true })).toBeVisible(); // the page's shelf
  const source = setup.getByRole("button", { name: "Plant tulips in October", exact: true });
  await expect(source).toHaveAttribute("data-variant", "link");
  // In the answer the link reads as the words it gives; its page's title opens it.
  await expect(setup.getByText(`Q: What is in ${name}?`, { exact: true })).toBeVisible();
  await stubOpening(app);
  await source.click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  expect(realpathSync((await openedWith(app))[0] ?? "")).toBe(realpathSync(path.join(library, "ideas", `${name}.md`)));
  await app.close();
});

test("a slow answer shows the time and can be skipped", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const { app, setup } = await onAsk({ ...env, FAKE_AGENT_DELAY_MS: "20000", FAKE_AGENT_DELAY_TASK: "ask" });
  // Another run has the library at first (this test holds its lock): the question says it waits, then looks.
  let letGo = () => {};
  let released = 0;
  const held = new Vault(path.join(home, "Avanzel")).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    await askThis(setup).click();
    await expect(setup.getByText("Waiting for the filing in progress to finish…", { exact: true })).toBeVisible({ timeout: 30_000 });
  } finally {
    released = Date.now();
    letGo();
    await held;
  }
  await expect(setup.getByText(/^Looking through your library: \d+ s$/)).toBeVisible({ timeout: 30_000 });
  // Its seconds count from when the agent starts to look, not from the wait.
  const asking = (await setupSnap(app)).answer;
  expect(asking?.kind === "asking" && !asking.waiting && asking.startedAt >= released).toBe(true);
  await expect(setup.getByText(/^Looking through your library: [1-9]\d* s$/)).toBeVisible({ timeout: 10_000 }); // it counts
  await expect(setup.getByRole("article")).toContainText(SUGGESTED); // the question asked, on the card
  await expect(zel(setup)).toHaveAttribute("data-mood", "thinking");
  await setup.getByRole("button", { name: "Skip" }).click();
  await expect.poll(() => call(app, "setupStepForTests")).toBe("done");
  // Its agent stops, so nothing is left running, and what the stopped run said is dropped.
  await expect.poll(() => call(app, "busy"), { timeout: 10_000 }).toBe(false);
  expect((await setupSnap(app)).answer).toBeNull();
  await app.close();
});

test("an answer that fails says why, and the suggestion asks again", async () => {
  const { app, setup } = await onAsk(firstRun({ claude: failingAnswers("Error: usage limit reached") }).env);
  await askThis(setup).click();
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code couldn't answer.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(notice.getByText("Usage limit reached.", { exact: true })).toBeVisible();
  // There is no answer: Skip stays the way on, and Continue doesn't show.
  await expect(setup.getByRole("button", { name: "Skip" })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expect(zel(setup)).toHaveAttribute("data-mood", "idle");
  expect(await questionsAsked(app)).toBe(1);
  await askThis(setup).click();
  await expect.poll(() => questionsAsked(app), { timeout: 30_000 }).toBe(2);
  await expect(notice.getByText("Claude Code couldn't answer.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await app.close();
});

test("an Undo that lands once Ask shows takes the suggestion with it, and says so", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought(env);
  const library = path.join(home, "Avanzel");
  // The undo waits for the library at first (this test holds its lock), so Ask shows while it runs.
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    // Undo, then Continue before the window hears the undo has begun: both clicks in one turn of the page's event loop.
    await setup.evaluate(() => {
      const button = (name: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === name);
      button("Undo")?.click();
      button("Continue")?.click();
    });
    await expect(setup.getByRole("heading", { name: "Ask me about it." })).toBeVisible();
    await expect.poll(() => call(app, "setupStepForTests")).toBe("ask");
    // While the undo runs, the page is on its way out: nothing suggests a question about it.
    await expect.poll(async () => (await setupSnap(app)).filing).toMatchObject({ kind: "filed", undoing: true });
    await expect(setup.getByRole("button", { name: "Ask this" })).toHaveCount(0);
  } finally {
    letGo();
    await held;
  }
  await expect.poll(async () => (await setupSnap(app)).filing?.kind, { timeout: 30_000 }).toBe("undone");
  // The page has gone, so nothing asks about it, on the card or as a button; the step says what happened instead.
  await expect(setup.getByText("Everything is back as it was, and your words are in the inbox.", { exact: true })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Ask this" })).toHaveCount(0);
  await expect(setup.getByRole("article")).not.toContainText(SUGGESTED);
  expect((await setupSnap(app)).suggestion).toBeNull();
  expect(inbox(library)).toHaveLength(1);
  await setup.getByRole("button", { name: "Skip" }).click();
  await expect.poll(() => call(app, "setupStepForTests")).toBe("done");
  await app.close();
});

test("closing setup while a question is answered stops its agent", async () => {
  const { env } = firstRun({ claude: filingClaude() });
  const { app, setup } = await onAsk({ ...env, FAKE_AGENT_DELAY_MS: "20000", FAKE_AGENT_DELAY_TASK: "ask" });
  await askThis(setup).click();
  await expect(setup.getByText(/^Looking through your library: \d+ s$/)).toBeVisible({ timeout: 30_000 });
  await closeSetup(app);
  await expect.poll(() => call(app, "busy"), { timeout: 10_000 }).toBe(false);
  await app.close();
});

test("a long title fits Ask: the card holds the question, and a long source title is shortened", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  // A thought of 64 characters, which the stand-in files as an idea of that title.
  const words = "Launch plan for the spring campaign with Mark and the whole team";
  await typeFirstThought(setup, words);
  await expect(setup.getByRole("heading", { name: FILED })).toBeVisible({ timeout: 30_000 });
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByRole("heading", { name: "Ask me about it." })).toBeVisible();
  // The card holds the whole suggested question, Ask this asks it, and nothing runs past the step's edge.
  const question = `What did I say about ${words}?`;
  await expect(setup.getByRole("article")).toContainText(question);
  await expect(askThis(setup, question)).toBeVisible();
  expect(await sideways(setup)).toBe(0);
  // An answer that links the page: its link shows the title's first 39 characters and "…", and opens the page.
  const name = (filesUnder(library, "ideas")[0] ?? "").replace(/\.md$/, "");
  const field = setup.getByRole("textbox", { name: "Ask your library" });
  await field.fill(`What is in [[${name}]]?`);
  await field.press("Enter");
  const source = setup.getByRole("button", { name: "Launch plan for the spring campaign wit…", exact: true });
  await expect(source).toBeVisible({ timeout: 30_000 });
  expect(await sideways(setup)).toBe(0);
  // Its shelf keeps its whole name: the link goes under it rather than squeezing it to "Id…".
  expect(await setup.getByText("Ideas", { exact: true }).evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  await stubOpening(app);
  await source.click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  expect(realpathSync((await openedWith(app))[0] ?? "")).toBe(realpathSync(path.join(library, "ideas", `${name}.md`)));
  await app.close();
});

// You're all set: the last step. Entering it turns opening at login on, and its two switches, opening at login and the
// library's evening review, apply at once, as Settings' own do. Start using Avanzel ends setup: the window closes, and
// Avanzel waits in the menu bar. With AVANZEL_TEST=1 the login setting is saved, and this Mac's login items are left be.

/**
 * Stands in for macOS's login items: from now on, each call that would change them is noted for `loginItemCalls`, and
 * none reaches this Mac. A stand-in that couldn't be put in place fails the test at once.
 */
async function stubLoginItems(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp }) => {
    const calls: unknown[] = [];
    (globalThis as { loginItemCalls?: unknown[] }).loginItemCalls = calls;
    const standIn: typeof electronApp.setLoginItemSettings = (settings) => {
      calls.push(settings);
    };
    electronApp.setLoginItemSettings = standIn;
    if (electronApp.setLoginItemSettings !== standIn) throw new Error("The login items' stand-in didn't take.");
  });
}

const loginItemCalls = (app: ElectronApplication) => app.evaluate(() => (globalThis as { loginItemCalls?: unknown[] }).loginItemCalls ?? []);

/**
 * From now on, notes what the first switch to appear in `page` says as it is drawn: on Done, its opening at login, since
 * no step before it has a switch. For `firstSwitch`.
 */
async function watchFirstSwitch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const first = document.querySelector('[role="switch"]');
      if (!first) return;
      observer.disconnect();
      (window as { firstSwitch?: string | null }).firstSwitch = first.getAttribute("aria-checked");
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

const firstSwitch = (page: Page) => page.evaluate(() => (window as { firstSwitch?: string | null }).firstSwitch ?? null);

test("the last step turns on opening at login, and both switches apply at once", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch(env);
  await stubLoginItems(app);
  await watchFirstSwitch(await windowFor(app, "setup"));
  const library = path.join(home, "Avanzel");
  expect((await settingsSnap(app)).app.launchAtLogin).toBe(false); // a new Mac's setting
  const setup = await toDone(app);
  await expect.poll(async () => (await settingsSnap(app)).app.launchAtLogin).toBe(true);
  const login = setup.getByRole("switch", { name: "Open Avanzel when I log in" });
  await expect(login).toHaveAttribute("aria-checked", "true");
  // On from the moment it is drawn: it never shows off, then slides on by itself.
  expect(await firstSwitch(setup)).toBe("true");
  await login.click();
  await expect.poll(async () => (await settingsSnap(app)).app.launchAtLogin).toBe(false);
  await expect(login).toHaveAttribute("aria-checked", "false");
  // Only the step's first showing in a session turns it on: showing it again leaves the person's choice be.
  await call(app, "enterSetupStep", "done");
  expect((await settingsSnap(app)).app.launchAtLogin).toBe(false);
  // The library's evening review, as a new library has it: every day at 21:00, and on.
  const review = setup.getByRole("switch", { name: "Review my inbox every day at 21:00" });
  await expect(review).toHaveAttribute("aria-checked", "true");
  await expect(review).toHaveAccessibleDescription("Files anything still in the inbox and writes a short summary.");
  await review.click();
  await expect.poll(() => read(library, "tasks/evening-review.md")).toContain("enabled: false");
  await expect(review).toHaveAttribute("aria-checked", "false");
  // A library without an evening review has no switch for it: here its file goes, and the next change redraws the step.
  rmSync(path.join(library, "tasks", "evening-review.md"));
  await login.click();
  await expect(login).toHaveAttribute("aria-checked", "true");
  await expect(setup.getByRole("switch")).toHaveCount(1);
  // None of it reached this Mac's login items.
  expect(await loginItemCalls(app)).toEqual([]);
  await app.close();
});

test("Start using Avanzel closes the window, and the menu bar is where Avanzel lives", async () => {
  // With the menu bar icon hidden (empty bounds) the window just closes, with no flight and no bubble, so this test
  // doesn't depend on where this Mac's own menu bar icon is.
  const app = await launch({ ...firstRun({ claude: filingClaude() }).env, AVANZEL_FAKE_TRAY_BOUNDS: "0,0,0,0" });
  const setup = await toDone(app);
  // The step says how to talk to Avanzel and where it waits, beside Zel at rest. Start using Avanzel is its one
  // primary, and there is no Back.
  await expect(setup.getByText(/^Press ⌥Space anywhere to talk to me\. I'll wait in the menu bar\.$/)).toBeVisible();
  await expect(zel(setup)).toHaveAttribute("data-mood", "idle");
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["Start using Avanzel"]);
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  await expect.poll(() => shown(app, "setup"), { timeout: 5_000 }).toBe(false);
  // Closed, not hidden away: the session has ended with its window.
  await expect.poll(() => windowsTitled(app, "Set up Avanzel"), { timeout: 5_000 }).toBe(0);
  expect(await call(app, "setupStepForTests")).toBeNull();
  const menu = (await call(app, "menuForTests")) as MenuItemModel[];
  expect(menu).toContainEqual(expect.objectContaining({ type: "item", label: "Record a thought", action: "dictate" }));
  // Opening Avanzel again opens Settings now, as it does once there is a library, rather than setup.
  await app.evaluate(({ app: electronApp }) => electronApp.emit("activate"));
  expect(await windowsTitled(app, "Avanzel Settings")).toBe(1);
  expect(await windowsTitled(app, "Set up Avanzel")).toBe(0);
  await app.close();
});

// The milestones of a first run, which setup keeps in first-run.json in Avanzel's own data folder (§5.4's measures).
// They stay on this Mac: nothing reports them.

/** What setup has noted in first-run.json, in the data folder `userData` an app was launched with. */
function firstRunNotes(userData: string): FirstRun {
  return JSON.parse(readFileSync(path.join(userData, "first-run.json"), "utf8")) as FirstRun;
}

test("a finished setup leaves its milestones in first-run.json", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  // With the menu bar icon hidden (empty bounds) the window just closes: no flight, no bubble on this Mac's menu bar.
  const app = await launch({ ...firstRun({ claude: filingClaude() }).env, AVANZEL_USER_DATA: userData, AVANZEL_FAKE_TRAY_BOUNDS: "0,0,0,0" });
  const setup = await toDone(app);
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  // Closed, not just hidden: the session has ended, and ending it did not note a close.
  await expect.poll(() => windowsTitled(app, "Set up Avanzel"), { timeout: 10_000 }).toBe(0);
  await expect.poll(() => call(app, "setupStepForTests"), { timeout: 10_000 }).toBeNull();
  const noted = firstRunNotes(userData);
  expect(Object.keys(noted.steps)).toEqual(["hello", "found", "think", "filing", "ask", "done"]);
  expect(noted).toMatchObject({ version: 1, undone: false, closedOn: null });
  // Each time is when it happened, in ISO form, and they come in the order of the walk.
  const times = [
    noted.firstLaunchAt, noted.steps.hello, noted.steps.found, noted.steps.think, noted.steps.filing,
    noted.firstFiledAt, noted.steps.ask, noted.steps.done, noted.finishedAt,
  ];
  for (const time of times) expect(time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  expect(times).toEqual([...times].sort());
  await app.close();
});

test("Undo, and closing the window before the end, are noted in first-run.json", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const { env } = firstRun({ claude: filingClaude() });
  const { app, setup } = await filedFirstThought({ ...env, AVANZEL_USER_DATA: userData });
  await setup.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(setup.getByRole("heading", { name: "Undone." })).toBeVisible({ timeout: 30_000 });
  await closeSetup(app);
  const noted = firstRunNotes(userData);
  expect(Object.keys(noted.steps)).toEqual(["hello", "found", "think", "filing"]);
  expect(noted.firstFiledAt).not.toBeNull(); // it was filed, and then undone
  expect(noted).toMatchObject({ undone: true, finishedAt: null, closedOn: "filing" });
  await app.close();
});

test("a thought filed after the window was closed is the first filed thought all the same", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const { env } = firstRun({ claude: filingClaude() });
  const slow = { FAKE_AGENT_DELAY_MS: "3000", FAKE_AGENT_DELAY_TASK: "file" }; // the agent takes 3 s to file
  const app = await launch({ ...env, AVANZEL_USER_DATA: userData, ...slow });
  const setup = await throughFound(app);
  await typeFirstThought(setup, "Plant tulips in October");
  await expect(setup.getByRole("heading", { name: "Watch me file it." })).toBeVisible();
  await closeSetup(app);
  await call(app, "idleForTests");
  const noted = firstRunNotes(userData);
  expect(noted.firstFiledAt).not.toBeNull();
  expect(noted).toMatchObject({ finishedAt: null, closedOn: "filing" });
  await app.close();
});

// The ending: Start using Avanzel flies the blank setup window onto the menu bar icon, then Zel says it's up there in a
// bubble under the icon. AVANZEL_FAKE_TRAY_BOUNDS stands in for the icon's place, and `reduceMotion` for the Reduce
// Motion main reads, so neither the flight nor the bubble depends on this Mac's own menu bar or settings.

/** The menu bar icon in these tests, as AVANZEL_FAKE_TRAY_BOUNDS gives it: "x,y,width,height". */
const ICON = "1000,0,24,24";

/** A first run whose microphone hears "hello" as "Call the vet on Monday", with the menu bar icon at ICON. */
const endingRun = (): Record<string, string> => ({
  ...firstRun({ claude: filingClaude() }).env,
  AVANZEL_FAKE_AUDIO: speechWav("hello"),
  AVANZEL_FAKE_TRANSCRIPT: "Call the vet on Monday",
  AVANZEL_FAKE_TRAY_BOUNDS: ICON,
});

/**
 * Stands in for Reduce Motion as main reads it (systemPreferences.getAnimationSettings): on, or off. A stand-in that
 * couldn't be put in place fails the test at once.
 */
async function reduceMotion(app: ElectronApplication, on: boolean): Promise<void> {
  await app.evaluate(({ systemPreferences }, reduce) => {
    const real = systemPreferences.getAnimationSettings.bind(systemPreferences);
    const standIn: typeof systemPreferences.getAnimationSettings = () => ({ ...real(), prefersReducedMotion: reduce });
    systemPreferences.getAnimationSettings = standIn;
    if (systemPreferences.getAnimationSettings !== standIn) throw new Error("The Reduce Motion stand-in didn't take.");
  }, on);
}

/** From now on, notes each frame the setup window is given (setBounds), and whether macOS animates it, for `flights`. */
async function watchFlight(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const setup = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/setup/"));
    if (!setup) throw new Error("There is no setup window to watch.");
    const flights: unknown[] = [];
    (globalThis as { flights?: unknown[] }).flights = flights;
    const setBounds = setup.setBounds.bind(setup);
    setup.setBounds = (bounds, animate) => {
      flights.push({ bounds, animate: animate === true });
      setBounds(bounds, animate);
    };
  });
}

const flights = (app: ElectronApplication) => app.evaluate(() => (globalThis as { flights?: unknown[] }).flights ?? []);

/** Where the bubble's window is, and the work area of the display that holds the icon. */
const bubblePlace = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow, screen }) => {
    const bubble = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/up-here/"));
    return { bounds: bubble?.getBounds() ?? null, work: screen.getDisplayMatching({ x: 1000, y: 0, width: 24, height: 24 }).workArea };
  });

test("Start using Avanzel flies the window to the menu bar, Zel says it's up there, and Try it now records", async () => {
  const app = await launch(endingRun());
  const setup = await toDone(app);
  await reduceMotion(app, false);
  await watchFlight(app);
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  // The page blanks itself at once, so the window flies as blank paper (the flight leaves it 700 ms to be read).
  expect(await setup.evaluate(() => getComputedStyle(document.getElementById("root")!).visibility)).toBe("hidden");
  await expect.poll(() => shown(app, "setup"), { timeout: 5_000 }).toBe(false);
  // It flew: macOS animated its frame onto a 24 px square centred on the icon.
  expect(await flights(app)).toEqual([{ bounds: { x: 1000, y: 0, width: 24, height: 24 }, animate: true }]);
  const bubble = await windowFor(app, "up-here");
  await expect.poll(() => shown(app, "up-here")).toBe(true);
  await expect(bubble.getByText("I'm up here.", { exact: true })).toBeVisible();
  await expect(bubble.getByText("⌥Space", { exact: true })).toBeVisible();
  await expect(bubble.getByText(/^Press ⌥Space anywhere, say what's on your mind, and press it again\.$/)).toBeVisible();
  await expect(bubble.locator('button[data-variant="primary"]')).toHaveText(["Try it now"]);
  // Its tail's tip, 42 px in from the window's right edge, is under the icon's centre (x 1012), and the window's top is
  // the top of the work area, under the menu bar. This display is wider than 1054 pt, so nothing moves it back in.
  const { bounds, work } = await bubblePlace(app);
  expect(bounds).toEqual({ x: 1012 + 42 - 320, y: Math.max(work.y, 24), width: 320, height: 200 });
  await bubble.getByRole("button", { name: "Try it now" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await expect.poll(() => shown(app, "up-here")).toBe(false);
  await call(app, "cancelRecording");
  await app.close();
});

test("Not now and Esc put the bubble away", async () => {
  test.setTimeout(180_000); // two first runs, each walked to the end
  for (const dismiss of ["Not now", "Esc"] as const) {
    const app = await launch(endingRun());
    const setup = await toDone(app);
    await setup.getByRole("button", { name: "Start using Avanzel" }).click();
    const bubble = await windowFor(app, "up-here");
    await expect.poll(() => shown(app, "up-here")).toBe(true);
    if (dismiss === "Not now") await bubble.getByRole("button", { name: "Not now" }).click();
    else await bubble.keyboard.down("Escape"); // the bubble goes at once, before the key comes back up
    await expect.poll(() => shown(app, "up-here"), { message: dismiss }).toBe(false);
    expect(await capsuleKind(app)).toBe("hidden"); // and nothing records
    await app.close();
  }
});

test("under Reduce Motion the window just closes, Zel still says it's up there, and a click elsewhere puts it away", async () => {
  const app = await launch(endingRun());
  const setup = await toDone(app);
  await reduceMotion(app, true);
  await watchFlight(app);
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  await expect.poll(() => shown(app, "setup"), { timeout: 5_000 }).toBe(false);
  expect(await flights(app)).toEqual([]); // it closed where it was
  const bubble = await windowFor(app, "up-here");
  await expect.poll(() => shown(app, "up-here")).toBe(true);
  await expect(bubble.getByText("I'm up here.", { exact: true })).toBeVisible();
  // A click elsewhere takes the focus from it, and macOS tells its window so (blur). The app under test may not be this
  // Mac's active app, which would have no focus to lose, so the test tells the window itself.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/up-here/"))?.emit("blur");
  });
  await expect.poll(() => shown(app, "up-here")).toBe(false);
  await app.close();
});

test("with the menu bar icon hidden, the window just closes, and no bubble points at it", async () => {
  const app = await launch({ ...endingRun(), AVANZEL_FAKE_TRAY_BOUNDS: "0,0,0,0" });
  const setup = await toDone(app);
  await reduceMotion(app, false);
  await watchFlight(app);
  // The bubble's window is titled "Avanzel", and so is the capsule's, which has no title of its own but the app's name.
  const titled = await windowsTitled(app, "Avanzel");
  await setup.getByRole("button", { name: "Start using Avanzel" }).click();
  await expect.poll(() => windowsTitled(app, "Set up Avanzel"), { timeout: 5_000 }).toBe(0);
  expect(await flights(app)).toEqual([]);
  // A bubble is made as the window closes, if at all: none was.
  expect(await windowsTitled(app, "Avanzel")).toBe(titled);
  // Opening Avanzel again finds it: Settings, now that there is a library.
  await app.evaluate(({ app: electronApp }) => electronApp.emit("activate"));
  expect(await windowsTitled(app, "Avanzel Settings")).toBe(1);
  await app.close();
});
