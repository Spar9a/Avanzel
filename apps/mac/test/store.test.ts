import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SettingsStore, normalizeSettings } from "../src/main/store.ts";

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
