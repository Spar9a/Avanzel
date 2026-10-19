// App-level preferences (not per library): where the library is, shortcuts, how notes are filed.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AppSettings, Shortcuts } from "../shared/ipc.ts";

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  version: 1,
  libraryPath: null,
  shortcuts: Object.freeze({
    dictate: "Alt+Space",
    capture: "Alt+Shift+S",
    type: "Alt+Shift+Space",
    ask: "Alt+Shift+A",
  }),
  fileMode: "now",
  microphoneId: null,
  launchAtLogin: false,
}) as AppSettings;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function normalizeSettings(raw: unknown): AppSettings {
  const r = isRecord(raw) ? raw : {};
  const given = isRecord(r.shortcuts) ? r.shortcuts : {};
  const shortcuts = { ...DEFAULT_SETTINGS.shortcuts };
  for (const key of Object.keys(shortcuts) as (keyof Shortcuts)[]) {
    const value = given[key];
    if (typeof value === "string" && value.trim()) shortcuts[key] = value.trim();
  }
  return {
    version: 1,
    libraryPath: typeof r.libraryPath === "string" && r.libraryPath ? r.libraryPath : null,
    shortcuts,
    fileMode: r.fileMode === "evening" ? "evening" : "now",
    microphoneId: typeof r.microphoneId === "string" && r.microphoneId ? r.microphoneId : null,
    launchAtLogin: r.launchAtLogin === true,
  };
}

export class SettingsStore {
  private current: AppSettings;

  constructor(private readonly file: string) {
    this.current = SettingsStore.load(file);
  }

  get(): AppSettings {
    return structuredClone(this.current);
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const merged = { ...this.current, ...patch, shortcuts: { ...this.current.shortcuts, ...patch.shortcuts } };
    this.current = normalizeSettings(merged);
    mkdirSync(path.dirname(this.file), { recursive: true });
    const partial = `${this.file}.tmp`;
    writeFileSync(partial, `${JSON.stringify(this.current, null, 2)}\n`);
    renameSync(partial, this.file);
    return this.get();
  }

  private static load(file: string): AppSettings {
    try {
      return normalizeSettings(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      return normalizeSettings({});
    }
  }
}
