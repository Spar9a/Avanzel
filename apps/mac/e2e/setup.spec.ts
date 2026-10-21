// The setup window: a Mac with no library opens it instead of Settings, and Zel walks the person through the first
// run there. Every test launches as a first run (firstRun): a new HOME, an empty Hugging Face cache, and only the
// stand-ins for Claude Code and Codex on PATH.
import { expect, test, type ElectronApplication } from "@playwright/test";
import path from "node:path";
import type { MenuItemModel } from "../src/main/menu-model.ts";
import type { SetupSnapshot } from "../src/shared/ipc.ts";
import { agentCalls, call, capsuleKind, closeModelHubs, fakeModelHub, firstRun, launch, snap, windowFor } from "./helpers.ts";

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

/** A `claude` that is installed but not signed in: its sign-in command says so, as Claude Code's does. */
const SIGNED_OUT_CLAUDE = `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": false}'; exit 1; else echo ready; fi`;

/** A `claude` whose sign-in command prints nothing a check understands, as an older Claude Code may. */
const UNREADABLE_CLAUDE = `if [ "$1 $2" = "auth status" ]; then echo "unknown command: auth"; exit 1; else echo ready; fi`;

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
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("Signed in", { exact: true })).toHaveCount(2, { timeout: 20_000 });
  await expect(setup.getByText("~/Avanzel", { exact: true })).toBeVisible();
  await expect(setup.getByText("A new library: Markdown files with git history.")).toBeVisible();
  await expect(setup.getByText("Best results")).toBeVisible();
  await expect(setup.getByText("Your agent works only inside the library folder: no shell, no web.")).toBeVisible();
  await expect(setup.getByRole("button", { name: "Use Codex" })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Use Claude Code" })).toHaveCount(0);
  await expect(setup.getByRole("img", { name: "Chosen" })).toHaveCount(1);
  expect((await setupSnap(app)).agent).toBe("claude");
  // Only the sign-in commands ran: the stand-ins note every call, and no prompt was sent.
  expect((await agentCalls(app)).sort()).toEqual(["claude auth status", "codex login status"]);
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
  const useClaude = setup.getByRole("button", { name: "Use Claude Code" });
  await expect(useClaude).toBeVisible();
  // The person's pick wins over the best agent, and only an installed agent can be picked.
  await useClaude.click();
  await expect(setup.getByRole("button", { name: "Use Codex" })).toBeVisible();
  expect((await setupSnap(app)).agent).toBe("claude");
  await call(app, "chooseSetupAgent", "gemini");
  expect((await setupSnap(app)).agent).toBe("claude");
  expect((await agentCalls(app)).sort()).toEqual(["claude auth status", "codex login status"]);
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
