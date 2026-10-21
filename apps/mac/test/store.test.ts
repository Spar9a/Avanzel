import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
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

  it("survives a corrupt file and persists updates", () => {
    const file = path.join(tmp(), "settings.json");
    writeFileSync(file, "{not json");
    const store = new SettingsStore(file);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    store.update({ fileMode: "evening", libraryPath: "/tmp/lib" });
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ fileMode: "evening", libraryPath: "/tmp/lib" });
    expect(new SettingsStore(file).get().fileMode).toBe("evening");
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
