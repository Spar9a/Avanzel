import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CaptureCount,
  DEFAULT_SETTINGS,
  FirstRunLog,
  NoticedShortcuts,
  SettingsStore,
  normalizeSettings,
  writeJsonAtomic,
  type FirstRun,
} from "../src/main/store.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-store-"));

describe("settings store", () => {
  it("starts from defaults when the file is missing", () => {
    const store = new SettingsStore(path.join(tmp(), "settings.json"));
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(store.get().shortcuts.dictate).toBe("Alt+Space");
    expect(store.get().fileMode).toBe("now");
  });

  it("keeps valid values, drops unknown keys and repairs wrong types", () => {
    const settings = normalizeSettings({
      libraryPath: "/Users/me/Brain",
      shortcuts: { dictate: "Alt+D", capture: 42 },
      fileMode: "sometimes",
      launchAtLogin: true,
      surprise: "x",
    });
    expect(settings.libraryPath).toBe("/Users/me/Brain");
    expect(settings.shortcuts).toEqual({ ...DEFAULT_SETTINGS.shortcuts, dictate: "Alt+D" });
    expect(settings.fileMode).toBe("now");
    expect(settings.launchAtLogin).toBe(true);
    expect(settings).not.toHaveProperty("surprise");
  });

  it("an older settings file, with four shortcuts, gets ⌥⇧Z for Undo the last filing", () => {
    const four = { dictate: "Alt+D", capture: "Alt+Shift+S", type: "Alt+Shift+Space", ask: "Alt+Shift+A" };
    expect(normalizeSettings({ shortcuts: four }).shortcuts).toEqual({ ...four, undo: "Alt+Shift+Z" });
  });

  it("starts with sounds off, and only true turns them on", () => {
    expect(DEFAULT_SETTINGS.sounds).toBe(false);
    expect(new SettingsStore(path.join(tmp(), "settings.json")).get().sounds).toBe(false);
    expect(normalizeSettings({}).sounds).toBe(false);
    expect(normalizeSettings({ sounds: true }).sounds).toBe(true);
    // Anything else, however it came to be in the file, is off: a setting that plays sounds is one the person turned on.
    for (const wrong of [false, "true", "yes", 1, null, undefined, {}, []]) expect(normalizeSettings({ sounds: wrong }).sounds, String(wrong)).toBe(false);
  });

  it("keeps the sounds setting from one run to the next", () => {
    const file = path.join(tmp(), "settings.json");
    const store = new SettingsStore(file);
    store.update({ sounds: true });
    expect(JSON.parse(readFileSync(file, "utf8")).sounds).toBe(true);
    expect(new SettingsStore(file).get().sounds).toBe(true);
    store.update({ fileMode: "evening" }); // another change leaves it be
    expect(new SettingsStore(file).get().sounds).toBe(true);
    store.update({ sounds: false });
    expect(new SettingsStore(file).get().sounds).toBe(false);
  });

  it("survives a corrupt file and persists updates", () => {
    const file = path.join(tmp(), "settings.json");
    writeFileSync(file, "{not json");
    const store = new SettingsStore(file);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    store.update({ fileMode: "evening", libraryPath: "/tmp/lib" });
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ fileMode: "evening", libraryPath: "/tmp/lib" });
    expect(new SettingsStore(file).get().fileMode).toBe("evening");
  });

  it("keeps the settings it had when a write fails, so what Settings shows is what is kept", () => {
    const folder = tmp();
    const file = path.join(folder, "settings.json");
    const store = new SettingsStore(file);
    store.update({ fileMode: "evening" });
    chmodSync(folder, 0o555); // nothing can be written here now
    try {
      expect(() => store.update({ launchAtLogin: true, fileMode: "now" })).toThrow(/EACCES/);
      // The change is refused, and so is its effect: the next snapshot of Settings shows the switch off, as the file has it.
      expect(store.get()).toMatchObject({ fileMode: "evening", launchAtLogin: false });
    } finally {
      chmodSync(folder, 0o755); // so the temp folder can be cleaned up
    }
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ fileMode: "evening", launchAtLogin: false });
    // Once it can be written, the same change goes through.
    store.update({ launchAtLogin: true });
    expect(new SettingsStore(file).get()).toMatchObject({ fileMode: "evening", launchAtLogin: true });
  });
});

describe("noticed shortcuts", () => {
  it("remember a noticed shortcut from one app run to the next, until it works", () => {
    const file = path.join(tmp(), "noticed-shortcuts.json");
    const noticed = new NoticedShortcuts(file);
    expect(noticed.has("Alt+Space")).toBe(false);
    noticed.add("Alt+Space");
    noticed.add("Alt+Space");
    noticed.add("Control+Alt+D");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(["Alt+Space", "Control+Alt+D"]);
    const later = new NoticedShortcuts(file); // the next launch
    expect(later.has("Alt+Space")).toBe(true);
    later.forget(["Alt+Space", "Alt+Shift+S"]);
    expect(later.has("Alt+Space")).toBe(false);
    expect(later.has("Control+Alt+D")).toBe(true);
  });

  it("start from none when the file is missing or isn't a list", () => {
    const file = path.join(tmp(), "noticed-shortcuts.json");
    expect(new NoticedShortcuts(file).has("Alt+Space")).toBe(false);
    writeFileSync(file, '{"Alt+Space": true}');
    expect(new NoticedShortcuts(file).has("Alt+Space")).toBe(false);
    writeFileSync(file, '["Alt+Space", 7]');
    expect(new NoticedShortcuts(file).has("Alt+Space")).toBe(true);
  });
});

describe("writeJsonAtomic", () => {
  it("makes the file's folder, writes the value and a newline, and leaves no partial file", () => {
    const file = path.join(tmp(), "data", "deeper", "value.json");
    writeJsonAtomic(file, { list: [1, 2], text: "x" });
    expect(readFileSync(file, "utf8")).toBe('{\n  "list": [\n    1,\n    2\n  ],\n  "text": "x"\n}\n');
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it("replaces what the file held", () => {
    const file = path.join(tmp(), "value.json");
    writeFileSync(file, "{not json");
    writeJsonAtomic(file, ["new"]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(["new"]);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });
});

describe("FirstRunLog", () => {
  const at = (time: string) => new Date(`2026-10-21T${time}.000Z`);
  /** A first run that has reached nothing. */
  const fresh: FirstRun = {
    version: 1,
    firstLaunchAt: null,
    steps: {},
    firstFiledAt: null,
    undone: false,
    finishedAt: null,
    closedOn: null,
  };

  it("keeps the first time of each milestone", () => {
    const file = path.join(tmp(), "first-run.json");
    const log = new FirstRunLog(file);
    expect(log.get()).toEqual(fresh); // no file yet
    log.launched(at("09:00:00"));
    log.launched(at("09:30:00"));
    log.entered("found", at("09:01:00"));
    log.entered("found", at("09:02:00"));
    log.filed(at("09:03:00"));
    log.filed(at("09:03:30"));
    log.finished(at("09:04:00"));
    log.finished(at("09:05:00"));
    const noted: FirstRun = {
      version: 1,
      firstLaunchAt: "2026-10-21T09:00:00.000Z",
      steps: { found: "2026-10-21T09:01:00.000Z" },
      firstFiledAt: "2026-10-21T09:03:00.000Z",
      undone: false,
      finishedAt: "2026-10-21T09:04:00.000Z",
      closedOn: null,
    };
    expect(log.get()).toEqual(noted);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(noted);
    expect(new FirstRunLog(file).get()).toEqual(noted); // the next launch
  });

  it("notes each step on its own, that Undo was used, and the step the window was closed on", () => {
    const file = path.join(tmp(), "first-run.json");
    const log = new FirstRunLog(file);
    log.entered("hello", at("09:00:00"));
    log.entered("found", at("09:01:00"));
    log.entered("hello", at("09:02:00")); // Back, and Back again
    log.undid();
    log.undid();
    log.closed("filing");
    expect(log.get()).toMatchObject({
      steps: { hello: "2026-10-21T09:00:00.000Z", found: "2026-10-21T09:01:00.000Z" },
      undone: true,
      closedOn: "filing",
    });
    log.closed("ask"); // the last time the window was closed counts
    expect(new FirstRunLog(file).get().closedOn).toBe("ask");
  });

  it("reads a broken file as a fresh one", () => {
    const file = path.join(tmp(), "first-run.json");
    writeFileSync(file, "{not json");
    const log = new FirstRunLog(file);
    expect(log.get().firstLaunchAt).toBeNull();
    expect(log.get().steps).toEqual({});
    expect(log.get()).toEqual(fresh);
    log.launched(at("09:00:00")); // the next note starts the file over
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ...fresh, firstLaunchAt: "2026-10-21T09:00:00.000Z" });
  });

  it("reads a file of the wrong shape as far as it makes sense", () => {
    const file = path.join(tmp(), "first-run.json");
    const log = new FirstRunLog(file);
    writeFileSync(file, '["2026-10-21T09:00:00.000Z"]');
    expect(log.get()).toEqual(fresh);
    writeFileSync(
      file,
      JSON.stringify({
        version: 7,
        firstLaunchAt: "2026-10-21T09:00:00.000Z",
        steps: { found: 9, think: "2026-10-21T09:01:00.000Z", elsewhere: "2026-10-21T09:02:00.000Z" },
        firstFiledAt: 12,
        undone: "yes",
        finishedAt: "",
        closedOn: "elsewhere",
        surprise: true,
      }),
    );
    expect(log.get()).toEqual({
      ...fresh,
      firstLaunchAt: "2026-10-21T09:00:00.000Z",
      steps: { think: "2026-10-21T09:01:00.000Z" },
    });
  });

  it("never throws when it can't write: setup goes on without its log", () => {
    const blocker = path.join(tmp(), "in-the-way");
    writeFileSync(blocker, "a file where the log's folder should be");
    const log = new FirstRunLog(path.join(blocker, "first-run.json"));
    const problems = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => log.launched(at("09:00:00"))).not.toThrow();
      expect(problems).toHaveBeenCalledTimes(1);
      expect(log.get()).toEqual(fresh);
    } finally {
      problems.mockRestore();
    }
  });
});

describe("CaptureCount", () => {
  it("counts the recordings the library has kept, from one app run to the next", () => {
    const file = path.join(tmp(), "captures.json");
    const count = new CaptureCount(file);
    expect(count.get()).toBe(0); // no file yet
    count.add();
    count.add();
    count.add();
    expect(count.get()).toBe(3);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, kept: 3 });
    expect(new CaptureCount(file).get()).toBe(3); // the next launch
  });

  it("goes on counting from what an earlier launch kept, past ten", () => {
    const file = path.join(tmp(), "captures.json");
    writeFileSync(file, JSON.stringify({ version: 1, kept: 9 }));
    const count = new CaptureCount(file);
    expect(count.get()).toBe(9);
    count.add();
    count.add();
    expect(count.get()).toBe(11);
    expect(new CaptureCount(file).get()).toBe(11);
  });

  it("reads a broken file, or one of the wrong shape, as none kept, and the next recording starts it over", () => {
    const file = path.join(tmp(), "captures.json");
    const count = new CaptureCount(file);
    const unreadable = [
      "{not json", "", "[4]", '"4"', "4", "null",
      '{"version": 1}', '{"kept": "4"}', '{"kept": null}', '{"kept": -1}', '{"kept": 2.5}', '{"kept": 1e999}', '{"kept": 1e300}',
    ];
    for (const content of unreadable) {
      writeFileSync(file, content);
      expect(count.get(), content).toBe(0);
    }
    // What makes sense of a file is kept: its count, whatever else it holds.
    writeFileSync(file, JSON.stringify({ version: 7, kept: 5, surprise: true }));
    expect(count.get()).toBe(5);
    writeFileSync(file, "{not json");
    count.add();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, kept: 1 });
  });

  it("never throws when it can't write: the recording it counts is kept all the same", () => {
    const blocker = path.join(tmp(), "in-the-way");
    writeFileSync(blocker, "a file where the count's folder should be");
    const count = new CaptureCount(path.join(blocker, "captures.json"));
    const problems = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => count.add()).not.toThrow();
      expect(problems).toHaveBeenCalledTimes(1);
      expect(count.get()).toBe(0);
    } finally {
      problems.mockRestore();
    }
  });
});
