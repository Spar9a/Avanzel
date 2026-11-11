// Avanzel's own updates, from the GitHub Releases of Spar9a/Avanzel, through electron-updater. It looks 30 s after launch and every
// 6 hours after (while the person lets it: AppSettings.checkForUpdates), and whenever asked (Check now, Try again). What it finds
// downloads in the background, and installs when Avanzel quits, or at once on Restart to update, which waits while something is in
// progress (the host's `busy`): nothing is cut short. Full releases only, never an older version.
//
// It is off in a development build and with AVANZEL_TEST=1, so no test reaches github.com, unless AVANZEL_UPDATE_FEED names a feed of
// electron-updater's generic kind (a folder served over http, with latest-mac.yml in it), for local proofs and tests. The e2e tests
// can run it on a stand-in for electron-updater instead (AVANZEL_FAKE_UPDATES=1, `StandInEngine`). The controller is its host.
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { UpdateSnapshot, UpdateStatus, UpdateWait } from "../shared/ipc.ts";

/** Where the updates are: this repository's GitHub Releases. */
export const UPDATE_REPO = { owner: "Spar9a", repo: "Avanzel" } as const;
/** The first automatic check, this long after launch. */
export const FIRST_CHECK_MS = 30_000;
/** The automatic checks after the first, this long after the last check began. Counted by the clock: a Mac that slept through one checks soon after it wakes. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** How often the updater looks whether an automatic check is due. */
export const DUE_LOOK_MS = 60_000;
/** While a restart to update waits for work in progress, how often it looks whether the work has ended… */
export const WAIT_LOOK_MS = 1_000;
/** …and how many looks in a row must find nothing in progress: work that hands over to more work (a recording to its words, to its filing) has a moment between. */
export const QUIET_LOOKS = 2;
/** The folder under ~/Library/Caches where electron-updater keeps what it downloads. */
export const CACHE_DIR_NAME = "avanzel-updater";
/** The file in the app's data folder that tells electron-updater the feed and that folder (`feedFile`). */
export const FEED_FILE = "update-feed.yml";

/** A feed of updates, as electron-updater takes one: Avanzel's GitHub Releases, or a folder served over http (AVANZEL_UPDATE_FEED). */
export type UpdateFeed = { provider: "github"; owner: string; repo: string } | { provider: "generic"; url: string };

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The feed this run reads, or null when it looks for no updates. AVANZEL_UPDATE_FEED's generic feed when it names an http(s) address,
 * in any build; none when it names anything else. Without it: none in a development build (`packaged` false) or with AVANZEL_TEST=1,
 * and Avanzel's GitHub Releases otherwise.
 */
export function updateFeed(env: Env, packaged: boolean): UpdateFeed | null {
  const url = env.AVANZEL_UPDATE_FEED?.trim();
  if (url) return isWebAddress(url) ? { provider: "generic", url } : null;
  if (!packaged || env.AVANZEL_TEST === "1") return null;
  return { provider: "github", ...UPDATE_REPO };
}

function isWebAddress(text: string): boolean {
  try {
    const { protocol } = new URL(text);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** What the updater uses of electron-updater's autoUpdater (its `AppUpdater`). The tests hand it a stand-in. */
export interface UpdateEngine {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  forceDevUpdateConfig: boolean;
  logger: { info(message?: unknown): void; warn(message?: unknown): void; error(message?: unknown): void } | null;
  /** The file electron-updater reads its feed's settings from, the cache folder's name among them, in place of the app's own. */
  updateConfigPath: string | null;
  setFeedURL(feed: UpdateFeed): void;
  /** Asks the feed. The answer comes as events; null when electron-updater skipped the check. */
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-available" | "update-not-available" | "update-downloaded", listener: (info: { version: string }) => void): unknown;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/** electron-updater's own autoUpdater, loaded only when the updater is first needed: a run that looks for no updates never loads it. */
export async function electronUpdater(): Promise<UpdateEngine> {
  const { autoUpdater } = await import("electron-updater");
  return autoUpdater;
}

/**
 * For the e2e tests only (AVANZEL_TEST=1 with AVANZEL_FAKE_UPDATES=1): a stand-in for electron-updater that asks no feed. Its checks and
 * installs are only counted, and what the feed would answer is sent by the test (`emit`, through the controller's updateEventForTests).
 */
export class StandInEngine extends EventEmitter implements UpdateEngine {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  allowDowngrade = true;
  forceDevUpdateConfig = false;
  logger: UpdateEngine["logger"] = null;
  updateConfigPath: string | null = null;
  feed: UpdateFeed | null = null;
  checks = 0;
  installs = 0;

  setFeedURL(feed: UpdateFeed): void {
    this.feed = feed;
  }

  checkForUpdates(): Promise<unknown> {
    this.checks += 1;
    this.emit("checking-for-update");
    return Promise.resolve({ standIn: true });
  }

  quitAndInstall(): void {
    this.installs += 1;
  }
}

/** What the updater asks of the app. */
export interface UpdaterHost {
  /** The running app's version: app.getVersion(). */
  readonly version: string;
  /** Whether the person lets Avanzel look by itself (AppSettings.checkForUpdates), as it is now. */
  automatic(): boolean;
  /** The work in progress that a restart now would cut short, the most pressing first; null when there is none. */
  busy(): UpdateWait | null;
  /** The status changed: Settings and the panel show it again. */
  changed(): void;
  /**
   * A restart to update that had begun failed. Electron closes every window before it hands over to macOS's updater, so the capsule's
   * may be gone with the rest, and the app has to quit as a closed capsule makes it quit.
   */
  restartFailed(): void;
}

export interface UpdaterOptions {
  /** The feed (`updateFeed`); null leaves the updater off for the whole run. */
  feed: UpdateFeed | null;
  /** Whether this is the packaged app: electron-updater checks for a development run only when it is told to. */
  packaged: boolean;
  /** The app's own data folder, where the feed's file for electron-updater goes (`FEED_FILE`). */
  dataDir: string;
  /** Makes the engine, once, when it is first needed. */
  engine: () => UpdateEngine | Promise<UpdateEngine>;
  /** How long after `start` the first automatic check comes (FIRST_CHECK_MS). */
  firstCheckMs?: number;
  now?: () => number;
  /** The e2e tests' stand-in, which `engine` makes; the controller's test methods drive it. */
  standIn?: StandInEngine;
}

/**
 * The options for this run's updater: its feed (`updateFeed`) and electron-updater. With AVANZEL_TEST=1 and AVANZEL_FAKE_UPDATES=1, the e2e
 * tests' stand-in on Avanzel's own feed instead, so the updater is on as in the packaged app, and AVANZEL_UPDATE_FIRST_CHECK_MS moves its first
 * automatic check (a test that sees one comes soon, the others never).
 */
export function updaterOptions(env: Env, packaged: boolean, dataDir: string): UpdaterOptions {
  const testing = env.AVANZEL_TEST === "1";
  const firstCheck = testing ? Number(env.AVANZEL_UPDATE_FIRST_CHECK_MS) : NaN;
  const firstCheckMs = Number.isFinite(firstCheck) && firstCheck >= 0 ? firstCheck : FIRST_CHECK_MS;
  if (testing && env.AVANZEL_FAKE_UPDATES === "1") {
    const standIn = new StandInEngine();
    return { feed: { provider: "github", ...UPDATE_REPO }, packaged: true, dataDir, engine: () => standIn, firstCheckMs, standIn };
  }
  const feed = updateFeed(env, packaged);
  if (!feed && env.AVANZEL_UPDATE_FEED?.trim()) console.warn("updates", `AVANZEL_UPDATE_FEED is not an http(s) address, so Avanzel looks for no updates: ${env.AVANZEL_UPDATE_FEED}`);
  return { feed, packaged, dataDir, engine: electronUpdater, firstCheckMs };
}

/**
 * Writes what electron-updater reads of a feed besides the feed itself (set in code, `setFeedURL`): the folder its downloads go in. It
 * would read that from the app's Resources/app-update.yml, which only a build with a `publish` block has, and a download fails without
 * it. JSON is YAML. Returns the file, or null when it couldn't be written: checks work all the same.
 */
export function feedFile(dataDir: string, feed: UpdateFeed): string | null {
  const file = path.join(dataDir, FEED_FILE);
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ ...feed, updaterCacheDirName: CACHE_DIR_NAME }, null, 2)}\n`);
    return file;
  } catch (error) {
    console.error("updates", error);
    return null;
  }
}

/** electron-updater's own lines, in the app's log as the app's are. Its failures are logged by the updater, once, as they reach it. */
const ENGINE_LOG: NonNullable<UpdateEngine["logger"]> = {
  info: (message) => console.log("updates", message),
  warn: (message) => console.warn("updates", message),
  error: () => undefined,
};

/** Avanzel's own update: what it is (`snapshot`), when to look, and the restart. */
export class Updater {
  private status: UpdateStatus;
  /** When the feed last answered, in this app run. */
  private checkedAt: number | null = null;
  /** When `start` ran, and when the last check began: what makes an automatic check due. */
  private startedAt: number | null = null;
  private lastCheck: number | null = null;
  /** The engine once it is made and set up (`engine`), and the making of it. */
  private loaded: UpdateEngine | null = null;
  private loading: Promise<UpdateEngine> | null = null;
  private readonly timers: NodeJS.Timeout[] = [];
  /** While a restart waits for work in progress: the look every WAIT_LOOK_MS, and how many looks in a row found none. */
  private waitTimer: NodeJS.Timeout | null = null;
  private quietLooks = 0;
  /** The restart has begun: the engine was told to quit and install. */
  private begun = false;
  private readonly now: () => number;

  constructor(
    private readonly host: UpdaterHost,
    private readonly options: UpdaterOptions,
  ) {
    this.status = options.feed ? { kind: "idle" } : { kind: "off" };
    this.now = options.now ?? Date.now;
  }

  /** What Settings and the panel show. */
  snapshot(): UpdateSnapshot {
    return { version: this.host.version, status: this.status, checkedAt: this.checkedAt === null ? null : new Date(this.checkedAt).toISOString() };
  }

  /** A restart to update has begun: Avanzel is about to quit, and macOS's updater opens it again on the update. */
  get restarting(): boolean {
    return this.begun;
  }

  /** The e2e tests' stand-in for electron-updater, when this run has one. */
  get standIn(): StandInEngine | null {
    return this.options.standIn ?? null;
  }

  /** Begins looking by itself: the first look FIRST_CHECK_MS after now, then every 6 hours. Nothing when off. */
  start(): void {
    if (!this.options.feed || this.startedAt !== null) return;
    this.startedAt = this.now();
    this.timers.push(
      setTimeout(() => this.checkIfDue(), this.options.firstCheckMs ?? FIRST_CHECK_MS),
      setInterval(() => this.checkIfDue(), DUE_LOOK_MS),
    );
  }

  /** Stops every timer: no look, no restart that waits. */
  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.length = 0;
    this.stopWaiting();
  }

  /** An automatic check is due: the person lets Avanzel look, nothing is under way or ready, and the time has come. */
  private due(): boolean {
    if (this.startedAt === null || !this.host.automatic()) return false;
    const { kind } = this.status;
    if (kind !== "idle" && kind !== "current" && kind !== "problem") return false;
    const elapsed = this.now() - (this.lastCheck ?? this.startedAt);
    return elapsed >= (this.lastCheck === null ? (this.options.firstCheckMs ?? FIRST_CHECK_MS) : CHECK_EVERY_MS);
  }

  private checkIfDue(): void {
    if (this.due()) void this.check();
  }

  /**
   * Check now, Try again, or an automatic check that is due: the feed is asked, unless the updater is off, or a check, a download or an
   * update that is ready is under way already. The answer comes as the engine's events (`listen`).
   */
  async check(): Promise<void> {
    const kind = this.kind();
    if (kind === "off" || kind === "checking" || kind === "downloading" || kind === "ready") return;
    this.lastCheck = this.now();
    this.set({ kind: "checking" });
    try {
      const engine = await this.engine();
      const result = await engine.checkForUpdates();
      // A download that fails is told by an "error" event as well; its promise is let go, so its failure isn't an unhandled one.
      const download = (result as { downloadPromise?: Promise<unknown> | null } | null)?.downloadPromise;
      void download?.catch(() => undefined);
      if (result == null && this.kind() === "checking") {
        console.warn("updates", "electron-updater skipped the check");
        this.set({ kind: "idle" });
      }
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * Restart to update, while an update is ready: Avanzel quits and opens again on it, at once, or, while something is in progress, once
   * that has ended (`waitingFor` says what it waits for). A second press changes nothing.
   */
  restart(): void {
    const status = this.status;
    if (status.kind !== "ready" || status.restarting || status.waitingFor !== null) return;
    const busy = this.host.busy();
    if (busy === null) return this.begin();
    this.quietLooks = 0;
    this.set({ ...status, waitingFor: busy });
    this.waitTimer = setInterval(() => this.lookAgain(), WAIT_LOOK_MS);
  }

  /** While a restart waits: what is in progress now, and the restart once nothing has been for QUIET_LOOKS looks in a row. */
  private lookAgain(): void {
    const status = this.status;
    if (status.kind !== "ready") return this.stopWaiting();
    const busy = this.host.busy();
    if (busy !== null) {
      this.quietLooks = 0;
      if (busy !== status.waitingFor) this.set({ ...status, waitingFor: busy });
      return;
    }
    this.quietLooks += 1;
    if (this.quietLooks >= QUIET_LOOKS) this.begin();
  }

  private stopWaiting(): void {
    if (this.waitTimer) clearInterval(this.waitTimer);
    this.waitTimer = null;
    this.quietLooks = 0;
  }

  /**
   * The restart itself: Settings and the panel say it has begun, and in the next turn the engine quits Avanzel, installs the update and
   * opens it again. The turn between lets the call that asked for it answer first.
   */
  private begin(): void {
    this.stopWaiting();
    const status = this.status;
    const engine = this.loaded;
    if (status.kind !== "ready" || !engine) return;
    this.begun = true;
    this.set({ ...status, waitingFor: null, restarting: true });
    setImmediate(() => {
      try {
        engine.quitAndInstall();
      } catch (error) {
        this.fail(error);
      }
    });
  }

  /** The engine, made and set up the first time it is needed. One that couldn't be made throws, and is tried again the next time. */
  private async engine(): Promise<UpdateEngine> {
    if (this.loaded) return this.loaded;
    this.loading ??= this.load();
    try {
      return await this.loading;
    } catch (error) {
      this.loading = null;
      throw error;
    }
  }

  /** Makes the engine and sets it up: what it does by itself, the feed, and what the updater hears of it (`listen`). */
  private async load(): Promise<UpdateEngine> {
    const feed = this.options.feed;
    if (!feed) throw new Error("This build doesn't check for updates.");
    const engine = await this.options.engine();
    engine.logger = ENGINE_LOG;
    engine.autoDownload = true; // downloads in the background as soon as a check finds an update
    engine.autoInstallOnAppQuit = true; // and installs it when Avanzel quits, if Restart to update didn't first
    engine.allowPrerelease = false; // full releases only: electron-updater allows pre-releases by itself when the running version is one
    engine.allowDowngrade = false; // never an older version
    engine.forceDevUpdateConfig = !this.options.packaged; // a development run with AVANZEL_UPDATE_FEED: electron-updater checks only when told
    const file = feedFile(this.options.dataDir, feed);
    if (file) engine.updateConfigPath = file;
    engine.setFeedURL(feed);
    this.listen(engine);
    this.loaded = engine;
    return engine;
  }

  /** What the engine tells, as the status. */
  private listen(engine: UpdateEngine): void {
    engine.on("checking-for-update", () => {
      const { kind } = this.status;
      if (kind !== "idle" && kind !== "current" && kind !== "problem") return;
      this.lastCheck = this.now();
      this.set({ kind: "checking" });
    });
    engine.on("update-not-available", () => {
      this.checkedAt = this.now();
      this.set({ kind: "current" });
    });
    engine.on("update-available", (info) => {
      this.checkedAt = this.now();
      this.set({ kind: "downloading", version: info.version, percent: 0 });
    });
    engine.on("download-progress", (progress) => {
      const status = this.status;
      if (status.kind !== "downloading") return;
      const percent = Math.max(0, Math.min(100, Math.floor(progress.percent)));
      if (Number.isFinite(percent) && percent !== status.percent) this.set({ ...status, percent });
    });
    engine.on("update-downloaded", (info) => this.set({ kind: "ready", version: info.version, waitingFor: null, restarting: false }));
    engine.on("error", (error) => this.fail(error));
  }

  /**
   * A check, a download or an install failed: logged, and told as a problem of that stage, once (a check that fails both rejects and
   * sends "error"). A restart that waited waits no more; one that had begun is over, and the host is told.
   */
  private fail(error: unknown): void {
    const { kind } = this.status;
    if (kind === "problem" || kind === "off") return;
    console.error("updates", error);
    const stage = kind === "downloading" ? "download" : kind === "ready" ? "install" : "check";
    const begun = this.begun;
    this.begun = false;
    this.stopWaiting();
    this.set({ kind: "problem", stage });
    if (begun) this.host.restartFailed();
  }

  /** The status's kind as it is now, read afresh after an await (a check's answer comes while it waits). */
  private kind(): UpdateStatus["kind"] {
    return this.status.kind;
  }

  private set(status: UpdateStatus): void {
    this.status = status;
    this.host.changed();
  }
}
