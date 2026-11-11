// Avanzel's own updates, as a person sees them: the Updates group in Settings → General, and the panel's foot while an update is
// ready. The updater runs on the stand-in for electron-updater (AVANZEL_FAKE_UPDATES=1), and each test sends what the feed would
// answer through updateEventForTests. Only the last test runs electron-updater itself, on a feed served here: no test reaches github.com.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import { appDir, call, capsuleKind, launch, makeLibrary, openSettings, settingsRow, snap, speechWav, windowFor } from "./helpers.ts";

/** The version the app under test runs, as its package says: what Settings names. */
const VERSION = (JSON.parse(readFileSync(path.join(appDir, "package.json"), "utf8")) as { version: string }).version;
const NEXT = "9.9.9";

/** A launch with the stand-in for electron-updater, whose first automatic look comes only when a test asks for it. */
const launchWithUpdates = (env: Record<string, string> = {}) =>
  launch({ AVANZEL_FAKE_UPDATES: "1", AVANZEL_UPDATE_FIRST_CHECK_MS: String(60 * 60 * 1000), ...env });

const snapshot = async (app: ElectronApplication) => (await call(app, "snapshot")) as SettingsSnapshot;

type Engine = { checks: number; installs: number; feed: unknown; autoDownload: boolean; autoInstallOnAppQuit: boolean; allowPrerelease: boolean; allowDowngrade: boolean };
const engine = async (app: ElectronApplication) => (await call(app, "updateEngineForTests")) as Engine;
const checks = async (app: ElectronApplication) => (await engine(app)).checks;
const installs = async (app: ElectronApplication) => (await engine(app)).installs;
const send = (app: ElectronApplication, event: string, value?: unknown) => call(app, "updateEventForTests", event, value);

/** The Updates row: Avanzel's version, the line under it, and its button. */
const updatesRow = (settings: Page) => settingsRow(settings, `Avanzel ${VERSION}`);

/** HH:MM in this Mac's time, as the line says when the feed answered. */
const clockOf = (iso: string) => {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
};

/** With AVANZEL_E2E_SHOTS=1, a picture of `page` in dark mode as well, for people (snap); the page goes back to light after, as Playwright starts it. */
async function shotInDark(page: Page, name: string): Promise<void> {
  if (process.env.AVANZEL_E2E_SHOTS !== "1") return;
  await page.emulateMedia({ colorScheme: "dark" });
  await snap(page, name);
  await page.emulateMedia({ colorScheme: "light" });
}

test("a build that doesn't check for updates names its version and says so, with nothing to press", async () => {
  const app = await launch({});
  const settings = await openSettings(app);
  const row = updatesRow(settings);
  await expect(row).toBeVisible();
  await expect(row.getByText("This build doesn't check for updates.", { exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Check now" })).toHaveCount(0);
  // Nor a switch that would promise checks the build doesn't make, though the setting itself is kept, on.
  await expect(settings.getByRole("switch", { name: "Check for updates automatically" })).toHaveCount(0);
  expect((await snapshot(app)).app.checkForUpdates).toBe(true);
  // The group sits after "After you speak" and before Startup, as Software Update comes before Login Items on a Mac.
  expect(await settings.getByRole("heading", { level: 3 }).allTextContents()).toEqual(expect.arrayContaining(["Updates", "Startup"]));
  const headings = await settings.getByRole("heading", { level: 3 }).allTextContents();
  expect(headings.indexOf("Updates")).toBe(headings.indexOf("Startup") - 1);
  expect((await snapshot(app)).update).toEqual({ version: VERSION, status: { kind: "off" }, checkedAt: null });
  expect(await call(app, "updateEngineForTests")).toBeNull();
  await app.close();
});

test("Check now says it is checking, then that Avanzel is up to date and when it checked", async () => {
  const app = await launchWithUpdates();
  const settings = await openSettings(app);
  const row = updatesRow(settings);
  await expect(row.getByText("Not checked yet.", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Check now" }).click();
  await expect(row.getByText("Checking for updates…", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Check now" })).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => checks(app)).toBe(1);
  // The updater set electron-updater up for Avanzel's own releases: full ones only, never an older one, downloaded by itself.
  expect(await engine(app)).toMatchObject({
    feed: { provider: "github", owner: "Spar9a", repo: "Avanzel" },
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: false,
  });
  await send(app, "update-not-available", { version: VERSION });
  const checkedAt = (await snapshot(app)).update.checkedAt;
  expect(checkedAt).not.toBeNull();
  await expect(row.getByText(`Up to date. Checked today at ${clockOf(checkedAt!)}.`, { exact: true })).toBeVisible();
  await snap(settings, "updates-current");
  await expect(row.getByRole("button", { name: "Check now" })).not.toHaveAttribute("aria-busy", "true");
  // Once the person has asked, a screen reader hears the line as it changes.
  await expect(row.getByRole("status")).toContainText("Up to date.");
  await app.close();
});

test("an update downloads in the background with its progress, and Restart to update restarts at once while nothing is in progress", async () => {
  const app = await launchWithUpdates();
  const settings = await openSettings(app);
  const row = updatesRow(settings);
  await row.getByRole("button", { name: "Check now" }).click();
  await expect.poll(() => checks(app)).toBe(1);
  await send(app, "update-available", { version: NEXT });
  await expect(row.getByText(`Downloading Avanzel ${NEXT}…`, { exact: true })).toBeVisible();
  const bar = row.getByRole("progressbar", { name: "Downloading the update" });
  await expect(bar).toHaveAttribute("aria-valuenow", "0");
  await send(app, "download-progress", { percent: 42.7 });
  await expect(bar).toHaveAttribute("aria-valuenow", "42");
  await expect(row.getByText("42%", { exact: true })).toBeVisible();
  await snap(settings, "updates-downloading");
  await send(app, "update-downloaded", { version: NEXT });
  await expect(row.getByText(`Avanzel ${NEXT} is ready. It installs when you quit Avanzel.`, { exact: true })).toBeVisible();
  const restart = row.getByRole("button", { name: "Restart to update" });
  // A secondary: an update is never urgent, and the pane's one primary belongs to its Notices (here Set up Avanzel…).
  await expect(restart).toHaveAttribute("data-variant", "secondary");
  await snap(settings, "updates-ready");
  await shotInDark(settings, "updates-ready-dark");
  await restart.click();
  await expect.poll(() => installs(app)).toBe(1);
  await expect(row.getByText("Restarting…", { exact: true })).toBeVisible();
  await expect(restart).toHaveAttribute("aria-busy", "true");
  await app.close();
});

test("Restart to update during a recording says it waits for it, and restarts once the recording is given up", async () => {
  const app = await launchWithUpdates({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_AUDIO: speechWav("hello") });
  const settings = await openSettings(app);
  const row = updatesRow(settings);
  await row.getByRole("button", { name: "Check now" }).click();
  await expect.poll(() => checks(app)).toBe(1);
  await send(app, "update-available", { version: NEXT });
  await send(app, "update-downloaded", { version: NEXT });
  const restart = row.getByRole("button", { name: "Restart to update" });
  await expect(restart).toBeVisible();
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await restart.click();
  await expect(row.getByText("Avanzel restarts once the recording ends. Nothing is lost.", { exact: true })).toBeVisible();
  await snap(settings, "updates-waiting");
  // While it waits, the way out is Not now, a quiet one, in Restart to update's place.
  await expect(row.getByRole("button", { name: "Not now" })).toHaveAttribute("data-variant", "quiet");
  await expect(restart).toHaveCount(0);
  expect((await snapshot(app)).update.status).toEqual({ kind: "ready", version: NEXT, waitingFor: "recording", restarting: false });
  expect(await installs(app)).toBe(0);
  // Esc gives the recording up (through the shortcut stand-in, so no real Esc is taken from this Mac): nothing is in progress then.
  await expect.poll(() => call(app, "pressShortcutForTests", "Escape")).toBe(true);
  await expect.poll(() => capsuleKind(app)).not.toBe("listening");
  await expect.poll(() => installs(app), { timeout: 15_000 }).toBe(1);
  await expect(row.getByText("Restarting…", { exact: true })).toBeVisible();
  await expect(restart).toHaveAttribute("aria-busy", "true");
  await app.close();
});

test("a check that fails says Avanzel couldn't check and will try again later, and Try again asks again", async () => {
  const app = await launchWithUpdates();
  const settings = await openSettings(app);
  const row = updatesRow(settings);
  await row.getByRole("button", { name: "Check now" }).click();
  await expect.poll(() => checks(app)).toBe(1);
  await send(app, "error", "net::ERR_INTERNET_DISCONNECTED");
  await expect(row.getByText("Avanzel couldn't check for updates. It will try again later.", { exact: true })).toBeVisible();
  await snap(settings, "updates-problem");
  await expect(row.getByRole("button", { name: "Check now" })).toHaveCount(0);
  await row.getByRole("button", { name: "Try again" }).click();
  await expect(row.getByText("Checking for updates…", { exact: true })).toBeVisible();
  await expect.poll(() => checks(app)).toBe(2);
  await send(app, "update-not-available", { version: VERSION });
  await expect(row.getByText(/^Up to date\. Checked today at \d\d:\d\d\.$/)).toBeVisible();
  await app.close();
});

test("Avanzel looks by itself until the switch is turned off, which is kept, and Check now works either way", async () => {
  // On by default: the first automatic look comes by itself.
  const app = await launchWithUpdates({ AVANZEL_UPDATE_FIRST_CHECK_MS: "300" });
  await expect.poll(() => checks(app), { timeout: 15_000 }).toBe(1);
  const settings = await openSettings(app);
  await expect(updatesRow(settings).getByText("Checking for updates…", { exact: true })).toBeVisible();
  const automatic = settings.getByRole("switch", { name: "Check for updates automatically" });
  await expect(automatic).toHaveAttribute("aria-checked", "true");
  await automatic.click();
  await expect.poll(async () => (await snapshot(app)).app.checkForUpdates).toBe(false);
  await app.close();

  // Off, as a person left it: kept in the settings, and no automatic look in the time one would come.
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ version: 1, checkForUpdates: false }));
  const off = await launchWithUpdates({ AVANZEL_USER_DATA: userData, AVANZEL_UPDATE_FIRST_CHECK_MS: "300" });
  const offSettings = await openSettings(off);
  const offSwitch = offSettings.getByRole("switch", { name: "Check for updates automatically" });
  await expect(offSwitch).toHaveAttribute("aria-checked", "false");
  await new Promise((resolve) => setTimeout(resolve, 2_000)); // well past the first look's 300 ms: nothing may come
  expect(await checks(off)).toBe(0);
  await expect(updatesRow(offSettings).getByText("Not checked yet.", { exact: true })).toBeVisible();
  await updatesRow(offSettings).getByRole("button", { name: "Check now" }).click();
  await expect.poll(() => checks(off)).toBe(1);
  // While it is off, a problem promises no try of its own.
  await send(off, "error", "net::ERR_INTERNET_DISCONNECTED");
  await expect(updatesRow(offSettings).getByText("Avanzel couldn't check for updates. Nothing has changed.", { exact: true })).toBeVisible();
  // Turned on again, and kept.
  await offSwitch.click();
  await expect.poll(async () => (await snapshot(off)).app.checkForUpdates).toBe(true);
  expect((JSON.parse(readFileSync(path.join(userData, "settings.json"), "utf8")) as { checkForUpdates: boolean }).checkForUpdates).toBe(true);
  await off.close();
});

test("the panel's foot shows an update that is ready, beside Quit Avanzel, and Not now calls off a restart that waits for a recording", async () => {
  const app = await launchWithUpdates({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_AUDIO: speechWav("hello") });
  // The e2e tests drive the menu, so the icon opens no panel here: the controller brings it up as a click on the icon would.
  await call(app, "showPanel", "library");
  const panel = await windowFor(app, "panel");
  const foot = panel.getByRole("contentinfo");
  await expect(foot.getByRole("button", { name: "Quit Avanzel" })).toBeVisible();
  // Nothing is said while nothing is ready.
  await expect(foot.getByRole("button", { name: "Restart to update" })).toHaveCount(0);
  await call(app, "checkForUpdates");
  await send(app, "update-available", { version: NEXT });
  await send(app, "download-progress", { percent: 50 });
  await expect(foot.getByRole("button", { name: "Restart to update" })).toHaveCount(0);
  await send(app, "update-downloaded", { version: NEXT });
  await expect(foot.getByText(`Avanzel ${NEXT} is ready.`, { exact: true })).toBeVisible();
  const restart = foot.getByRole("button", { name: "Restart to update" });
  // Calm: a secondary beside the quiet ones, never the panel's primary.
  await expect(restart).toHaveAttribute("data-variant", "secondary");
  // The line starts where Open library's sign does under it.
  const line = await foot.getByText(`Avanzel ${NEXT} is ready.`, { exact: true }).boundingBox();
  const openLibrary = await foot.getByRole("button", { name: "Open library" }).locator("svg").boundingBox();
  expect(Math.abs(line!.x - openLibrary!.x)).toBeLessThanOrEqual(2);
  await snap(panel, "panel-update-ready");
  await shotInDark(panel, "panel-update-ready-dark");
  // On the Settings tab, General's Updates group makes the offer, so the foot doesn't make it twice.
  await panel.getByRole("tab", { name: "Settings", exact: true }).click();
  await expect(panel.getByText(`Avanzel ${NEXT} is ready. It installs when you quit Avanzel.`, { exact: true })).toBeVisible();
  await expect(foot.getByRole("button", { name: "Restart to update" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Restart to update" })).toHaveCount(1);
  await panel.getByRole("tab", { name: /^Library/ }).click(); // its name goes on with how many notes it lists
  await expect(restart).toBeVisible();
  // Pressed during a recording, the restart waits for it, and Not now calls it off: once the recording is given up, nothing restarts.
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await restart.click();
  await expect(foot.getByText("Avanzel restarts once the recording ends. Nothing is lost.", { exact: true })).toBeVisible();
  await snap(panel, "panel-update-waiting");
  const notNow = foot.getByRole("button", { name: "Not now" });
  await expect(notNow).toHaveAttribute("data-variant", "quiet");
  await notNow.click();
  await expect(foot.getByText(`Avanzel ${NEXT} is ready.`, { exact: true })).toBeVisible();
  await expect.poll(() => call(app, "pressShortcutForTests", "Escape")).toBe(true);
  await expect.poll(() => capsuleKind(app)).not.toBe("listening");
  await new Promise((resolve) => setTimeout(resolve, 3_000)); // past the two looks a waiting restart takes once the work ends
  expect(await installs(app)).toBe(0);
  // Asked again with nothing in progress, it restarts at once.
  await restart.click();
  await expect.poll(() => installs(app)).toBe(1);
  await expect(foot.getByText("Restarting…", { exact: true })).toBeVisible();
  await app.close();
});

/** Servers this file started, closed after each test. */
const servers = new Set<Server>();
test.afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))));
  servers.clear();
});

/** A feed of electron-updater's generic kind, served here: latest-mac.yml says the newest version is `version`. It keeps the paths asked for. */
async function genericFeed(version: string): Promise<{ url: string; asked: string[] }> {
  const asked: string[] = [];
  const server = createServer((req, res) => {
    asked.push((req.url ?? "").split("?")[0]!);
    if ((req.url ?? "").startsWith("/latest-mac.yml")) {
      const zip = `Avanzel-${version}-arm64-mac.zip`;
      const sha512 = Buffer.alloc(64).toString("base64");
      res.writeHead(200, { "content-type": "text/yaml" });
      res.end(`version: ${version}\nfiles:\n  - url: ${zip}\n    sha512: ${sha512}\n    size: 1\npath: ${zip}\nsha512: ${sha512}\nreleaseDate: '2026-11-11T00:00:00.000Z'\n`);
      return;
    }
    res.writeHead(404).end();
  });
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, asked };
}

test("electron-updater itself, on a feed AVANZEL_UPDATE_FEED names, finds the version that runs and says Avanzel is up to date", async () => {
  const feed = await genericFeed(VERSION);
  const app = await launch({ AVANZEL_UPDATE_FEED: feed.url, AVANZEL_UPDATE_FIRST_CHECK_MS: String(60 * 60 * 1000) });
  const settings = await openSettings(app);
  const row = updatesRow(settings);
  await expect(row.getByText("Not checked yet.", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Check now" }).click();
  await expect(row.getByText(/^Up to date\. Checked today at \d\d:\d\d\.$/)).toBeVisible({ timeout: 20_000 });
  expect(feed.asked).toContain("/latest-mac.yml");
  expect((await snapshot(app)).update.status).toEqual({ kind: "current" });
  await app.close();
});
