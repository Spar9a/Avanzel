// App-level preferences (not per library): where the library is, shortcuts, how notes are filed, whether Avanzel looks for its
// own updates. And, apart from
// them, the taken shortcuts the capsule has named, the times a first run reached setup's milestones, and how many
// recordings the library has kept.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isSetupStep, SETUP_STEPS, type AppSettings, type CursorKey, type SetupStep, type Shortcuts } from "../shared/ipc.ts";

/** The voice trigger's word until the person picks one: the app's own name. */
export const TRIGGER_WORD = "Avanzel";
/** The word that stops a recording by voice until the person picks one. */
export const STOP_WORD = "Avanzel stop";
/** The longest trigger word or phrase kept, in characters. */
const TRIGGER_MAX = 40;

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  version: 1,
  libraryPath: null,
  shortcuts: Object.freeze({
    dictate: "Alt+Space",
    capture: "Alt+Shift+S",
    type: "Alt+Shift+Space",
    ask: "Alt+Shift+A",
    undo: "Alt+Shift+Z",
    call: "Alt+Shift+C",
    region: "Alt+Shift+R",
    shot: "Alt+Shift+X",
    shotScreen: "Alt+Shift+E",
    shotMarks: "Alt+Shift+M",
  }),
  fileMode: "now",
  microphoneId: null,
  launchAtLogin: false,
  callConsent: false,
  cursorDictation: Object.freeze({ enabled: false, key: "right-option" }),
  voiceTrigger: Object.freeze({ enabled: false, word: TRIGGER_WORD, stopWord: STOP_WORD }),
  checkForUpdates: true,
}) as AppSettings;

const CURSOR_KEYS: readonly CursorKey[] = ["right-option", "left-option", "right-command", "right-control"];

/** The dictation setting as far as it makes sense: a switch that isn't true is off, and a key Avanzel doesn't know is Right Option. */
function cursorDictationOf(raw: unknown): AppSettings["cursorDictation"] {
  const given = isRecord(raw) ? raw : {};
  const key = CURSOR_KEYS.find((known) => known === given.key) ?? "right-option";
  return { enabled: given.enabled === true, key };
}

function voiceTriggerOf(raw: unknown): AppSettings["voiceTrigger"] {
  const given = isRecord(raw) ? raw : {};
  const word = typeof given.word === "string" ? given.word.trim().slice(0, TRIGGER_MAX) : "";
  const stopWord = typeof given.stopWord === "string" ? given.stopWord.trim().slice(0, TRIGGER_MAX) : "";
  return { enabled: given.enabled === true, word: word || TRIGGER_WORD, stopWord: stopWord || STOP_WORD };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Writes `value` to `file` as JSON, whole or not at all: the file's folder is made if need be, the text goes to
 * `<file>.tmp`, and that is renamed over `file`. It throws when any of that fails.
 */
export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.tmp`;
  writeFileSync(partial, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(partial, file);
}

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
    callConsent: r.callConsent === true,
    cursorDictation: cursorDictationOf(r.cursorDictation),
    voiceTrigger: voiceTriggerOf(r.voiceTrigger),
    // On unless the person turned it off: a settings file from before the setting has it on.
    checkForUpdates: r.checkForUpdates !== false,
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

  /**
   * Applies `patch` and keeps it. When the file can't be written it throws, and the settings stay as they were: a change that
   * Settings reports as not saved must not take effect meanwhile, nor show as made when Settings is next refreshed.
   */
  update(patch: Partial<AppSettings>): AppSettings {
    const merged = { ...this.current, ...patch, shortcuts: { ...this.current.shortcuts, ...patch.shortcuts } };
    const next = normalizeSettings(merged);
    writeJsonAtomic(this.file, next);
    this.current = next;
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

/**
 * The shortcuts (accelerators, "Alt+Space") whose notice the capsule has shown because another app holds them, kept
 * with the app, not the library: each is named once, and again only after it has worked in between.
 */
export class NoticedShortcuts {
  constructor(private readonly file: string) {}

  has(accelerator: string): boolean {
    return this.load().includes(accelerator);
  }

  add(accelerator: string): void {
    const noticed = this.load();
    if (!noticed.includes(accelerator)) this.save([...noticed, accelerator]);
  }

  /** Forgets the `working` ones: they registered fine, so a later taker gets the notice again. */
  forget(working: readonly string[]): void {
    const noticed = this.load();
    const kept = noticed.filter((accelerator) => !working.includes(accelerator));
    if (kept.length !== noticed.length) this.save(kept);
  }

  private load(): string[] {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  private save(noticed: readonly string[]): void {
    writeJsonAtomic(this.file, noticed);
  }
}

/** When a first run reached each milestone, kept with the app (userData/first-run.json) and never sent anywhere. */
export interface FirstRun {
  version: 1;
  /** When Avanzel first started. */
  firstLaunchAt: string | null;
  /** When each setup step was first on screen. */
  steps: Partial<Record<SetupStep, string>>;
  /** When the thought setup filed was first filed. */
  firstFiledAt: string | null;
  /** Undo was used in setup. */
  undone: boolean;
  /** When Start using Avanzel was first used. */
  finishedAt: string | null;
  /** The step on screen the last time the window was closed without Start using Avanzel. */
  closedOn: SetupStep | null;
}

const timeOf = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/** What `raw` says of a first run, as far as it makes sense: anything else is a milestone not reached yet. */
function normalizeFirstRun(raw: unknown): FirstRun {
  const r = isRecord(raw) ? raw : {};
  const given = isRecord(r.steps) ? r.steps : {};
  const steps: FirstRun["steps"] = {};
  for (const step of SETUP_STEPS) {
    const time = timeOf(given[step]);
    if (time) steps[step] = time;
  }
  return {
    version: 1,
    firstLaunchAt: timeOf(r.firstLaunchAt),
    steps,
    firstFiledAt: timeOf(r.firstFiledAt),
    undone: r.undone === true,
    finishedAt: timeOf(r.finishedAt),
    closedOn: isSetupStep(r.closedOn) ? r.closedOn : null,
  };
}

/**
 * The times a first run reached setup's milestones (§5.4's measures), in a file of the app's own on this Mac. Nothing
 * reports them. A milestone keeps the first time it was reached, so noting it again leaves the file be (the step the
 * window was closed on is the one exception: the last counts). A missing or broken file reads as a first run that has
 * reached nothing. Noting is best effort: a file that can't be written costs a measure, never the setup noting it.
 */
export class FirstRunLog {
  constructor(private readonly file: string) {}

  get(): FirstRun {
    try {
      return normalizeFirstRun(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      return normalizeFirstRun({});
    }
  }

  /** Avanzel started. */
  launched(now: Date): void {
    this.note((run) => {
      run.firstLaunchAt ??= now.toISOString();
    });
  }

  /** The setup window shows `step`. */
  entered(step: SetupStep, now: Date): void {
    this.note((run) => {
      run.steps[step] ??= now.toISOString();
    });
  }

  /** Setup's thought was filed. */
  filed(now: Date): void {
    this.note((run) => {
      run.firstFiledAt ??= now.toISOString();
    });
  }

  /** Undo was used on the filing in setup. */
  undid(): void {
    this.note((run) => {
      run.undone = true;
    });
  }

  /** Start using Avanzel was used. */
  finished(now: Date): void {
    this.note((run) => {
      run.finishedAt ??= now.toISOString();
    });
  }

  /** The setup window was closed on `step` without Start using Avanzel. */
  closed(step: SetupStep): void {
    this.note((run) => {
      run.closedOn = step;
    });
  }

  /** Applies `change` to what the file holds and writes the result, unless that changed nothing. */
  private note(change: (run: FirstRun) => void): void {
    const run = this.get();
    const before = JSON.stringify(run);
    change(run);
    if (JSON.stringify(run) === before) return;
    try {
      writeJsonAtomic(this.file, run);
    } catch (error) {
      console.error("first-run log", error);
    }
  }
}

/**
 * How many recordings the library has kept, in a file of the app's own on this Mac (userData/captures.json): never in the
 * library, and nothing reports it. Its one reader is the listening card's hint, which the first recordings get. A recording
 * counts once the library keeps something of it: its words, its screenshot (a screen comment), or its audio when Stop keeps it
 * in the inbox. What becomes of it after (filed, saved for the evening review, stopped) changes nothing. An Esc doesn't count,
 * nor does a dictation with no speech, nor a typed thought, which is no recording. A failed recording doesn't count either, even
 * when its audio stays in raw/audio/: that audio is not kept in this sense. A missing or broken file reads as none kept.
 * Counting is best effort: a file that can't be written costs a count, never the recording.
 */
export class CaptureCount {
  constructor(private readonly file: string) {}

  get(): number {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      const kept = isRecord(raw) ? raw.kept : 0;
      return typeof kept === "number" && Number.isSafeInteger(kept) && kept > 0 ? kept : 0;
    } catch {
      return 0;
    }
  }

  /** One more recording is kept: whatever keeps one calls this as soon as the library has what it made (its words, its screenshot, or the audio Stop keeps in the inbox). */
  add(): void {
    try {
      writeJsonAtomic(this.file, { version: 1, kept: this.get() + 1 });
    } catch (error) {
      console.error("capture count", error);
    }
  }
}
