// Avanzel's own updates (updater.ts): which feed a run reads, how electron-updater is set up, the states Settings and the panel show,
// when it looks by itself, and the restart, which waits while something is in progress. electron-updater is never loaded here: each
// updater runs on a stand-in engine, and the clock is vitest's.
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateStatus, UpdateWait } from "../src/shared/ipc.ts";
import {
  CACHE_DIR_NAME,
  CHECK_EVERY_MS,
  DUE_LOOK_MS,
  FEED_FILE,
  FIRST_CHECK_MS,
  QUIET_LOOKS,
  StandInEngine,
  UPDATE_REPO,
  Updater,
  updateFeed,
  updaterOptions,
  WAIT_LOOK_MS,
  type UpdateEngine,
  type UpdateFeed,
  type UpdaterHost,
} from "../src/main/updater.ts";

const GITHUB: UpdateFeed = { provider: "github", owner: "Spar9a", repo: "Avanzel" };

/** A stand-in for electron-updater's autoUpdater: it notes each call, and a test sends the events the feed would cause. */
class FakeEngine extends EventEmitter implements UpdateEngine {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  allowDowngrade = true;
  forceDevUpdateConfig = false;
  logger: UpdateEngine["logger"] = null;
  updateConfigPath: string | null = null;
  feeds: UpdateFeed[] = [];
  checks = 0;
  installs = 0;
  /** What the next check does: answers later (by the test's events), skips as electron-updater does when it isn't active, or fails. */
  next: "answer" | "skip" | "fail" = "answer";

  setFeedURL(feed: UpdateFeed): void {
    this.feeds.push(feed);
  }

  checkForUpdates(): Promise<unknown> {
    this.checks += 1;
    if (this.next === "skip") return Promise.resolve(null);
    this.emit("checking-for-update");
    if (this.next === "fail") {
      // As electron-updater does: the "error" event first, then the rejection.
      const error = new Error("net::ERR_INTERNET_DISCONNECTED");
      this.emit("error", error);
      return Promise.reject(error);
    }
    return Promise.resolve({ isUpdateAvailable: false, downloadPromise: Promise.reject(new Error("download failed")) });
  }

  quitAndInstall(): void {
    this.installs += 1;
  }
}

/** A host whose answers a test sets: whether Avanzel looks by itself, and what is in progress. It counts the changes it is told of. */
function makeHost(version = "0.2.0") {
  const state = { automatic: true, busy: null as UpdateWait | null, changes: 0, restartFailures: 0 };
  const host: UpdaterHost = {
    version,
    automatic: () => state.automatic,
    busy: () => state.busy,
    changed: () => void (state.changes += 1),
    restartFailed: () => void (state.restartFailures += 1),
  };
  return { host, state };
}

const dataDir = () => mkdtempSync(path.join(tmpdir(), "avz-updater-"));

/** An updater on a fake engine, for Avanzel's own GitHub feed unless told otherwise. */
function makeUpdater({ feed = GITHUB as UpdateFeed | null, packaged = true, firstCheckMs }: { feed?: UpdateFeed | null; packaged?: boolean; firstCheckMs?: number } = {}) {
  const engine = new FakeEngine();
  const made = { count: 0 };
  const { host, state } = makeHost();
  const dir = dataDir();
  const updater = new Updater(host, {
    feed,
    packaged,
    dataDir: dir,
    engine: () => {
      made.count += 1;
      return engine;
    },
    ...(firstCheckMs === undefined ? {} : { firstCheckMs }),
  });
  return { updater, engine, host, state, made, dir };
}

const status = (updater: Updater): UpdateStatus => updater.snapshot().status;

/** Lets the updater's awaits (the engine's making, the check's answer) run. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

// The spies on the console a test makes (to keep the logged failures out of the report) go with it.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("which feed a run reads", () => {
  it("is Avanzel's GitHub Releases in the packaged app", () => {
    expect(updateFeed({}, true)).toEqual({ provider: "github", owner: "Spar9a", repo: "Avanzel" });
    expect(UPDATE_REPO).toEqual({ owner: "Spar9a", repo: "Avanzel" });
  });

  it("is none in a development build or a test run, so no test reaches github.com", () => {
    expect(updateFeed({}, false)).toBeNull();
    expect(updateFeed({ AVANZEL_TEST: "1" }, true)).toBeNull();
    expect(updateFeed({ AVANZEL_TEST: "1" }, false)).toBeNull();
  });

  it("is AVANZEL_UPDATE_FEED's generic feed when it names an http(s) address, in any build", () => {
    const url = "http://127.0.0.1:8123/feed/";
    for (const packaged of [true, false]) {
      for (const test of [{}, { AVANZEL_TEST: "1" }]) {
        expect(updateFeed({ ...test, AVANZEL_UPDATE_FEED: url }, packaged)).toEqual({ provider: "generic", url });
      }
    }
    expect(updateFeed({ AVANZEL_UPDATE_FEED: ` https://updates.example.com/avanzel ` }, true)).toEqual({ provider: "generic", url: "https://updates.example.com/avanzel" });
  });

  it("is none for an AVANZEL_UPDATE_FEED that isn't an http(s) address, and an empty one counts as unset", () => {
    expect(updateFeed({ AVANZEL_UPDATE_FEED: "ftp://example.com/feed" }, true)).toBeNull();
    expect(updateFeed({ AVANZEL_UPDATE_FEED: "not an address" }, true)).toBeNull();
    expect(updateFeed({ AVANZEL_UPDATE_FEED: "  " }, true)).toEqual(GITHUB);
    expect(updateFeed({ AVANZEL_UPDATE_FEED: "" }, false)).toBeNull();
  });

  it("is the e2e tests' stand-in, on Avanzel's own feed, only with AVANZEL_TEST=1 and AVANZEL_FAKE_UPDATES=1", () => {
    const faked = updaterOptions({ AVANZEL_TEST: "1", AVANZEL_FAKE_UPDATES: "1" }, false, "/tmp/data");
    expect(faked.standIn).toBeInstanceOf(StandInEngine);
    expect(faked.feed).toEqual(GITHUB);
    expect(faked.packaged).toBe(true);
    expect(faked.engine()).toBe(faked.standIn);
    // Without AVANZEL_TEST=1 the variable means nothing: the packaged app reads its feed.
    const real = updaterOptions({ AVANZEL_FAKE_UPDATES: "1" }, true, "/tmp/data");
    expect(real.standIn).toBeUndefined();
    expect(real.feed).toEqual(GITHUB);
    expect(updaterOptions({ AVANZEL_TEST: "1" }, true, "/tmp/data").feed).toBeNull();
  });

  it("moves the first automatic check only for a test run", () => {
    expect(updaterOptions({ AVANZEL_TEST: "1", AVANZEL_UPDATE_FIRST_CHECK_MS: "500" }, true, "/tmp/data").firstCheckMs).toBe(500);
    expect(updaterOptions({ AVANZEL_UPDATE_FIRST_CHECK_MS: "500" }, true, "/tmp/data").firstCheckMs).toBe(FIRST_CHECK_MS);
    expect(updaterOptions({ AVANZEL_TEST: "1", AVANZEL_UPDATE_FIRST_CHECK_MS: "soon" }, true, "/tmp/data").firstCheckMs).toBe(FIRST_CHECK_MS);
  });
});

describe("an updater that is off", () => {
  it("never makes the engine, sets no timer, and checks nothing", async () => {
    vi.useFakeTimers();
    try {
      const { updater, made, state } = makeUpdater({ feed: null });
      expect(updater.snapshot()).toEqual({ version: "0.2.0", status: { kind: "off" }, checkedAt: null });
      updater.start();
      expect(vi.getTimerCount()).toBe(0);
      await updater.check();
      updater.restart();
      vi.advanceTimersByTime(CHECK_EVERY_MS * 2);
      await settle();
      expect(made.count).toBe(0);
      expect(status(updater)).toEqual({ kind: "off" });
      expect(state.changes).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("how electron-updater is set up", () => {
  it("downloads by itself, installs on quit, takes full releases only and never an older version, from the feed set in code", async () => {
    const { updater, engine, made, dir } = makeUpdater();
    expect(made.count).toBe(0); // not until it is first needed
    await updater.check();
    expect(made.count).toBe(1);
    expect(engine.autoDownload).toBe(true);
    expect(engine.autoInstallOnAppQuit).toBe(true);
    expect(engine.allowPrerelease).toBe(false);
    expect(engine.allowDowngrade).toBe(false);
    expect(engine.forceDevUpdateConfig).toBe(false);
    expect(engine.feeds).toEqual([GITHUB]);
    expect(engine.logger).not.toBeNull();
    // electron-updater reads the folder its downloads go in from this file, which a build without a publish block has none of.
    expect(engine.updateConfigPath).toBe(path.join(dir, FEED_FILE));
    expect(JSON.parse(readFileSync(path.join(dir, FEED_FILE), "utf8"))).toEqual({ ...GITHUB, updaterCacheDirName: CACHE_DIR_NAME });
    await updater.check(); // checking already: nothing more
    expect(made.count).toBe(1);
  });

  it("tells electron-updater to check in a development run that has a feed", async () => {
    const feed: UpdateFeed = { provider: "generic", url: "http://127.0.0.1:8123/" };
    const { updater, engine, dir } = makeUpdater({ feed, packaged: false });
    await updater.check();
    expect(engine.forceDevUpdateConfig).toBe(true);
    expect(engine.feeds).toEqual([feed]);
    expect(JSON.parse(readFileSync(path.join(dir, FEED_FILE), "utf8"))).toEqual({ ...feed, updaterCacheDirName: CACHE_DIR_NAME });
  });

  it("logs electron-updater's own lines with the app's, tagged, and leaves its failures to the updater, which logs each once", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { updater, engine } = makeUpdater();
    await updater.check();
    engine.logger?.info("Checking for update");
    engine.logger?.error("Error: net::ERR_FAILED");
    expect(logs).toHaveBeenCalledWith("updates", "Checking for update");
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("the states Settings and the panel show", () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    errors.mockRestore();
  });

  it("starts with nothing checked, then checking, then up to date, saying when the feed answered", async () => {
    const { updater, engine, state } = makeUpdater();
    expect(status(updater)).toEqual({ kind: "idle" });
    const asked = updater.check();
    expect(status(updater)).toEqual({ kind: "checking" }); // at once, before the engine is even made
    await asked;
    const before = Date.now();
    engine.emit("update-not-available", { version: "0.2.0" });
    expect(status(updater)).toEqual({ kind: "current" });
    const checkedAt = Date.parse(updater.snapshot().checkedAt ?? "");
    expect(checkedAt).toBeGreaterThanOrEqual(before);
    expect(checkedAt).toBeLessThanOrEqual(Date.now());
    expect(state.changes).toBeGreaterThanOrEqual(2);
  });

  it("downloads what it finds in the background, telling each whole percent once, and then it is ready", async () => {
    const { updater, engine, state } = makeUpdater();
    await updater.check();
    engine.emit("update-available", { version: "0.3.1" });
    expect(status(updater)).toEqual({ kind: "downloading", version: "0.3.1", percent: 0 });
    expect(updater.snapshot().checkedAt).not.toBeNull();
    engine.emit("download-progress", { percent: 41.7 });
    expect(status(updater)).toEqual({ kind: "downloading", version: "0.3.1", percent: 41 });
    const told = state.changes;
    engine.emit("download-progress", { percent: 41.95 });
    expect(state.changes).toBe(told);
    engine.emit("download-progress", { percent: Number.NaN });
    engine.emit("download-progress", { percent: 140 });
    expect(status(updater)).toEqual({ kind: "downloading", version: "0.3.1", percent: 100 });
    engine.emit("update-downloaded", { version: "0.3.1" });
    expect(status(updater)).toEqual({ kind: "ready", version: "0.3.1", waitingFor: null, restarting: false });
  });

  it("asks nothing more while checking, downloading or ready", async () => {
    const { updater, engine } = makeUpdater();
    await updater.check();
    await updater.check();
    expect(engine.checks).toBe(1);
    engine.emit("update-available", { version: "0.3.1" });
    await updater.check();
    engine.emit("update-downloaded", { version: "0.3.1" });
    await updater.check();
    expect(engine.checks).toBe(1);
  });

  it("tells a failed check once, as a problem of the check, and logs it once, though electron-updater both sends it and rejects", async () => {
    const { updater, engine } = makeUpdater();
    engine.next = "fail";
    await updater.check();
    expect(status(updater)).toEqual({ kind: "problem", stage: "check" });
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]?.[0]).toBe("updates");
    // Try again asks again.
    engine.next = "answer";
    const again = updater.check();
    expect(status(updater)).toEqual({ kind: "checking" });
    await again;
    expect(engine.checks).toBe(2);
    engine.emit("update-not-available", { version: "0.2.0" });
    expect(status(updater)).toEqual({ kind: "current" });
  });

  it("tells a failed download, and a failed install, as problems of their own", async () => {
    const { updater, engine } = makeUpdater();
    await updater.check();
    engine.emit("update-available", { version: "0.3.1" });
    engine.emit("error", new Error("sha512 checksum mismatch"));
    expect(status(updater)).toEqual({ kind: "problem", stage: "download" });
    await updater.check();
    engine.emit("update-available", { version: "0.3.1" });
    engine.emit("update-downloaded", { version: "0.3.1" });
    engine.emit("error", new Error("Code signature did not pass validation"));
    expect(status(updater)).toEqual({ kind: "problem", stage: "install" });
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it("goes back to nothing checked when electron-updater skips the check", async () => {
    const warns = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { updater, engine } = makeUpdater();
      engine.next = "skip";
      await updater.check();
      expect(status(updater)).toEqual({ kind: "idle" });
      expect(warns).toHaveBeenCalled();
    } finally {
      warns.mockRestore();
    }
  });

  it("says the problem when electron-updater can't be loaded, and tries to load it again the next time", async () => {
    const { host } = makeHost();
    let attempts = 0;
    const updater = new Updater(host, {
      feed: GITHUB,
      packaged: true,
      dataDir: dataDir(),
      engine: () => {
        attempts += 1;
        throw new Error("Cannot find module 'electron-updater'");
      },
    });
    await updater.check();
    expect(status(updater)).toEqual({ kind: "problem", stage: "check" });
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[1])).toContain("Cannot find module 'electron-updater'");
    await updater.check();
    expect(attempts).toBe(2);
    expect(errors).toHaveBeenCalledTimes(2);
  });
});

describe("when it looks by itself", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("looks 30 s after it starts, then at the first look 6 hours after that one began", async () => {
    const { updater, engine } = makeUpdater();
    updater.start();
    vi.advanceTimersByTime(FIRST_CHECK_MS - 1);
    await settle();
    expect(engine.checks).toBe(0);
    vi.advanceTimersByTime(1);
    await settle();
    expect(engine.checks).toBe(1);
    engine.emit("update-not-available", { version: "0.2.0" });
    vi.advanceTimersByTime(CHECK_EVERY_MS - DUE_LOOK_MS);
    await settle();
    expect(engine.checks).toBe(1);
    // The looks come every minute from the start, so the one that finds 6 hours gone is at most a minute late.
    vi.advanceTimersByTime(2 * DUE_LOOK_MS);
    await settle();
    expect(engine.checks).toBe(2);
    updater.stop();
  });

  it("looks again soon after a Mac wakes from a sleep longer than 6 hours, as the clock counts", async () => {
    const { updater, engine } = makeUpdater();
    updater.start();
    vi.advanceTimersByTime(FIRST_CHECK_MS);
    await settle();
    engine.emit("update-not-available", { version: "0.2.0" });
    // Asleep: the clock moves on, the timers don't.
    vi.setSystemTime(Date.now() + CHECK_EVERY_MS + 1);
    vi.advanceTimersByTime(DUE_LOOK_MS);
    await settle();
    expect(engine.checks).toBe(2);
    updater.stop();
  });

  it("tries again when the next check is due after a problem, and never while it downloads or an update is ready", async () => {
    const { updater, engine } = makeUpdater();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    updater.start();
    engine.next = "fail";
    vi.advanceTimersByTime(FIRST_CHECK_MS);
    await settle();
    expect(status(updater)).toEqual({ kind: "problem", stage: "check" });
    engine.next = "answer";
    vi.advanceTimersByTime(CHECK_EVERY_MS + DUE_LOOK_MS);
    await settle();
    expect(engine.checks).toBe(2);
    engine.emit("update-available", { version: "0.3.1" });
    vi.advanceTimersByTime(CHECK_EVERY_MS * 2);
    await settle();
    expect(engine.checks).toBe(2);
    engine.emit("update-downloaded", { version: "0.3.1" });
    vi.advanceTimersByTime(CHECK_EVERY_MS * 2);
    await settle();
    expect(engine.checks).toBe(2);
    updater.stop();
  });

  it("doesn't look by itself while the setting is off, though Check now still works", async () => {
    const { updater, engine, state } = makeUpdater();
    state.automatic = false;
    updater.start();
    vi.advanceTimersByTime(FIRST_CHECK_MS + CHECK_EVERY_MS * 3);
    await settle();
    expect(engine.checks).toBe(0);
    await updater.check();
    expect(engine.checks).toBe(1);
    updater.stop();
  });

  it("looks at the next look once the setting is turned on, if no look has been made yet", async () => {
    const { updater, engine, state } = makeUpdater();
    state.automatic = false;
    updater.start();
    vi.advanceTimersByTime(FIRST_CHECK_MS + DUE_LOOK_MS * 5);
    await settle();
    expect(engine.checks).toBe(0);
    state.automatic = true;
    vi.advanceTimersByTime(DUE_LOOK_MS);
    await settle();
    expect(engine.checks).toBe(1);
    updater.stop();
  });

  it("takes the first look's time from its options", async () => {
    const { updater, engine } = makeUpdater({ firstCheckMs: 500 });
    updater.start();
    vi.advanceTimersByTime(500);
    await settle();
    expect(engine.checks).toBe(1);
    updater.stop();
  });

  it("looks no more once stopped", async () => {
    const { updater, engine } = makeUpdater();
    updater.start();
    updater.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(CHECK_EVERY_MS * 2);
    await settle();
    expect(engine.checks).toBe(0);
  });
});

describe("the restart, which never cuts work in progress short", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** An updater whose update 0.3.1 has downloaded. */
  async function ready() {
    const made = makeUpdater();
    await made.updater.check();
    made.engine.emit("update-available", { version: "0.3.1" });
    made.engine.emit("update-downloaded", { version: "0.3.1" });
    return made;
  }

  it("does nothing while no update is ready", async () => {
    const { updater, engine } = makeUpdater();
    updater.restart();
    await updater.check();
    updater.restart();
    vi.advanceTimersByTime(WAIT_LOOK_MS * 10);
    expect(engine.installs).toBe(0);
    expect(updater.restarting).toBe(false);
  });

  it("restarts at once while nothing is in progress, after the call that asked has had its answer", async () => {
    const { updater, engine } = await ready();
    updater.restart();
    expect(status(updater)).toEqual({ kind: "ready", version: "0.3.1", waitingFor: null, restarting: true });
    expect(updater.restarting).toBe(true);
    expect(engine.installs).toBe(0);
    vi.advanceTimersByTime(1);
    expect(engine.installs).toBe(1);
    updater.restart(); // a second press
    vi.advanceTimersByTime(WAIT_LOOK_MS * 5);
    expect(engine.installs).toBe(1);
  });

  it("waits while something is in progress, says what, and restarts once nothing has been for two looks in a row", async () => {
    const { updater, engine, state } = await ready();
    state.busy = "recording";
    updater.restart();
    expect(status(updater)).toEqual({ kind: "ready", version: "0.3.1", waitingFor: "recording", restarting: false });
    expect(updater.restarting).toBe(false);
    updater.restart(); // a second press changes nothing
    vi.advanceTimersByTime(WAIT_LOOK_MS);
    expect(status(updater)).toMatchObject({ waitingFor: "recording" });
    // The recording hands over to its words, then to its filing: each is said as it comes.
    state.busy = "transcription";
    vi.advanceTimersByTime(WAIT_LOOK_MS);
    expect(status(updater)).toMatchObject({ waitingFor: "transcription" });
    state.busy = "filing";
    vi.advanceTimersByTime(WAIT_LOOK_MS);
    expect(status(updater)).toMatchObject({ waitingFor: "filing" });
    // A moment between two pieces of work isn't the end of them.
    state.busy = null;
    vi.advanceTimersByTime(WAIT_LOOK_MS * (QUIET_LOOKS - 1));
    state.busy = "filing";
    vi.advanceTimersByTime(WAIT_LOOK_MS);
    expect(engine.installs).toBe(0);
    expect(status(updater)).toMatchObject({ waitingFor: "filing", restarting: false });
    state.busy = null;
    vi.advanceTimersByTime(WAIT_LOOK_MS * QUIET_LOOKS);
    expect(status(updater)).toEqual({ kind: "ready", version: "0.3.1", waitingFor: null, restarting: true });
    vi.advanceTimersByTime(1);
    expect(engine.installs).toBe(1);
    vi.advanceTimersByTime(WAIT_LOOK_MS * 10);
    expect(engine.installs).toBe(1);
  });

  it("waits no more when the update fails meanwhile, or when Avanzel quits", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = await ready();
    failing.state.busy = "call";
    failing.updater.restart();
    failing.engine.emit("error", new Error("The update is gone from the cache."));
    expect(status(failing.updater)).toEqual({ kind: "problem", stage: "install" });
    failing.state.busy = null;
    vi.advanceTimersByTime(WAIT_LOOK_MS * 10);
    expect(failing.engine.installs).toBe(0);
    expect(failing.state.restartFailures).toBe(0); // it hadn't begun

    const quitting = await ready();
    quitting.state.busy = "review";
    quitting.updater.restart();
    quitting.updater.stop();
    quitting.state.busy = null;
    vi.advanceTimersByTime(WAIT_LOOK_MS * 10);
    expect(quitting.engine.installs).toBe(0);
  });

  it("tells the host when a restart that had begun fails, and is no longer restarting", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { updater, engine, state } = await ready();
    updater.restart();
    vi.advanceTimersByTime(1);
    expect(engine.installs).toBe(1);
    engine.emit("error", new Error("Squirrel couldn't install the update."));
    expect(status(updater)).toEqual({ kind: "problem", stage: "install" });
    expect(updater.restarting).toBe(false);
    expect(state.restartFailures).toBe(1);
  });

  it("tells the host too when quitAndInstall itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { updater, engine, state } = await ready();
    engine.quitAndInstall = () => {
      throw new Error("No update filepath provided, can't quit and install");
    };
    updater.restart();
    vi.advanceTimersByTime(1);
    expect(status(updater)).toEqual({ kind: "problem", stage: "install" });
    expect(state.restartFailures).toBe(1);
  });
});

describe("the e2e tests' stand-in", () => {
  it("counts checks and installs, says it is checking, and asks no feed", async () => {
    const standIn = new StandInEngine();
    const answer = await standIn.checkForUpdates();
    expect(answer).not.toBeNull();
    standIn.quitAndInstall();
    expect({ checks: standIn.checks, installs: standIn.installs }).toEqual({ checks: 1, installs: 1 });
  });
});
