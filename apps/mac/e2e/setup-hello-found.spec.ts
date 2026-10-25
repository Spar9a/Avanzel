// The setup window's first two steps, Hello and Found: a Mac with no library opens it instead of Settings, and Zel walks the
// person through the first run there. Every test launches as a first run (firstRun): a new HOME, an empty Hugging Face
// cache, and only stand-in agents on PATH: Claude Code and Codex, and the others a test adds, or none at all (noAgents).
import { expect, test, type ElectronApplication, type Locator } from "@playwright/test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, saveSettings, Vault } from "../../../packages/engine/src/index.ts";
import type { MenuItemModel } from "../src/main/menu-model.ts";
import type { SetupSnapshot } from "../src/shared/ipc.ts";
import {
  agentCalls,
  agentStubs,
  answerAs,
  call,
  capsuleKind,
  closeModelHubs,
  fakeModelHub,
  firstRun,
  gitOut,
  launch,
  noAgents,
  pickerAsked,
  shown,
  SIGNED_IN,
  SIGNED_OUT_CLAUDE,
  SIGNED_OUT_CODEX,
  snap,
  stubPicker,
  throughFound,
  UNREADABLE_CLAUDE,
  windowFor,
} from "./helpers.ts";
import { callsTo, closeSetup, CODEX_INSTALL, dockShown, settingsSnap, setupSnap, sideways, THINK, windowsTitled } from "./setup-helpers.ts";

test.afterEach(closeModelHubs);

/** Found's footnote while the chosen agent's harness keeps it in the library folder (Claude Code, OpenCode). */
const LIMITS = "Your agent works only inside the library folder: no shell, no web.";

/** Found's line under a library place that holds files of its own. */
const HAS_FILES = "This folder has files already. I'll add the shelves, an AGENTS.md for your agent, and git history that keeps them.";

/** The install command Found shows for Claude Code when no agent is installed: the vendor's own, as its install docs give it. */
const CLAUDE_INSTALL = "curl -fsSL https://claude.ai/install.sh | bash";

/** A line Found shows for an agent that answered its one short question. */
const REPLIED = /^Replied in \d+\.\d s$/;

/** What the check of agent `name` found, as the setup window is sent it. */
const statusKind = async (app: ElectronApplication, name: string) =>
  (await setupSnap(app)).agents.find((agent) => agent.name === name)?.status?.kind ?? null;

/** Whether `control` lies within the step's width, so none of it is cut off at the step's edge. */
async function withinStep(control: Locator, step: Locator): Promise<boolean> {
  const [box, area] = [await control.boundingBox(), await step.boundingBox()];
  return !!box && !!area && box.x >= area.x && box.x + box.width <= area.x + area.width;
}

test("a first launch without a library opens setup on Hello, not Settings", async () => {
  const app = await launch(firstRun().env);
  const setup = await windowFor(app, "setup");
  await expect(setup.getByRole("heading", { name: "Hi, I'm Zel." })).toBeVisible();
  await expect(setup.getByText(/Talk to me anytime with/)).toContainText("⌥Space");
  // The stamp is the card's own, in its corner, and carries the day: the card's header has no date of its own.
  await expect(setup.getByRole("article").getByRole("img", { name: /^Hello, \d{1,2} [A-Z][a-z]{2} \d{4}$/ })).toBeVisible();
  await expect(setup.getByRole("article")).not.toContainText(/(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day/);
  // Zel looks up at the card it stamped, not at the person.
  await expect(setup.locator("svg[data-mood]")).toHaveAttribute("data-look", "up");
  await expect(setup.getByText("Speech model, 673 MB. Downloads when you continue.")).toBeVisible();
  const title = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/setup/"))?.getTitle());
  expect(title).toBe("Set up Avanzel");
  expect(await shown(app, "settings")).toBe(false);
  // While setup is open, Avanzel has a Dock icon, so its window is easy to find again behind other apps.
  await expect.poll(() => dockShown(app)).toBe(true);
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

test("a download in progress reaches the setup window at most once a second", async () => {
  const hub = await fakeModelHub("trickle");
  const app = await launch({ ...firstRun().env, AVANZEL_MODELS_URL: hub.url });
  const setup = await windowFor(app, "setup");
  // From now on, when each snapshot is sent to the setup window is noted.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/setup/"));
    if (!win) throw new Error("There is no setup window to watch.");
    const sent: number[] = [];
    Object.assign(globalThis, { setupSends: sent });
    const send = win.webContents.send.bind(win.webContents);
    win.webContents.send = (channel: string, ...args: unknown[]) => {
      if (channel === "setup:changed") sent.push(Date.now());
      send(channel, ...args);
    };
  });
  const sends = () => app.evaluate(() => (globalThis as { setupSends?: number[] }).setupSends ?? []);
  const received = async () => {
    const { model } = await setupSnap(app);
    return model.kind === "downloading" ? model.receivedBytes : 0;
  };
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(2, { timeout: 20_000 });
  // The agents have been read: for 3 s only the download moves, its progress ticking every 250 ms.
  const from = Date.now();
  const before = await received();
  await setup.waitForTimeout(3_000);
  expect(await received()).toBeGreaterThan(before);
  const during = (await sends()).filter((at) => at >= from);
  expect(during.length).toBeGreaterThan(0); // the footer still follows it
  expect(during.length).toBeLessThanOrEqual(4); // once a second at most, rather than at each of a dozen ticks
  await expect(setup.getByText(/^\d+ of 673 MB$/)).toBeVisible();
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
  expect((await setupSnap(app)).gitUsable).toBe(true);
  await expect(setup.getByRole("button", { name: "Install git" })).toHaveCount(0); // this Mac has git: nothing to install
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

test("a sign-in read again on return that can't be read leaves Not signed in, its Notice and Check again", async () => {
  // Claude Code's sign-in can't be read (UNREADABLE_CLAUDE), and its one question asks to sign in, as at a lapsed login.
  const lapsed = UNREADABLE_CLAUDE.replace("else echo ready", "else echo 'Error: not logged in' >&2; exit 1");
  expect(lapsed).not.toBe(UNREADABLE_CLAUDE);
  const app = await launch(firstRun({ claude: lapsed }).env);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect.poll(async () => (await setupSnap(app)).agent, { timeout: 20_000 }).toBe("codex");
  await setup.getByRole("button", { name: "Use Claude Code" }).click();
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code isn't signed in on this Mac.", { exact: true })).toBeVisible({ timeout: 20_000 });
  // The person comes back from Terminal: the window has the focus again, and Claude Code's sign-in is read again. It
  // still can't be read, so the read learns nothing.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/setup/"))?.emit("focus");
  });
  const signInReads = async () => (await callsTo(app, "claude")).filter((line) => line === "claude auth status").length;
  await expect.poll(signInReads, { timeout: 20_000 }).toBe(2);
  const rereading = () => app.evaluate(() => (globalThis as { __avanzel?: { rereading: Set<string> } }).__avanzel?.rereading.size ?? 0);
  await expect.poll(rereading, { timeout: 20_000 }).toBe(0);
  // What the question found still stands: the row, the Notice and Check again, so Found isn't left with no way on.
  expect(await statusKind(app, "claude")).toBe("signed-out");
  await expect(setup.getByText("Not signed in", { exact: true })).toBeVisible();
  await expect(notice.getByText("Claude Code isn't signed in on this Mac.", { exact: true })).toBeVisible();
  await expect(notice.getByRole("button", { name: "Check again" })).toBeVisible();
  // Reading the sign-in again asked nothing: its one question was asked once, when it was picked.
  expect((await callsTo(app, "claude")).filter((line) => line.startsWith("claude -p "))).toHaveLength(1);
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

// A Mac without Apple's Command Line Tools has only a stub at /usr/bin/git, which opens Apple's install dialog when it is run.
// AVANZEL_GIT_USABLE=0 plays that Mac: the app is told no git is usable, whatever this Mac has. Nothing ever runs git to find out.
const NO_GIT = "This Mac has no git yet, so changes can't be undone.";

test("on a Mac without git, Found says so, Install git asks macOS for it, and Looks good makes the library without git", async () => {
  const { env, home } = firstRun();
  const app = await launch({ ...env, AVANZEL_GIT_USABLE: "0" });
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText(`A new library: Markdown files. ${NO_GIT}`, { exact: true })).toBeVisible();
  await expect(setup.getByText("A new library: Markdown files with git history.")).toHaveCount(0);
  expect((await setupSnap(app)).gitUsable).toBe(false);
  // Install git is a secondary: the footer's Looks good stays the moment's primary, since a library without git is made all the same.
  const install = setup.getByRole("button", { name: "Install git" });
  await expect(install).toHaveAttribute("data-variant", "secondary");
  await expect.poll(async () => (await setupSnap(app)).agent, { timeout: 20_000 }).toBe("claude");
  await expect(setup.getByRole("button", { name: "Looks good" })).toHaveAttribute("data-variant", "primary");
  expect(await sideways(setup)).toBe(0);
  await snap(setup, "setup-found-no-git");
  // It asks macOS to install the tools: the test run records that, and runs nothing.
  expect(await call(app, "spawnedForTests")).toEqual([]);
  await install.click();
  await expect.poll(() => call(app, "spawnedForTests")).toEqual(["xcode-select --install"]);
  expect(await call(app, "openedForTests")).toEqual([]);
  // Looks good makes the library all the same: no repository, and nothing that would have run git.
  await setup.getByRole("button", { name: "Looks good" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  const library = path.join(home, "Avanzel");
  expect(existsSync(path.join(library, ".avanzel", "config.toml"))).toBe(true);
  expect(loadSettings(library).harness).toBe("claude");
  expect(existsSync(path.join(library, ".git"))).toBe(false);
  expect((await settingsSnap(app)).library).toMatchObject({ path: library, isGit: false });
  await app.close();
});

test("a folder with files, on a Mac without git, says so too, and Use this folder keeps them and makes no repository", async () => {
  const { env, home } = firstRun();
  const library = path.join(home, "Avanzel");
  const notes = "# Notes\n\nPlant tulips in October.\n";
  mkdirSync(library);
  writeFileSync(path.join(library, "notes.md"), notes);
  const app = await launch({ ...env, AVANZEL_GIT_USABLE: "0" });
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(
    setup.getByText(`This folder has files already. I'll add the shelves and an AGENTS.md for your agent. ${NO_GIT}`, { exact: true }),
  ).toBeVisible();
  await expect(setup.getByText(HAS_FILES)).toHaveCount(0);
  await expect(setup.getByRole("button", { name: "Install git" })).toHaveAttribute("data-variant", "secondary");
  await setup.getByRole("button", { name: "Use this folder" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  expect(readFileSync(path.join(library, "notes.md"), "utf8")).toBe(notes);
  expect(existsSync(path.join(library, ".avanzel", "config.toml"))).toBe(true);
  expect(existsSync(path.join(library, ".git"))).toBe(false);
  await app.close();
});

test("a library made already says nothing of git, on a Mac that has none, and offers nothing to install", async () => {
  const { env, home } = firstRun();
  await Vault.init(path.join(home, "Avanzel"), { git: false });
  const app = await launch({ ...env, AVANZEL_GIT_USABLE: "0" });
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("This folder is already an Avanzel library.")).toBeVisible();
  expect((await setupSnap(app)).gitUsable).toBe(false);
  await expect(setup.getByText(NO_GIT)).toHaveCount(0);
  await expect(setup.getByRole("button", { name: "Install git" })).toHaveCount(0);
  await app.close();
});

test("Found notices git once the window has the focus again after the install, and the library then keeps its history", async () => {
  const { env, home } = firstRun();
  const app = await launch({ ...env, AVANZEL_GIT_USABLE: "0" });
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText(`A new library: Markdown files. ${NO_GIT}`, { exact: true })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Install git" })).toBeVisible();
  // Everything Set me up started has ended (the agents' sign-ins are read, the model download has failed), so nothing else
  // sends the window a new snapshot: only the focus can tell it git is there.
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(2, { timeout: 20_000 });
  await expect(setup.getByText("The speech model didn't finish downloading.")).toBeVisible();
  // The person installed the tools from Apple's dialog (here: the test override is dropped, and this Mac's own git is read)
  // and comes back: the window has the focus again, and git is looked for afresh.
  await app.evaluate(({ BrowserWindow }) => {
    delete process.env.AVANZEL_GIT_USABLE;
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/setup/"))?.emit("focus");
  });
  await expect(setup.getByText("A new library: Markdown files with git history.", { exact: true })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Install git" })).toHaveCount(0);
  expect((await setupSnap(app)).gitUsable).toBe(true);
  await expect.poll(async () => (await setupSnap(app)).agent, { timeout: 20_000 }).toBe("claude");
  await setup.getByRole("button", { name: "Looks good" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  expect(gitOut(path.join(home, "Avanzel"), "log", "--format=%s")).toContain("avanzel: new library");
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

test("a folder too broad for a library, such as ~/Documents, says so, and nothing is made there", async () => {
  const { env, home } = firstRun();
  const documents = path.join(home, "Documents");
  mkdirSync(documents);
  writeFileSync(path.join(documents, "taxes.pdf"), "%PDF-1.7\n");
  const app = await launch(env);
  await stubPicker(app, documents);
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect.poll(async () => (await setupSnap(app)).agent, { timeout: 20_000 }).toBe("claude");
  await setup.getByRole("button", { name: "Change…" }).click();
  await expect(setup.getByText("~/Documents is too broad for a library. Choose or make a folder inside it.", { exact: true })).toBeVisible();
  await expect(setup.getByText(HAS_FILES)).toHaveCount(0);
  await expect(setup.getByRole("button", { name: "Use this folder" })).toBeDisabled();
  // Nor does the controller make one there when asked.
  expect(((await call(app, "createSetupLibrary")) as SetupSnapshot).libraryReady).toBe(false);
  expect(readdirSync(documents)).toEqual(["taxes.pdf"]);
  // A folder inside it is a library's place like any other.
  const inside = path.join(documents, "Avanzel");
  await stubPicker(app, inside);
  await setup.getByRole("button", { name: "Change…" }).click();
  await expect(setup.getByText("A new library: Markdown files with git history.", { exact: true })).toBeVisible();
  await setup.getByRole("button", { name: "Looks good" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  expect((await settingsSnap(app)).library?.path).toBe(inside);
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
  // Zel looks over at the step, worried while the problem needs the person.
  const zelOnStage = setup.locator("svg[data-mood]");
  await expect(zelOnStage).toHaveAttribute("data-mood", "needs-you");
  await expect(zelOnStage).toHaveAttribute("data-look", "right");
  await snap(setup, "setup-found-problem");
  await change.click();
  await expect(notice).toHaveCount(0);
  await expect(zelOnStage).toHaveAttribute("data-mood", "idle");
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
