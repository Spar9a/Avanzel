// The setup window: a Mac with no library opens it instead of Settings, and Zel walks the person through the first
// run there. Every test launches as a first run (firstRun): a new HOME, an empty Hugging Face cache, and only the
// stand-ins for Claude Code and Codex on PATH.
import { expect, test, type ElectronApplication } from "@playwright/test";
import type { MenuItemModel } from "../src/main/menu-model.ts";
import { call, capsuleKind, firstRun, launch, snap, windowFor } from "./helpers.ts";

/** Whether a window of renderer `page` (say "setup") is on screen. */
const shown = (app: ElectronApplication, page: string) =>
  app.evaluate(
    ({ BrowserWindow }, name) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes(`/renderer/${name}/`) && w.isVisible()),
    page,
  );

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
