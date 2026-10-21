// Everything the app does, in one place: shortcuts → capsule → transcription → capture → filing,
// settings, shadow tasks and the menu bar. Windows and the tray only render what this decides.
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  nativeImage,
  Notification,
  powerMonitor,
  shell,
} from "electron";
import { existsSync, readdirSync, renameSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  AvanzelError,
  Librarian,
  Vault,
  WAITING,
  checkAgent as checkHarness,
  defaultSettings,
  downloadModels,
  downloadSize,
  ensureDefaultTasks,
  errorLine,
  formatSchedule,
  harnesses as listHarnesses,
  lastDue,
  loadSettings,
  loadTasksReport,
  locateModel,
  makeTranscriber,
  missingModels,
  nextRun,
  parseSchedule,
  readWav,
  rememberVault,
  resampleTo16k,
  saveSettings,
  saveTask,
  selectHarness,
  speechModels,
  writeWav,
  type AgentCheck,
  type Capture,
  type CaptureOptions,
  type FileOutcome,
  type Harness,
  type Settings,
  type ShadowTask,
  type Transcriber,
  type VoiceOptions,
  type VoiceSettings,
} from "@avanzel/engine";
import { isSettingsPane, isSetupStep } from "../shared/ipc.ts";
import type {
  AgentStatus,
  AppSettings,
  AskResult,
  CapsuleMode,
  CapsuleState,
  FiledPage,
  ModelStatus,
  ScreenContext,
  SettingsPane,
  SettingsSnapshot,
  SetupSnapshot,
  SetupStep,
  Shortcuts,
  TaskInfo,
} from "../shared/ipc.ts";
import { frontContext } from "./front-app.ts";
import { captureMeta, filedPages, findPage, obsidianUrl, pageInfo, recentFromLog } from "./library-info.ts";
import { buildMenuModel, type MenuInput, type MenuItemModel } from "./menu-model.ts";
import { openPrivacyPane, permissionStatus, requestMicrophone } from "./permissions.ts";
import { RunStateStore } from "./run-state.ts";
import { runningAppNames } from "./running-apps.ts";
import { dueTasks, markChecked, markRan, type RunState } from "./schedule.ts";
import { captureDisplay, looksBlank } from "./screenshot.ts";
import { libraryFolder, tildePath } from "./setup-model.ts";
import { freeAlternatives, likelyHolder, prettyAccelerator, registerShortcuts, type ShortcutApi } from "./shortcuts.ts";
import { NoticedShortcuts, SettingsStore } from "./store.ts";
import { MenuBar } from "./tray.ts";
import {
  createAskWindow,
  createCapsuleWindow,
  createQuickWindow,
  createSettingsWindow,
  createSetupWindow,
  placeCapsule,
  placeQuick,
} from "./windows.ts";

// Quitting waits at most this long for stopped agent runs to finish their bookkeeping.
const QUIT_WAIT_MS = 10_000;
// How long a stopped recording's audio may take to arrive from the capsule (tests shorten it).
const AUDIO_TIMEOUT_MS = (process.env.AVANZEL_TEST === "1" && Number(process.env.AVANZEL_AUDIO_TIMEOUT_MS)) || 15_000;
// How long the download's progress stays in the capsule by itself; Settings → Voice keeps showing it (tests change it).
const PREPARING_SHOW_MS = (process.env.AVANZEL_TEST === "1" && Number(process.env.AVANZEL_PREPARING_SHOW_MS)) || 8_000;
// How long the capsule says that a shortcut picked on its notice works.
const PICKED_SHOW_MS = 3_000;
const HARNESS_NAMES: Record<string, string> = {
  claude: "Claude Code", codex: "Codex", opencode: "OpenCode", "cursor-agent": "Cursor Agent", gemini: "Gemini CLI",
};
export const harnessName = (name: string) => HARNESS_NAMES[name] ?? name;

interface Recording {
  mode: CapsuleMode;
  startedAt: number;
  shot?: { path: string; thumbnail: string; context: ScreenContext };
  maxTimer: NodeJS.Timeout;
  /** Asked to stop (the shortcut, the menu or the time limit); its audio is on the way. */
  stopping: boolean;
}

interface FilingJob {
  capturePath: string;
  text: string;
  transcribedIn: number | null;
  agent: string;
  /** Stops this filing's agent run: Edit, or quitting. */
  abort: AbortController;
  /** Edit stopped the run: what it did is taken back (`refile`), not shown. */
  edited: boolean;
  /** The editor's text after Edit, as the owner types it: what `keepEdit` saves. */
  draft?: string;
  /** The corrected words it files (File after Edit); a Cancel files the same ones as the job it refiles. */
  correction?: Correction;
  /** A line under the words on the filing card, e.g. why the recording itself wasn't kept. */
  detail?: string;
  /** Its run waits for the library (another run has it); the filing card says so until the run starts. */
  waiting?: boolean;
  outcome?: FileOutcome;
  pages?: FiledPage[];
}

/** The setup window and what it is doing, from the moment it opens until it closes. */
interface SetupSession {
  window: BrowserWindow;
  /** The step the window shows. */
  step: SetupStep;
  /** Where Looks good makes or uses the library. */
  libraryPath: string;
}

/** Words filed after Edit, on their way to the inbox: only in memory until the refile's `recapture` writes them. */
interface Correction {
  words: string;
  /** The job they correct: its capture's recording, transcriber and creation time go with them (`recaptureOptions`). */
  of: FilingJob;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const lastLines = (text: string, n = 3) => text.trim().split("\n").filter(Boolean).slice(-n).join("\n");

/** What an evening review that had nothing to file says: an empty inbox, or how many notes it left to their own filing or edit. */
function nothingFiled(left: number): string {
  if (!left) return "Inbox was empty.";
  return `Nothing to file right now: your ${left === 1 ? "note is" : "notes are"} still being filed or edited.`;
}

/** What an evening review says of the captures it couldn't file; when it filed none, why the first one wasn't (say, the agent can't start). */
function notFiled(failed: readonly FileOutcome[], filed: number): string {
  const still = `${failed.length} couldn't be filed and are still in the inbox.`;
  const why = filed ? "" : errorLine(failed[0]?.error ?? "");
  return why ? `${why}\n${still}` : still;
}

/** What Settings → Agents shows for what the engine's check found; null when it couldn't tell, so the agent shows as unchecked. */
function statusOf(check: AgentCheck): AgentStatus | null {
  if (check.ok) return { kind: check.how, seconds: check.seconds };
  if (check.why === "unknown") return null;
  if (check.why === "timeout") return { kind: "timeout" };
  return { kind: check.why, detail: check.detail };
}

/** The capsule's notice of a shortcut another app holds. */
type TakenShortcut = Extract<CapsuleState, { kind: "shortcut-taken" }>;

/**
 * Electron's global shortcuts or, when AVANZEL_FAKE_TAKEN_SHORTCUTS is set (comma-separated, possibly empty; the e2e
 * tests set it), a stand-in that registers nothing for real and refuses exactly the accelerators it lists.
 */
function shortcutApi(): ShortcutApi {
  const fake = process.env.AVANZEL_FAKE_TAKEN_SHORTCUTS;
  if (fake === undefined) return globalShortcut;
  const taken = new Set(fake.split(",").map((accelerator) => accelerator.trim()).filter(Boolean));
  return { register: (accelerator) => !taken.has(accelerator), unregister: () => {}, unregisterAll: () => {} };
}

export class Controller {
  private readonly store: SettingsStore;
  private readonly modelsDir: string;
  private vault: Vault | null = null;
  private capsule!: BrowserWindow;
  private settingsWindow: BrowserWindow | null = null;
  private quickWindow: BrowserWindow | null = null;
  private askWindow: BrowserWindow | null = null;
  /** The setup window's session while it is open. */
  private setup: SetupSession | null = null;
  private menuBar!: MenuBar;
  private capsuleState: CapsuleState = { kind: "hidden" };
  private recording: Recording | null = null;
  private job: FilingJob | null = null;
  /** The job whose words are in the capsule's editor: from Edit until File or Cancel (`refile`), or `keepEdit`. */
  private inEditor: FilingJob | null = null;
  private hideTimer: NodeJS.Timeout | null = null;
  private keepOpen = false;
  private queue: Promise<unknown> = Promise.resolve();
  /** Work in the queue that hasn't finished. */
  private queued = 0;
  /** Every agent run going on, by the controller that stops it. */
  private runs = new Map<AbortController, Promise<unknown>>();
  /** Captures from Edit until their edit is settled (filed again, kept or cancelled): evening reviews leave them be. */
  private readonly editing = new Set<string>();
  /** Captures whose own filing waits in the queue: evening reviews leave them to it. */
  private readonly queuedToFile = new Set<string>();
  /** Edits kept (`keepEdit`) whose words the queue hasn't saved yet. */
  private readonly kept = new Set<FilingJob>();
  /** Corrections no capture holds yet: their refile writes them, or quitting does when its wait runs out first. */
  private readonly unwritten = new Set<Correction>();
  private quitting = false;
  private transcriber: Transcriber | null = null;
  private transcriberKey = "";
  private model: ModelStatus = { kind: "missing", bytes: 0 };
  private libraryProblem: string | null = null;
  private readonly runState: RunStateStore;
  private shortcutProblems: Partial<Record<keyof Shortcuts, string>> = {};
  /** The notice of each shortcut another app holds, with its free alternatives, in the order they register. */
  private takenShortcuts: TakenShortcut[] = [];
  /** The taken shortcuts whose notice the capsule has shown, in this app run or an earlier one. */
  private readonly noticed: NoticedShortcuts;
  /** What each agent's check found in this app run, by harness name, for Settings → Agents. */
  private readonly agentChecks = new Map<string, AgentStatus>();
  /** The agent checks going on, each by the controller that stops it when Avanzel quits. */
  private readonly runningChecks = new Set<AbortController>();
  /** Avanzel is quitting, busy or not (`stopAgentChecks`): no agent check starts any more. */
  private checksStopped = false;
  private recent: FiledPage[] = [];
  private running = new Set<string>();
  private lastEveningCommits: string[] = [];
  private audioTimeout: NodeJS.Timeout | null = null;
  /** Whether the capsule page listens yet; commands for its recorder wait until it does. */
  private capsuleListening = false;
  private heldCommands: ("start" | "stop" | "cancel")[] = [];
  /** Notifications posted, kept for the e2e tests only. */
  private readonly notified: { title: string; body: string }[] = [];

  constructor(userData: string) {
    this.store = new SettingsStore(path.join(userData, "settings.json"));
    this.modelsDir = path.join(userData, "models");
    this.runState = new RunStateStore(path.join(userData, "run-state.json"));
    this.noticed = new NoticedShortcuts(path.join(userData, "noticed-shortcuts.json"));
  }

  // ---------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    // The capsule and the menu bar first: whatever goes wrong next, Avanzel stays reachable there.
    this.capsule = createCapsuleWindow();
    this.capsule.webContents.on("did-start-loading", () => {
      this.capsuleListening = false;
    });
    this.capsule.on("closed", () => app.quit());
    this.menuBar = new MenuBar((action) => void this.menuAction(action));
    const envLibrary = process.env.AVANZEL_LIBRARY;
    if (envLibrary) this.store.update({ libraryPath: envLibrary });
    this.openLibrary(this.store.get().libraryPath);
    // Before the shortcuts: one pressed while ps runs (applyShortcuts) finds what this Mac has, not "missing, 0 bytes".
    await this.refreshModelStatus();
    await this.applyShortcuts();
    this.noticeTakenShortcut();
    // With a library the speech models download unasked; without one, Settings → Voice offers them.
    if (this.vault && this.model.kind === "missing") void this.downloadModel();
    this.refreshMenu();
    setInterval(() => this.tick(), 60_000);
    powerMonitor.on("resume", () => this.tick());
    powerMonitor.on("unlock-screen", () => this.tick());
    this.tick();
    if (!this.vault) this.showHome();
  }

  /**
   * Whether quitting now would cut an agent run, work queued behind one, or an edit short, or leave
   * words only in memory (kept edits and corrections whose save failed): `stopForQuit` saves those.
   */
  busy(): boolean {
    return this.runs.size > 0 || this.queued > 0 || this.editing.size > 0 || this.kept.size > 0 || this.unwritten.size > 0;
  }

  /**
   * Before quitting: stop every agent run and agent check, and keep an open edit (`keepEdit`), then
   * wait (at most QUIT_WAIT_MS) while the engine does the runs' bookkeeping: protected files put
   * back, what a run left committed, the capture kept in the inbox. A check isn't waited for. Nothing
   * new starts meanwhile. Words the wait left only in memory (`saveUnwritten`) are saved all the same.
   */
  async stopForQuit(): Promise<void> {
    this.quitting = true;
    for (const abort of this.runs.keys()) abort.abort();
    this.stopAgentChecks();
    this.keepEdit();
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise<void>((resolve) => (timer = setTimeout(resolve, QUIT_WAIT_MS)));
    await Promise.race([Promise.allSettled([this.queue, ...this.runs.values()]), waited]);
    clearTimeout(timer);
    this.saveUnwritten();
  }

  /** What goes wrong opening it is kept in `libraryProblem`, which the menu and Settings show. */
  private openLibrary(libraryPath: string | null): void {
    this.vault = null;
    this.recent = [];
    this.dropTranscriber();
    this.libraryProblem = null;
    if (!libraryPath) return;
    const vault = new Vault(libraryPath);
    if (!vault.exists()) return;
    try {
      ensureDefaultTasks(vault);
      this.recent = recentFromLog(vault.root);
    } catch (error) {
      this.recent = [];
      this.libraryProblem = `Avanzel couldn't open the library at ${vault.root}: ${errorMessage(error)}`;
      return;
    }
    this.vault = vault;
    try {
      void this.transcriberFor(loadSettings(vault.root).voice);
    } catch {
      // a broken config.toml is reported by whatever needs the settings next
    }
  }

  private requireVault(): Vault {
    if (!this.vault) throw new AvanzelError("Set up your library first: Avanzel Settings → General.");
    return this.vault;
  }

  /** Always with the speech-to-text engine: the evening review may find recordings in the inbox. */
  private async librarian(harnessName?: string): Promise<Librarian> {
    const vault = this.requireVault();
    const settings = loadSettings(vault.root);
    return new Librarian(vault, settings, {
      harnessName: harnessName && harnessName !== "auto" ? harnessName : undefined,
      transcriber: await this.transcriberFor(settings.voice),
    });
  }

  /**
   * The engine the library's [voice] settings ask for, made again only when they change. Making one
   * costs nothing (the model loads on first use); one the settings can't make reports why on use.
   */
  private async transcriberFor(voice: VoiceSettings): Promise<Transcriber> {
    const key = JSON.stringify(voice);
    if (!this.transcriber || key !== this.transcriberKey) {
      const made = await makeTranscriber(voice, this.modelsDir).catch((error: unknown): Transcriber => ({
        engine: "none",
        transcribe: () => Promise.reject(error),
      }));
      this.dropTranscriber(); // the one these settings replace
      this.transcriber = made;
      this.transcriberKey = key;
    }
    return this.transcriber;
  }

  /** Lets the speech-to-text engine go: it frees its model (Parakeet's is ~700 MB) once the transcriptions in progress end. */
  private dropTranscriber(): void {
    const old = this.transcriber;
    this.transcriber = null;
    // Not awaited: release() waits for the transcriptions in progress, and `librarian()` would stall behind a long one.
    old?.release?.().catch((error: unknown) => console.error("speech model", error));
  }

  private agentName(harness?: string): string {
    try {
      const settings = this.vault ? loadSettings(this.vault.root) : undefined;
      if (!settings) return "your agent";
      return harnessName(selectHarness(settings, harness && harness !== "auto" ? harness : undefined).name);
    } catch {
      return "your agent";
    }
  }

  // ---------------------------------------------------------------- shortcuts & menu

  /**
   * Registers the shortcuts. When another app holds one, they are registered again with the running apps, which name
   * the app that probably holds it, and free alternatives are found for it. Each registration reads the shortcuts as
   * they are then, so one that ends after a newer change still registers what the settings say.
   */
  private async applyShortcuts(): Promise<void> {
    const api = shortcutApi();
    const handlers = {
      dictate: () => void this.toggleDictate(),
      capture: () => void this.toggleCapture(),
      type: () => this.openQuick(),
      ask: () => this.openAsk(),
    };
    let shortcuts = this.store.get().shortcuts;
    let registration = registerShortcuts(shortcuts, handlers, api);
    let running: string[] = [];
    if (registration.taken.length) {
      running = await runningAppNames();
      shortcuts = this.store.get().shortcuts;
      registration = registerShortcuts(shortcuts, handlers, api, running);
    }
    this.shortcutProblems = registration.problems;
    this.takenShortcuts = registration.taken.map((key) => ({
      kind: "shortcut-taken",
      key,
      accelerator: shortcuts[key],
      holder: likelyHolder(shortcuts[key], running),
      alternatives: freeAlternatives(key, shortcuts, api),
    }));
    // A shortcut that works now is named again should another app take it later.
    const keys = Object.keys(shortcuts) as (keyof Shortcuts)[];
    this.noticed.forget(keys.filter((key) => shortcuts[key] && !registration.problems[key]).map((key) => shortcuts[key]));
  }

  /**
   * At launch and when a library is set up, the capsule names a shortcut another app holds, with free ones to pick: one
   * it hasn't named before (`noticed`), since another app's shortcut stays taken from launch to launch. Not without a
   * library, whose menu has no Record a thought yet (Settings → Voice offers the free ones meanwhile), and never over
   * what the capsule already shows, such as a shortcut pressed while ps ran.
   */
  private noticeTakenShortcut(): void {
    if (!this.vault || this.capsuleState.kind !== "hidden") return;
    const taken = this.takenShortcuts.find((notice) => !this.noticed.has(notice.accelerator));
    if (taken) this.showTaken(taken);
  }

  /** The notice of a taken shortcut, which is then not shown at a later launch while it stays taken. */
  private showTaken(taken: TakenShortcut): void {
    this.noticed.add(taken.accelerator);
    this.setCapsule(taken);
  }

  /**
   * Use, on the capsule's notice of a taken shortcut: `accelerator` becomes `key`'s shortcut, the way Settings sets one.
   * The notice follows (`followShortcuts`): once that shortcut works, the capsule says so for a moment; if another app
   * took it meanwhile, the notice names it, with fresh alternatives.
   */
  async useShortcut(key: keyof Shortcuts, accelerator: string): Promise<void> {
    await this.changeApp({ shortcuts: { ...this.store.get().shortcuts, [key]: accelerator } }, key);
  }

  /**
   * A capsule showing the notice of a taken shortcut keeps up with the shortcuts, wherever they were changed: while that
   * action's shortcut doesn't work, it shows the shortcut it has now, with fresh alternatives. Once it works, it hides,
   * or says it works when the notice's own Use picked it (`picked`).
   */
  private followShortcuts(picked?: keyof Shortcuts): void {
    const state = this.capsuleState;
    if (state.kind !== "shortcut-taken") return;
    const taken = this.takenShortcuts.find((notice) => notice.key === state.key);
    if (taken) return this.showTaken(taken);
    if (picked === state.key && !this.shortcutProblems[picked]) {
      return this.setCapsule({ kind: "shortcut-picked", key: picked, accelerator: this.store.get().shortcuts[picked] }, PICKED_SHOW_MS);
    }
    this.setCapsule({ kind: "hidden" });
  }

  private async menuAction(action: string): Promise<void> {
    if (action === "dictate") return this.toggleDictate();
    if (action === "capture") return this.toggleCapture();
    if (action === "type") return this.openQuick();
    if (action === "ask") return this.openAsk();
    if (action === "settings") return this.showSettings();
    if (action === "setup") return this.showSetup();
    if (action === "open-library") return this.openLibraryFolder();
    if (action === "open-inbox" && this.vault) return void shell.openPath(this.vault.inbox);
    if (action === "undo-review") return void this.undoEveningReview();
    if (action === "quit") return app.quit();
    if (action.startsWith("open:")) return this.openPage(action.slice(5));
    if (action.startsWith("task:")) return void this.runTask(action.slice(5));
  }

  private menuInput(): MenuInput {
    const vault = this.vault;
    const now = new Date();
    const tasks = vault ? this.safeTasks(vault) : [];
    return {
      libraryReady: !!vault,
      problem: this.libraryProblem,
      inbox: vault ? vault.pending().length : 0,
      recent: this.recent,
      tasks: tasks.map((t) => ({
        id: t.id,
        name: t.name,
        at: t.enabled ? nextRun(t.schedule, now) : null,
        enabled: t.enabled,
        running: this.running.has(t.id),
      })),
      recording: !!this.recording,
      shortcuts: this.store.get().shortcuts,
      unregisteredShortcuts: Object.keys(this.shortcutProblems) as (keyof Shortcuts)[],
      undoableReview: this.lastEveningCommits.length > 0,
    };
  }

  refreshMenu(): void {
    try {
      this.menuBar.update(this.menuInput());
    } catch (error) {
      console.error("menu", error);
    }
  }

  /** The usable shadow tasks; Settings → Shadow tasks says what is wrong with the others. */
  private safeTasks(vault: Vault): ShadowTask[] {
    return loadTasksReport(vault).tasks;
  }

  // ---------------------------------------------------------------- capsule plumbing

  private setCapsule(state: CapsuleState, autoHideMs?: number): void {
    if (state.kind !== "editing") this.keepEdit(); // whatever replaces the editor (a recording, a typed thought, an error) keeps its edit
    this.capsuleState = state;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    const win = this.capsule;
    win.webContents.send("capsule:state", state);
    if (state.kind === "hidden") {
      win.setFocusable(false);
      win.setIgnoreMouseEvents(true, { forward: true });
      win.hide();
    } else {
      if (!win.isVisible()) {
        placeCapsule(win);
        win.showInactive();
      }
      if (state.kind === "editing") {
        win.setFocusable(true);
        win.setIgnoreMouseEvents(false);
        win.focus();
      } else {
        win.setFocusable(false);
      }
    }
    if (autoHideMs) this.scheduleHide(autoHideMs);
    this.refreshMenu();
  }

  /** The capsule page is listening: it may have missed the state sent while it loaded, and gets the commands held for it. */
  capsuleReady(): void {
    this.capsuleListening = true;
    this.capsule.webContents.send("capsule:state", this.capsuleState);
    for (const command of this.heldCommands.splice(0)) this.capsule.webContents.send("capsule:command", command);
  }

  /** A command for the capsule's recorder. Sent while its page loads, it would be lost: so it waits. */
  private capsuleCommand(command: "start" | "stop" | "cancel"): void {
    if (this.capsuleListening) this.capsule.webContents.send("capsule:command", command);
    else this.heldCommands.push(command);
  }

  private scheduleHide(ms: number): void {
    this.hideTimer = setTimeout(() => {
      if (this.keepOpen) return this.scheduleHide(1500);
      this.setCapsule({ kind: "hidden" });
    }, ms);
  }

  private fail(message: string, detail?: string, action?: CapsuleState extends infer S ? S extends { kind: "error"; action?: infer A } ? A : never : never): void {
    this.setCapsule({ kind: "error", message, detail, action });
  }

  // ---------------------------------------------------------------- recording

  async toggleDictate(): Promise<void> {
    if (this.recording) return this.stopRecording();
    return this.startRecording("dictate");
  }

  async toggleCapture(): Promise<void> {
    if (this.recording) return this.stopRecording();
    if (!(await this.readyToListen())) return;
    const screen = permissionStatus("screen");
    if (screen === "denied" || screen === "restricted") return this.cantSeeScreen();
    const vault = this.requireVault();
    if (this.capsule.isVisible()) this.setCapsule({ kind: "hidden" });
    await new Promise((r) => setTimeout(r, 80)); // let the capsule leave the screen before the shot
    try {
      // Not asked yet: this capture is what makes macOS ask. Without the grant it comes back blank.
      const [image, context] = await Promise.all([captureDisplay(), this.screenContext()]);
      if (looksBlank(image)) return this.cantSeeScreen();
      const shotPath = vault.newAttachmentPath(new Date(), ".png");
      writeFileSync(shotPath, image.toPNG());
      const thumbnail = image.resize({ width: 208 }).toDataURL();
      await this.startRecording("comment", { path: shotPath, thumbnail, context });
    } catch (error) {
      this.fail("Couldn't capture the screen", errorMessage(error));
    }
  }

  /** macOS applies a Screen Recording grant only when the app starts again. */
  private cantSeeScreen(): void {
    this.fail(
      "Avanzel can't see the screen yet",
      "Allow Avanzel under System Settings → Privacy & Security → Screen Recording, then quit and reopen Avanzel.",
      "open-screen-settings",
    );
  }

  private async screenContext(): Promise<ScreenContext> {
    const fake = process.env.AVANZEL_FAKE_FRONT_APP;
    if (fake !== undefined) {
      const [app, title, url] = fake.split("|");
      return { ...(app ? { app } : {}), ...(title ? { title } : {}), ...(url ? { url } : {}) };
    }
    const { bundleId: _ignored, ...context } = await frontContext();
    return context;
  }

  /**
   * Library, speech model and microphone must all be ready; explains what's missing otherwise. Without a library the
   * window that makes one comes forward (`showHome`), and the capsule shows nothing.
   */
  private async readyToListen(): Promise<boolean> {
    if (!this.vault) {
      this.showHome();
      return false;
    }
    if (this.model.kind === "error" && this.model.cause === "settings") {
      // Read again on every press: fixing the [voice] settings by hand is the only way out, and nothing watches the file.
      this.model = this.modelStatus();
      this.broadcast();
    }
    if (!process.env.AVANZEL_FAKE_TRANSCRIPT && this.model.kind !== "ready") {
      // A failed download waits for Try again: pressing the shortcut says so and fetches nothing.
      if (this.model.kind === "missing") void this.downloadModel();
      this.showModelStatus();
      return false;
    }
    if (!(await requestMicrophone())) {
      this.fail("Avanzel can't use the microphone", "Allow it under System Settings → Privacy & Security → Microphone.", "open-microphone-settings");
      return false;
    }
    return true;
  }

  private async startRecording(mode: CapsuleMode, shot?: Recording["shot"]): Promise<void> {
    if (mode === "dictate" && !(await this.readyToListen())) return;
    if (this.recording) {
      // Another tap started one while this one waited (say, on the microphone prompt).
      if (shot) rmSync(shot.path, { force: true });
      return;
    }
    this.clearAudioTimeout();
    const maxSeconds = this.vault ? loadSettings(this.vault.root).voice.maxRecordSeconds : 600;
    const recording: Recording = {
      mode,
      startedAt: Date.now(),
      shot,
      stopping: false,
      maxTimer: setTimeout(() => {
        if (this.recording === recording) void this.stopRecording();
      }, maxSeconds * 1000),
    };
    this.recording = recording;
    this.setCapsule({
      kind: "listening",
      mode,
      startedAt: recording.startedAt,
      fakeMic: !!process.env.AVANZEL_FAKE_AUDIO,
      microphoneId: this.store.get().microphoneId,
      ...(shot ? { thumbnail: shot.thumbnail } : {}),
    });
    this.capsuleCommand("start");
    try {
      globalShortcut.register("Escape", () => this.cancelRecording());
    } catch {
      // Esc is a convenience; the menu and the shortcut still stop the recording.
    }
  }

  async stopRecording(): Promise<void> {
    const recording = this.recording;
    if (!recording || recording.stopping) return; // a second tap while its audio is on the way
    recording.stopping = true;
    clearTimeout(recording.maxTimer);
    globalShortcut.unregister("Escape");
    this.setCapsule({ kind: "transcribing", mode: recording.mode });
    this.capsuleCommand("stop");
    this.clearAudioTimeout();
    this.audioTimeout = setTimeout(() => {
      this.audioTimeout = null;
      if (this.recording !== recording) return; // only ever this recording, never a newer one
      this.abandonRecording(recording);
      this.fail("The recording didn't arrive", "Try again; if it keeps happening, check the microphone in Settings → Voice.", "open-settings:voice");
    }, AUDIO_TIMEOUT_MS);
  }

  cancelRecording(): void {
    if (!this.recording) return;
    this.abandonRecording(this.recording);
    this.setCapsule({ kind: "hidden" });
  }

  micError(message: string): void {
    if (!this.recording) return;
    this.abandonRecording(this.recording);
    this.fail("The microphone didn't start", `${message}\nCheck Settings → Voice and System Settings → Privacy & Security → Microphone.`, "open-microphone-settings");
  }

  /** Give a recording up without its audio: the capsule lets go of the microphone, and a screenshot taken for it goes. */
  private abandonRecording(recording: Recording): void {
    clearTimeout(recording.maxTimer);
    this.clearAudioTimeout();
    globalShortcut.unregister("Escape");
    if (recording.shot) rmSync(recording.shot.path, { force: true });
    if (this.recording === recording) this.recording = null;
    this.capsuleCommand("cancel");
  }

  private clearAudioTimeout(): void {
    if (this.audioTimeout) clearTimeout(this.audioTimeout);
    this.audioTimeout = null;
  }

  async onAudio(received: Float32Array): Promise<void> {
    const recording = this.recording;
    if (!recording?.stopping) return; // audio no stop asked for, e.g. a late one from a recording given up
    this.clearAudioTimeout();
    this.recording = null;
    const vault = this.requireVault();
    const now = new Date();
    try {
      const samples = process.env.AVANZEL_FAKE_AUDIO ? await this.fakeAudio(process.env.AVANZEL_FAKE_AUDIO) : received;
      const { audioPath, unkept } = this.claimRecording(vault, now);
      let text = "";
      let engine = "";
      let seconds: number | null = null;
      if (samples.length >= 16000 * 0.3) {
        if (audioPath) writeWav(audioPath, samples, 16000);
        const started = performance.now();
        const transcript = await this.transcribe(samples);
        seconds = (performance.now() - started) / 1000;
        text = transcript.text.trim();
        engine = transcript.engine;
      }
      if (!text && audioPath) rmSync(audioPath, { force: true });

      if (recording.mode === "comment" && recording.shot) {
        (await this.librarian()).captureScreen({
          image: recording.shot.path,
          comment: text,
          ...(text ? { audio: audioPath, transcriber: engine } : {}),
          context: recording.shot.context,
        });
        this.setCapsule(
          {
            kind: "saved",
            text,
            thumbnail: recording.shot.thumbnail,
            context: recording.shot.context,
            note: "Saved to your inbox for tonight's review",
            ...(text && unkept ? { detail: unkept } : {}),
          },
          5000,
        );
        return;
      }
      if (!text) {
        return this.fail("No speech recognized", "If you did speak, check the microphone in Settings → Voice.", "open-settings:voice");
      }
      const capture = vault.newCapture(text, { source: "voice", audio: audioPath, transcriber: engine, now });
      this.afterCapture(capture.path, text, seconds, unkept);
    } catch (error) {
      this.fail(
        error instanceof AvanzelError ? error.message : "Couldn't transcribe that",
        error instanceof AvanzelError ? undefined : errorMessage(error),
        "open-settings:voice",
      );
    }
  }

  /**
   * A fresh path in raw/audio/YYYY/MM/ for the recording. When there can't be one, none, and one short
   * line saying why (`unkept`): the words are then saved without their recording, not lost with it.
   */
  private claimRecording(vault: Vault, now: Date): { audioPath: string | null; unkept?: string } {
    try {
      return { audioPath: vault.newAudioPath(now) };
    } catch (error) {
      if (error instanceof AvanzelError) {
        // The library refuses one when a link, or a file, is on the way.
        const folder = `raw/audio/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
        return { audioPath: null, unkept: `Only your words were kept: ${folder} isn't a plain folder. Remove the link or file on its path to keep recordings.` };
      }
      console.error("recording", error);
      return { audioPath: null, unkept: "Only your words were kept: the recording couldn't be saved." };
    }
  }

  private async fakeAudio(file: string): Promise<Float32Array> {
    const wav = readWav(file);
    return resampleTo16k(wav.samples, wav.sampleRate);
  }

  private async transcribe(samples: Float32Array): Promise<{ text: string; engine: string }> {
    const fake = process.env.AVANZEL_FAKE_TRANSCRIPT;
    if (fake !== undefined) return { text: fake, engine: "fake" };
    const transcriber = await this.transcriberFor(loadSettings(this.requireVault().root).voice);
    return transcriber.transcribe(samples, 16000);
  }

  // ---------------------------------------------------------------- filing

  /** `detail`: a line the capsule shows under the words, e.g. why the recording itself wasn't kept. */
  private afterCapture(capturePath: string, text: string, transcribedIn: number | null, detail?: string): void {
    if (this.store.get().fileMode === "evening") {
      this.setCapsule({ kind: "saved", text, note: "Saved to your inbox for tonight's review", ...(detail ? { detail } : {}) }, 4000);
      return;
    }
    this.beginFiling({ capturePath, text, transcribedIn, agent: this.agentName(), abort: new AbortController(), edited: false, detail });
  }

  /** Filing starts right away; Edit can stop it until it ends. */
  private beginFiling(job: FilingJob): void {
    this.showFiling(job);
    this.queuedToFile.add(job.capturePath);
    void this.enqueue(() => this.runFiling(job));
  }

  private showFiling(job: FilingJob): void {
    this.job = job;
    this.setCapsule({
      kind: "filing",
      text: job.text,
      agent: job.agent,
      transcribedIn: job.transcribedIn,
      canEdit: true,
      ...(job.detail ? { detail: job.detail } : {}),
      ...(job.waiting ? { waiting: true } : {}),
    });
  }

  /**
   * What the engine says of `job`'s filing: `WAITING` while another run (a question, a review, another
   * Avanzel) has the library, then the start of its own run. Its card shows the wait until the run starts.
   */
  private filingProgress(job: FilingJob, message: string): void {
    const waiting = message === WAITING;
    if (!!job.waiting === waiting) return;
    job.waiting = waiting;
    if (this.job === job && this.capsuleState.kind === "filing") this.showFiling(job);
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    this.queued++;
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined).finally(() => this.queued--);
    return run;
  }

  /** One agent run, stopped through `abort` by Edit or by quitting; once Avanzel is quitting, no run starts. */
  private async withRun<T>(work: (signal: AbortSignal) => Promise<T>, abort = new AbortController()): Promise<T> {
    if (this.quitting) abort.abort();
    const running = work(abort.signal);
    this.runs.set(abort, running);
    try {
      return await running;
    } finally {
      this.runs.delete(abort);
    }
  }

  private async runFiling(job: FilingJob): Promise<void> {
    this.queuedToFile.delete(job.capturePath); // its turn: should it not file the capture, a review may
    if (job.abort.signal.aborted) return; // Edit stopped it before its turn came
    if (!existsSync(job.capturePath)) {
      // Already filed meanwhile (e.g. by another Avanzel on this library); nothing left to do.
      if (this.job === job && this.capsuleState.kind === "filing") this.setCapsule({ kind: "hidden" });
      return;
    }
    const started = performance.now();
    let outcome: FileOutcome | undefined;
    const progress = (message: string) => this.filingProgress(job, message);
    try {
      [outcome] = await this.withRun(async (signal) => (await this.librarian()).file([job.capturePath], { signal, progress }), job.abort);
    } catch (error) {
      if (job.edited || this.quitting) return;
      return this.filingFailed(job, errorMessage(error));
    }
    job.outcome = outcome;
    if (job.edited || this.quitting) return; // Edit takes back what this run did (`refile`)
    const seconds = (performance.now() - started) / 1000;
    if (!outcome || !outcome.ok) return this.filingFailed(job, outcome?.error || outcome?.message || "The agent stopped without filing.", outcome);
    const vault = this.requireVault();
    job.pages = filedPages(vault.root, outcome.changes);
    this.recent = [...job.pages, ...this.recent.filter((p) => !job.pages?.some((q) => q.path === p.path))].slice(0, 3);
    if (this.job === job && this.capsuleState.kind === "filing") {
      this.setCapsule(
        { kind: "filed", agent: job.agent, seconds, pages: job.pages, canUndo: !!outcome.commit, message: outcome.message || "Filed." },
        8000,
      );
    } else {
      const first = job.pages[0];
      this.notify(`Filed by ${job.agent}`, first ? `${first.title} (${first.shelf})${job.pages.length > 1 ? ` and ${job.pages.length - 1} more` : ""}` : outcome.message, () => first && this.openPage(first.path));
    }
    this.refreshMenu();
  }

  /** `where`: what the card says of the owner's words when it isn't the usual (in the inbox, or kept aside by the engine). */
  private filingFailed(job: FilingJob, error: string, outcome?: FileOutcome, where?: string): void {
    where ??= outcome?.savedOriginal
      ? `Your words are kept in ${outcome.savedOriginal}; the inbox now holds the agent's version.`
      : "The note is still in your inbox; the evening review will try again.";
    const partial = outcome?.commit ? ` ${job.agent}'s partial edits are kept as their own commit in the library's history.` : "";
    const detail = `${lastLines(error)}\n${where}${partial}`;
    if (this.job === job && this.capsuleState.kind === "filing") this.fail(`${job.agent} couldn't file this note`, detail, "open-settings:agents");
    else this.notify("A note couldn't be filed", lastLines(error, 1));
    this.refreshMenu();
  }

  /**
   * Stops the agent at once and shows the words; Submit or Cancel then takes back what it did
   * (`refile`). Not while quitting: the editor would close with the app, and its words with it.
   */
  edit(): void {
    const job = this.job;
    if (!job || job.edited || this.quitting || this.capsuleState.kind !== "filing") return;
    job.edited = true;
    job.abort.abort();
    this.editing.add(job.capturePath);
    this.inEditor = job;
    this.setCapsule({ kind: "editing", text: job.text });
  }

  /** The editor's text, sent as the owner types: what `keepEdit` saves if neither File nor Cancel comes first. */
  editDraft(text: string): void {
    if (this.inEditor) this.inEditor.draft = text;
  }

  submitEdit(text: string): void {
    const job = this.inEditor;
    if (!job) return;
    const words = text.trim();
    if (!words || words === job.text) return this.cancelEdit(); // nothing to correct: no corrected words to save either
    this.refile(job, words);
  }

  cancelEdit(): void {
    const job = this.inEditor;
    if (!job) return;
    this.refile(job, null);
  }

  /**
   * After Edit: once the stopped run is over (queue order), undo the commit it made (its leftovers,
   * or its filing if it finished first), then file the corrected `words` as a fresh capture, or
   * (null) the capture as it was.
   */
  private refile(job: FilingJob, words: string | null): void {
    this.inEditor = null; // settled by File or Cancel: the editor closes without keeping the edit
    const correction = words === null ? null : this.correct(job, words);
    const next: FilingJob = {
      capturePath: job.capturePath,
      text: words ?? job.text,
      transcribedIn: job.transcribedIn,
      agent: job.agent,
      abort: new AbortController(),
      edited: false,
      correction: correction ?? job.correction,
    };
    this.showFiling(next);
    void this.enqueue(async () => {
      const problem = await this.takeBack(job); // first: undoing a finished filing puts the misheard capture back in the inbox
      try {
        if (correction && !this.unwritten.has(correction)) return; // corrected further meanwhile, or written as Avanzel quit
        next.capturePath = correction ? this.recapture(job, correction.words) : job.capturePath;
        if (correction) this.unwritten.delete(correction);
      } catch (error) {
        // The corrected words stay in `unwritten`, so quitting saves them; the misheard capture stays as it was.
        const original = existsSync(job.capturePath) ? "; the original note is still there" : "";
        return this.filingFailed(next, errorMessage(error), undefined, `Your corrected words are saved to your inbox when you quit${original}.`);
      } finally {
        this.settleEdit(job, next);
      }
      if (problem === null) return this.runFiling(next);
      if (this.job === next && this.capsuleState.kind === "filing") {
        const waiting = existsSync(next.capturePath) ? " The note waits in your inbox for the evening review." : "";
        this.fail("Couldn't take back the agent's first try", `${problem}${waiting}`);
      }
    });
  }

  /** File after Edit: `words` correct `job`'s, and replace any correction of `job` that no capture holds yet. */
  private correct(job: FilingJob, words: string): Correction {
    if (job.correction) this.unwritten.delete(job.correction);
    const correction = { words, of: job };
    this.unwritten.add(correction);
    return correction;
  }

  /**
   * `job`'s edit is settled, in queue order, so a review queued meanwhile still left its capture be.
   * When `next` is in the editor already (a second Edit), its capture is the one left be now.
   */
  private settleEdit(job: FilingJob, next: FilingJob): void {
    this.editing.delete(job.capturePath);
    if (next.edited) this.editing.add(next.capturePath);
  }

  /**
   * The editor is open as Avanzel quits, or something else takes the capsule (a recording, a typed
   * thought): the edit is kept rather than lost. Once the stopped run is over (queue order), what it
   * did is taken back and the draft saved as a fresh capture (`recapture`); empty or unchanged, the
   * capture stays as it was. Nothing is filed: it waits in the inbox for the evening review.
   */
  private keepEdit(): void {
    const job = this.inEditor;
    if (!job) return;
    this.inEditor = null; // File and Cancel no longer apply to it
    this.kept.add(job);
    void this.enqueue(async () => {
      try {
        const problem = await this.takeBack(job);
        this.saveDraft(job, (words) => this.recapture(job, words));
        if (problem !== null) this.notify("Couldn't take back the agent's first try", problem);
      } catch (error) {
        // The edit stays in `kept`, so quitting saves it.
        this.notify("Couldn't save your edit yet", `${errorMessage(error)}\nYour corrected words are saved to your inbox when you quit.`);
      } finally {
        this.editing.delete(job.capturePath);
      }
    });
  }

  /** A kept edit's words as a fresh capture (`save`), once: by the queue, or by quitting when its wait ran out first. */
  private saveDraft(job: FilingJob, save: (words: string) => unknown): void {
    if (!this.kept.has(job)) return;
    const words = job.draft?.trim();
    if (words && words !== job.text) {
      save(words);
      if (job.correction) this.unwritten.delete(job.correction); // corrected further by the draft
    }
    this.kept.delete(job);
  }

  /**
   * Quitting, and the queue didn't get to these in time: the drafts of kept edits, then the corrections
   * no capture holds yet, are saved as fresh captures anyway, beside the misheard ones.
   */
  private saveUnwritten(): void {
    const save = (words: string, of: FilingJob) => this.requireVault().newCapture(words, this.recaptureOptions(of));
    for (const job of this.kept) {
      try {
        this.saveDraft(job, (words) => save(words, job));
      } catch (error) {
        console.error("keep edit", error);
      }
    }
    for (const correction of this.unwritten) {
      try {
        save(correction.words, correction.of);
        this.unwritten.delete(correction);
      } catch (error) {
        console.error("keep edit", error);
      }
    }
  }

  /** Undo the commit a stopped run made (none without git or auto_commit, or when it changed nothing); null, or why it couldn't. */
  private async takeBack(job: FilingJob): Promise<string | null> {
    const commit = job.outcome?.commit;
    if (!commit) return null;
    try {
      return (await (await this.librarian()).undo([commit])) === 1 ? null : "Git refused to undo it; see the library's history.";
    } catch (error) {
      return errorMessage(error);
    }
  }

  /**
   * The corrected words as a fresh capture, so its id (and every [[link]] to it) carries them, with
   * the recording, transcriber and creation time of the misheard one. That one goes first (kept
   * aside until the new one is written), so the id needs no "-2". Returns the new capture's path.
   */
  private recapture(job: FilingJob, words: string): string {
    const vault = this.requireVault();
    const old = job.capturePath;
    const options = this.recaptureOptions(job);
    const inInbox = existsSync(old); // filed meanwhile, it is in raw/, and left be
    const aside = path.join(path.dirname(old), `.${path.basename(old)}.editing`);
    if (inInbox) renameSync(old, aside);
    try {
      const fresh = vault.newCapture(words, options);
      if (inInbox) rmSync(aside, { force: true });
      return fresh.path;
    } catch (error) {
      if (inInbox) renameSync(aside, old);
      throw error;
    }
  }

  /** What the corrected words keep of the misheard capture: its source, recording, transcriber and creation time. */
  private recaptureOptions(job: FilingJob): CaptureOptions {
    const vault = this.requireVault();
    // Filed meanwhile, it is in raw/: read what to keep from there.
    const source = [job.capturePath, vault.archivePath(job.capturePath)].find((file) => existsSync(file));
    const meta = source ? captureMeta(source) : { source: "text" };
    return {
      source: meta.source,
      audio: meta.audio ? path.join(vault.root, meta.audio) : null,
      transcriber: meta.transcriber ?? null,
      now: meta.created ?? new Date(),
    };
  }

  async undo(): Promise<void> {
    const job = this.job;
    const commit = job?.outcome?.commit;
    if (!job || !commit) return;
    const undone = await this.enqueue(async () => (await this.librarian()).undo([commit]));
    this.recent = recentFromLog(this.requireVault().root);
    this.setCapsule(
      undone ? { kind: "saved", text: job.text, note: "Undone. The note is back in your inbox." } : { kind: "error", message: "Couldn't undo", detail: "Git refused the revert; see the library's history." },
      undone ? 3500 : undefined,
    );
  }

  openFiled(): void {
    const page = this.job?.pages?.[0];
    if (page) this.openPage(page.path);
    this.setCapsule({ kind: "hidden" });
  }

  dismiss(): void {
    if (this.capsuleState.kind === "listening") return this.cancelRecording();
    if (this.capsuleState.kind === "editing") return this.cancelEdit();
    this.setCapsule({ kind: "hidden" });
  }

  setKeepOpen(keep: boolean): void {
    this.keepOpen = keep;
  }

  setInteractive(interactive: boolean): void {
    if (this.capsuleState.kind === "editing") return;
    this.capsule.setIgnoreMouseEvents(!interactive, { forward: true });
  }

  openSettingsFor(action: string): void {
    if (action === "open-microphone-settings") void this.openPrivacy("microphone");
    else if (action === "open-screen-settings") void this.openPrivacy("screen");
    else {
      // The capsule's page sends `action`: a pane Settings doesn't have means General.
      const pane = /^open-settings:(.*)$/.exec(action)?.[1];
      this.showSettings(isSettingsPane(pane) ? pane : "general");
    }
    this.setCapsule({ kind: "hidden" });
  }

  /**
   * macOS lists an app under Screen Recording only once it has tried to capture the screen, and to
   * Electron "never asked" looks the same as "denied": so try once first (nothing is kept).
   */
  async openPrivacy(kind: "microphone" | "screen"): Promise<void> {
    if (kind === "screen" && permissionStatus("screen") !== "granted") await captureDisplay().catch(() => undefined);
    openPrivacyPane(kind);
  }

  // ---------------------------------------------------------------- quick type & ask

  openQuick(): void {
    if (!this.vault) return this.showHome();
    if (!this.quickWindow || this.quickWindow.isDestroyed()) {
      const created = createQuickWindow();
      created.on("blur", () => created.hide());
      this.quickWindow = created;
    }
    const win = this.quickWindow;
    placeQuick(win);
    app.focus({ steal: true });
    win.show();
    win.focus();
  }

  closeQuick(): void {
    this.quickWindow?.hide();
  }

  /** Type instead, on the capsule while Avanzel can't listen yet: the capsule goes and Quick opens. */
  typeInstead(): void {
    this.setCapsule({ kind: "hidden" });
    this.openQuick();
  }

  async submitQuick(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.closeQuick();
    let capture: Capture;
    try {
      capture = this.requireVault().newCapture(trimmed, { source: "text", now: new Date() });
    } catch (error) {
      // The words stay in the type-a-thought box for another try.
      this.fail("Couldn't save that thought", `${errorMessage(error)}\nIt is still in the box: press ${prettyAccelerator(this.store.get().shortcuts.type)} to try again.`);
      throw error;
    }
    this.afterCapture(capture.path, trimmed, null);
  }

  openAsk(): void {
    if (!this.vault) return this.showHome();
    if (!this.askWindow || this.askWindow.isDestroyed()) {
      this.askWindow = createAskWindow();
      this.askWindow.once("ready-to-show", () => this.askWindow?.show());
    }
    app.focus({ steal: true });
    this.askWindow.show();
    this.askWindow.focus();
  }

  closeAsk(): void {
    this.askWindow?.close();
  }

  async ask(question: string): Promise<AskResult> {
    const agent = this.agentName();
    const started = performance.now();
    const win = this.askWindow; // the window that asked, even once another one opens
    // The engine's messages go to the Ask window as they are, except its waiting one: that names no run, and here it is usually a filing.
    const progress = (message: string) => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send("ask:progress", message === WAITING ? "Waiting for the filing in progress to finish…" : message);
    };
    // Closing that window gives the question up: its agent run stops, and the library is free for a filing waiting on it.
    const abort = new AbortController();
    const giveUp = () => abort.abort();
    if (win?.isDestroyed()) giveUp();
    else win?.once("closed", giveUp);
    try {
      const outcome = await this.withRun(async (signal) => (await this.librarian()).ask(question, { save: false, signal, progress }), abort);
      const seconds = (performance.now() - started) / 1000;
      return outcome.result.ok
        ? { ok: true, answer: outcome.result.output, agent, seconds }
        : { ok: false, answer: `${agent} couldn't answer:\n${lastLines(outcome.result.stderr || outcome.result.output)}`, agent, seconds };
    } catch (error) {
      return { ok: false, answer: errorMessage(error), agent, seconds: (performance.now() - started) / 1000 };
    } finally {
      if (win && !win.isDestroyed()) win.removeListener("closed", giveUp);
    }
  }

  openPageByName(name: string): void {
    const vault = this.vault;
    const rel = vault ? findPage(vault.root, name) : null;
    if (rel) this.openPage(rel);
  }

  // ---------------------------------------------------------------- opening things

  private obsidianInstalled(): boolean {
    return !!app.getApplicationNameForProtocol("obsidian://");
  }

  openPage(rel: string): void {
    const vault = this.vault;
    if (!vault) return;
    const url = this.obsidianInstalled() ? obsidianUrl(vault.root, rel) : null;
    if (url) void shell.openExternal(url);
    else void shell.openPath(path.join(vault.root, rel));
  }

  openLibraryFolder(): void {
    const vault = this.vault;
    if (!vault) return this.showHome();
    const url = this.obsidianInstalled() ? obsidianUrl(vault.root, "") : null;
    if (url) void shell.openExternal(url);
    else void shell.openPath(vault.root);
  }

  private notify(title: string, body: string, onClick?: () => void): void {
    if (this.quitting) return;
    if (process.env.AVANZEL_TEST === "1") this.notified.push({ title, body });
    if (!Notification.isSupported()) return;
    const note = new Notification({ title, body, silent: false });
    if (onClick) note.on("click", onClick);
    note.show();
  }

  // ---------------------------------------------------------------- settings

  /** With a `pane`, a new window opens on it and an open one moves to it; without, a new one opens on General and an open one stays put. */
  showSettings(pane?: SettingsPane): void {
    if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
      this.settingsWindow = createSettingsWindow(pane);
      this.settingsWindow.once("ready-to-show", () => this.settingsWindow?.show());
    } else if (pane) {
      this.settingsWindow.webContents.send("settings:show-pane", pane);
    }
    app.focus({ steal: true });
    this.settingsWindow.show();
    this.settingsWindow.focus();
  }

  private broadcast(): void {
    const win = this.settingsWindow;
    if (win && !win.isDestroyed()) win.webContents.send("settings:changed", this.snapshot());
    const setup = this.setup?.window;
    if (setup && !setup.isDestroyed()) setup.webContents.send("setup:changed", this.setupSnapshot());
    this.refreshMenu();
  }

  snapshot(): SettingsSnapshot {
    const vault = this.vault;
    let settings: Settings | null = null;
    try {
      settings = vault ? loadSettings(vault.root) : null;
    } catch {
      settings = null;
    }
    const all = settings ? listHarnesses(settings) : {};
    let selected: string | null = null;
    try {
      selected = settings ? selectHarness(settings).name : null;
    } catch {
      selected = null;
    }
    const stateRuns = vault ? this.readRunState(vault).ran : {};
    const report = vault ? loadTasksReport(vault) : { tasks: [], problems: [] };
    const now = new Date();
    return {
      app: this.store.get(),
      library: vault
        ? {
            path: vault.root,
            exists: vault.exists(),
            isGit: existsSync(path.join(vault.root, ".git")),
            inbox: vault.pending().length,
            shelves: vault.shelfCounts(),
            harness: settings?.harness ?? "auto",
            models: settings?.models ?? {},
            timeoutSeconds: settings?.timeoutSeconds ?? 900,
          }
        : this.store.get().libraryPath
          ? { path: this.store.get().libraryPath!, exists: false, isGit: false, inbox: 0, shelves: {}, harness: "auto", models: {}, timeoutSeconds: 900 }
          : null,
      defaultLibraryPath: path.join(homedir(), "Avanzel"),
      harnesses: Object.values(all).map((h) => ({
        name: h.name,
        available: h.available(),
        experimental: h.experimental,
        freeCheck: h.signIn !== undefined,
        status: this.agentChecks.get(h.name) ?? null,
      })),
      selectedHarness: selected,
      model: this.model,
      permissions: { microphone: permissionStatus("microphone"), screen: permissionStatus("screen") },
      libraryProblem: this.libraryProblem,
      tasks: report.tasks.map((t): TaskInfo => ({
        id: t.id,
        name: t.name,
        schedule: formatSchedule(t.schedule),
        kind: t.kind,
        agent: t.agent,
        enabled: t.enabled,
        instructions: t.instructions,
        lastRun: stateRuns[t.id] ?? null,
        nextRun: t.enabled ? nextRun(t.schedule, now).toISOString() : null,
        running: this.running.has(t.id),
      })),
      taskProblems: report.problems.map((p) => ({ file: vault ? vault.relativePath(p.file) : p.file, message: p.message })),
      shortcutProblems: this.shortcutProblems,
      shortcutAlternatives: Object.fromEntries(this.takenShortcuts.map((taken) => [taken.key, taken.alternatives])),
      obsidian: this.obsidianInstalled(),
    };
  }

  /** Changed shortcuts are registered before it returns, so its snapshot says which are taken, with their alternatives. */
  async setApp(patch: Partial<AppSettings>): Promise<SettingsSnapshot> {
    return this.changeApp(patch);
  }

  /** setApp, for `picked`'s shortcut chosen on the capsule's notice of a taken one, when it is (`useShortcut`). */
  private async changeApp(patch: Partial<AppSettings>, picked?: keyof Shortcuts): Promise<SettingsSnapshot> {
    const before = this.store.get();
    const after = this.store.update(patch);
    if (JSON.stringify(before.shortcuts) !== JSON.stringify(after.shortcuts)) {
      await this.applyShortcuts();
      this.followShortcuts(picked);
    }
    if (patch.launchAtLogin !== undefined) app.setLoginItemSettings({ openAtLogin: after.launchAtLogin });
    this.broadcast();
    return this.snapshot();
  }

  async setLibrarySettings(patch: { harness?: string; models?: Record<string, string>; timeoutSeconds?: number }): Promise<SettingsSnapshot> {
    const vault = this.requireVault();
    await this.enqueue(async () => {
      const settings = loadSettings(vault.root);
      saveSettings(vault.root, {
        ...settings,
        ...(patch.harness !== undefined ? { harness: patch.harness } : {}),
        ...(patch.models !== undefined ? { models: patch.models } : {}),
        ...(patch.timeoutSeconds !== undefined ? { timeoutSeconds: patch.timeoutSeconds } : {}),
      });
    });
    this.broadcast();
    return this.snapshot();
  }

  async chooseLibrary(): Promise<SettingsSnapshot> {
    const parent = this.settingsWindow && !this.settingsWindow.isDestroyed() ? this.settingsWindow : undefined;
    const options = { title: "Choose your library folder", properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    const chosen = result.filePaths[0];
    if (result.canceled || !chosen) return this.snapshot();
    if (!new Vault(chosen).exists()) {
      const entries = readdirSync(chosen).filter((name) => name !== ".DS_Store");
      if (entries.length) {
        const confirm = await dialog.showMessageBox({
          type: "question",
          buttons: ["Use This Folder", "Cancel"],
          defaultId: 1,
          cancelId: 1,
          message: `Turn “${path.basename(chosen)}” into your Avanzel library?`,
          detail: "It already has files. Avanzel will add its shelves, an AGENTS.md for your agent, and git history that includes the existing files.",
        });
        if (confirm.response !== 0) return this.snapshot();
      }
      await Vault.init(chosen, { git: true });
    }
    return this.useLibrary(chosen);
  }

  async createLibrary(requested: string): Promise<SettingsSnapshot> {
    const target = path.resolve(requested.replace(/^~(?=$|\/)/, homedir()));
    if (!new Vault(target).exists() && existsSync(target) && readdirSync(target).some((n) => n !== ".DS_Store")) {
      throw new AvanzelError(`${target} already has files in it. Use “Choose existing…” to turn it into a library, or pick an empty folder.`);
    }
    mkdirSync(target, { recursive: true });
    await Vault.init(target, { git: true });
    return this.useLibrary(target);
  }

  private async useLibrary(target: string): Promise<SettingsSnapshot> {
    this.store.update({ libraryPath: target });
    this.openLibrary(target);
    try {
      rememberVault(target);
    } catch (error) {
      console.error("remember vault", error);
    }
    await this.refreshModelStatus(); // its [voice] settings say which speech models it needs
    if (this.vault && this.model.kind === "missing") void this.downloadModel();
    this.checkAgents();
    this.noticeTakenShortcut(); // the menu has Record a thought now
    this.broadcast();
    return this.snapshot();
  }

  // ---------------------------------------------------------------- setup

  /**
   * Avanzel's own window, for whatever asks for one: the shortcut, Quick or Ask before there is a library, or opening
   * Avanzel again. Setup while there is no library, unless one failed to open (`libraryProblem`): Settings says why,
   * and fixes it. With a library, Settings.
   */
  showHome(): void {
    if (!this.vault && this.libraryProblem === null) return this.showSetup();
    this.showSettings();
  }

  /** Brings the setup window forward, or opens a new one, which starts a new session on Hello once it has drawn. */
  showSetup(): void {
    if (this.setup && !this.setup.window.isDestroyed()) {
      app.focus({ steal: true });
      this.setup.window.show();
      this.setup.window.focus();
      return;
    }
    const win = createSetupWindow();
    // Shown once its page has drawn, so it never flashes blank first.
    win.once("ready-to-show", () => {
      if (win.isDestroyed()) return;
      app.focus({ steal: true });
      win.show();
      win.focus();
    });
    win.on("closed", () => this.endSetup(win));
    this.setup = { window: win, step: "hello", libraryPath: this.setupLibraryPath() };
  }

  /** The setup window closed: its session ends with it. A newer window's session is its own. */
  private endSetup(win: BrowserWindow): void {
    if (this.setup?.window === win) this.setup = null;
  }

  /** Where a new session makes or uses the library: the stored libraryPath, else ~/Avanzel. */
  private setupLibraryPath(): string {
    return this.store.get().libraryPath ?? path.join(homedir(), "Avanzel");
  }

  /** What the setup window shows; without a session, what a fresh one would show. */
  setupSnapshot(): SetupSnapshot {
    const libraryPath = this.setup?.libraryPath ?? this.setupLibraryPath();
    return {
      libraryPath,
      libraryLabel: tildePath(libraryPath, homedir()),
      folder: libraryFolder(libraryPath),
      libraryReady: !!this.vault,
      model: this.model,
      shortcut: this.store.get().shortcuts.dictate,
    };
  }

  /** The setup window shows `step` now; anything that isn't a step is ignored. Each step's work hangs on this. */
  enterSetupStep(step: SetupStep): SetupSnapshot {
    if (this.setup && isSetupStep(step)) this.setup.step = step;
    return this.setupSnapshot();
  }

  // ---------------------------------------------------------------- agent checks

  /**
   * Starts the free checks of the installed agents not checked yet in this app run: each reads the agent's own sign-in
   * command and never asks the model (`prompt: false`). A sign-in it can't read leaves the agent unchecked, for Check.
   * It returns at once; Settings gets each result through settings:changed.
   */
  checkAgents(): SettingsSnapshot {
    const vault = this.vault;
    if (vault) {
      for (const [name, harness] of Object.entries(this.harnessesOf(vault))) {
        if (harness.signIn && !this.agentChecks.has(name) && harness.available()) void this.runAgentCheck(name, harness, vault, false);
      }
    }
    return this.snapshot();
  }

  /**
   * Checks agent `name` again (Check, in Settings → Agents): its sign-in command, then its one short question when it
   * has none or that doesn't say. A check under way is left to finish.
   */
  checkAgent(name: string): SettingsSnapshot {
    const vault = this.vault;
    const table = vault ? this.harnessesOf(vault) : {};
    const harness = Object.hasOwn(table, name) ? table[name] : undefined;
    if (vault && harness && this.agentChecks.get(name)?.kind !== "checking") void this.runAgentCheck(name, harness, vault, true);
    return this.snapshot();
  }

  /** The library's agents by name: none when its settings don't load. */
  private harnessesOf(vault: Vault): Record<string, Harness> {
    try {
      return listHarnesses(loadSettings(vault.root));
    } catch {
      return {};
    }
  }

  /**
   * When Avanzel quits, busy or not: stops every agent check still going on, its agent too (it runs detached, and its
   * timeout lives here), and no check starts after it. Quitting doesn't wait for them, and what they find is dropped.
   */
  stopAgentChecks(): void {
    this.checksStopped = true;
    for (const abort of this.runningChecks) abort.abort();
  }

  /**
   * One check, in the library: Settings shows it running, then what it found. Only with `prompt` may it ask the model.
   * Once Avanzel is quitting, none starts.
   */
  private async runAgentCheck(name: string, harness: Harness, vault: Vault, prompt: boolean): Promise<void> {
    if (this.quitting || this.checksStopped) return;
    const abort = new AbortController();
    this.runningChecks.add(abort);
    this.agentChecks.set(name, { kind: "checking" });
    this.broadcast();
    let status: AgentStatus | null;
    try {
      status = statusOf(await checkHarness(harness, vault.root, { signal: abort.signal, prompt }));
    } catch (error) {
      status = { kind: "failed", detail: errorMessage(error) }; // a check that throws still ends
    } finally {
      this.runningChecks.delete(abort);
    }
    if (abort.signal.aborted) return; // stopped for quitting: its "… was cancelled" is no news
    if (status) this.agentChecks.set(name, status);
    else this.agentChecks.delete(name); // a sign-in it couldn't read: back to "Installed", with Check
    this.broadcast();
  }

  // ---------------------------------------------------------------- speech model

  /** The [voice] settings the speech models are for: the library's, or the defaults while there is none. */
  private voiceOptions(): VoiceOptions {
    return this.vault ? loadSettings(this.vault.root).voice : defaultSettings().voice;
  }

  /**
   * Whether this Mac has the speech models the voice settings need (a command needs none): ready, missing with the
   * bytes a download would fetch, or an error saying why it can't tell, say a config.toml that doesn't load.
   */
  private modelStatus(): ModelStatus {
    try {
      const voice = this.voiceOptions();
      const ids = speechModels(voice);
      const missing = missingModels(ids, this.modelsDir, voice.quantization);
      if (missing.length) return { kind: "missing", bytes: downloadSize(missing, this.modelsDir, voice.quantization) };
      const [parakeet] = ids; // none for a command
      return { kind: "ready", dir: parakeet ? (locateModel(parakeet, this.modelsDir, voice.quantization) ?? "") : "" };
    } catch (error) {
      return { kind: "error", cause: "settings", message: errorMessage(error) };
    }
  }

  /** The status from what is on this Mac now (`modelStatus`); a download in progress keeps its own. */
  private async refreshModelStatus(): Promise<void> {
    if (this.model.kind !== "downloading") this.model = this.modelStatus();
  }

  /** Fetches the speech models the voice settings need and this Mac doesn't have, in one download. */
  async downloadModel(): Promise<SettingsSnapshot> {
    if (this.model.kind === "downloading" || this.model.kind === "ready") return this.snapshot();
    let voice: VoiceOptions;
    let missing: string[];
    let bytes: number;
    try {
      voice = this.voiceOptions();
      missing = missingModels(speechModels(voice), this.modelsDir, voice.quantization);
      bytes = downloadSize(missing, this.modelsDir, voice.quantization);
    } catch (error) {
      this.model = { kind: "error", cause: "settings", message: errorMessage(error) }; // [voice] settings it can't use: nothing to fetch
      this.broadcast();
      return this.snapshot();
    }
    // The size is known before the first byte arrives, so the progress reads "0 of 673 MB" from the start.
    this.model = { kind: "downloading", receivedBytes: 0, totalBytes: bytes };
    this.broadcast();
    let lastBroadcast = 0;
    void downloadModels(missing, this.modelsDir, {
      quantization: voice.quantization,
      baseUrl: process.env.AVANZEL_MODELS_URL || undefined, // unset: Hugging Face; the e2e tests set a local stand-in
      onProgress: (p) => {
        const progress = { receivedBytes: p.overallReceived, totalBytes: p.overallTotal ?? bytes };
        this.model = { kind: "downloading", ...progress };
        if (Date.now() - lastBroadcast > 250) {
          lastBroadcast = Date.now();
          this.broadcast();
          this.followDownload({ kind: "preparing", ...progress });
        }
      },
    })
      .then(() => {
        // Looked for again, not taken from the download: when only Silero was fetched, Parakeet is the cache copy.
        this.model = this.modelStatus();
        this.dropTranscriber();
        if (this.model.kind === "ready") {
          this.notify("Avanzel is ready to listen", "The speech model is downloaded. Press the shortcut and start talking.");
        }
        this.followDownload({ kind: "hidden" });
      })
      .catch((error) => {
        this.model = { kind: "error", cause: "download", message: errorMessage(error) };
        this.followDownload({ kind: "model-failed" });
      })
      .finally(() => this.broadcast());
    return this.snapshot();
  }

  /**
   * A capsule showing the download's progress follows it to its end; the download never opens the capsule itself. The
   * progress leaves the card's hide timer running.
   */
  private followDownload(state: CapsuleState): void {
    if (this.capsuleState.kind !== "preparing") return;
    if (state.kind !== "preparing") return this.setCapsule(state);
    this.capsuleState = state;
    this.capsule.webContents.send("capsule:state", state);
  }

  /**
   * What the shortcut shows while the speech models aren't ready: the download's progress, which hides itself after a
   * few seconds unless the pointer is on it, a failed download with Try again, or the [voice] settings that keep
   * anything from downloading. The other two stay until the person acts on them.
   */
  private showModelStatus(): void {
    const model = this.model;
    if (model.kind === "downloading") this.setCapsule({ kind: "preparing", receivedBytes: model.receivedBytes, totalBytes: model.totalBytes }, PREPARING_SHOW_MS);
    else if (model.kind === "error" && model.cause === "download") this.setCapsule({ kind: "model-failed" });
    else if (model.kind === "error") this.fail("Avanzel can't use these voice settings", model.message);
    else this.setCapsule({ kind: "hidden" }); // ready: nothing to wait for (missing never gets here: downloadModel() runs first)
  }

  /** Try again, on the capsule's notice of a failed download: the download starts over, and the capsule shows it. */
  retryDownload(): void {
    void this.downloadModel();
    this.showModelStatus();
  }

  async requestPermission(kind: "microphone" | "screen"): Promise<SettingsSnapshot> {
    if (kind === "microphone") await requestMicrophone();
    else await captureDisplay().catch(() => undefined); // asking for a screenshot is what makes macOS ask
    return this.snapshot();
  }

  // ---------------------------------------------------------------- shadow tasks

  /** Kept with the app, not in the library (where older builds kept it, in `.avanzel/state.json`). */
  private readRunState(vault: Vault): RunState {
    return this.runState.get(vault.root, path.join(vault.metaDir, "state.json"));
  }

  private writeRunState(vault: Vault, state: RunState): void {
    this.runState.set(vault.root, state);
  }

  private tick(): void {
    const vault = this.vault;
    if (!vault) return this.refreshMenu();
    const tasks = this.safeTasks(vault);
    const state = this.readRunState(vault);
    const now = new Date();
    const byText = new Map(tasks.map((t) => [formatSchedule(t.schedule), t.schedule]));
    const { due, baseline } = dueTasks(
      tasks.map((t) => ({ id: t.id, schedule: formatSchedule(t.schedule), enabled: t.enabled })),
      state.checked,
      now,
      (text, at) => lastDue(byText.get(text) ?? parseSchedule(text), at),
    );
    if (baseline.length) this.writeRunState(vault, markChecked(state, baseline, now));
    for (const id of due) void this.runTask(id);
    this.refreshMenu();
  }

  /** Task and settings files are protected during agent runs, so writes wait for the filing queue. */
  async saveTaskFromSettings(patch: Pick<TaskInfo, "id" | "name" | "schedule" | "agent" | "enabled" | "instructions">): Promise<SettingsSnapshot> {
    const vault = this.requireVault();
    const schedule = parseSchedule(patch.schedule);
    await this.enqueue(async () => {
      const task = this.safeTasks(vault).find((t) => t.id === patch.id);
      if (!task) throw new AvanzelError(`No shadow task called ${patch.id}.`);
      saveTask(vault, { ...task, name: patch.name, schedule, agent: patch.agent, enabled: patch.enabled, instructions: patch.instructions });
    });
    this.broadcast();
    return this.snapshot();
  }

  /** Run a shadow task now: by hand (the menu, Run now), or because it is due (`tick`). */
  async runTask(id: string): Promise<SettingsSnapshot> {
    const vault = this.vault;
    if (!vault || this.running.has(id)) return this.snapshot();
    const task = this.safeTasks(vault).find((t) => t.id === id);
    if (!task) return this.snapshot();
    this.writeRunState(vault, markRan(this.readRunState(vault), id, new Date()));
    this.running.add(id);
    this.broadcast();
    void this.enqueue(() => this.executeTask(task)).finally(() => {
      this.running.delete(id);
      this.recent = this.vault ? recentFromLog(this.vault.root) : [];
      this.broadcast();
    });
    return this.snapshot();
  }

  /**
   * What an evening review leaves alone, each noted in `left`: a capture being edited (its edit files the
   * corrected words, once) or one whose own filing waits in the queue (that files it, on its own card).
   */
  private leftAlone(left: Set<string>): (capturePath: string) => boolean {
    return (capturePath) => {
      const theirs = this.editing.has(capturePath) || this.queuedToFile.has(capturePath);
      if (theirs) left.add(capturePath);
      return theirs;
    };
  }

  private async executeTask(task: ShadowTask): Promise<void> {
    const agent = this.agentName(task.agent);
    try {
      if (task.kind === "evening-review") {
        const left = new Set<string>();
        const result = await this.withRun(async (signal) =>
          (await this.librarian(task.agent)).eveningReview({ instructions: task.instructions, signal, leave: this.leftAlone(left) }));
        if (!result.outcomes.length) {
          this.notify(task.name, nothingFiled(left.size));
          return;
        }
        this.lastEveningCommits = result.commits;
        const failed = result.outcomes.filter((o) => !o.ok);
        const filed = result.outcomes.length - failed.length;
        const digest = result.digestPath;
        this.notify(
          `${task.name}: ${filed} ${filed === 1 ? "thing" : "things"} filed`,
          failed.length ? notFiled(failed, filed) : `${agent} sorted today's inbox. Click to read the summary.`,
          digest ? () => this.openPage(path.relative(this.requireVault().root, digest)) : undefined,
        );
      } else if (task.kind === "review") {
        const outcome = await this.withRun(async (signal) => (await this.librarian(task.agent)).review({ signal }));
        const report = outcome.report;
        this.notify(
          outcome.result.ok ? `${task.name} is ready` : `${task.name} didn't finish`,
          outcome.result.ok ? `${agent} looked over your library. Click to read it.` : lastLines(outcome.result.stderr || outcome.result.output, 1),
          report ? () => this.openPage(path.relative(this.requireVault().root, report)) : undefined,
        );
      } else {
        this.notify(task.name, "Custom shadow tasks arrive together with Tools & MCP. This one was skipped.");
      }
    } catch (error) {
      this.notify(`${task.name} didn't run`, errorMessage(error));
    }
  }

  async undoEveningReview(): Promise<void> {
    const commits = this.lastEveningCommits;
    if (!commits.length) return;
    this.lastEveningCommits = [];
    const undone = await this.enqueue(async () => (await this.librarian()).undo(commits));
    this.recent = this.vault ? recentFromLog(this.vault.root) : [];
    this.notify("Evening review undone", undone === commits.length ? "Everything it filed is back in the inbox." : `${undone} of ${commits.length} changes were undone; see the library's history.`);
    this.refreshMenu();
  }

  // ---------------------------------------------------------------- test hooks

  capsuleStateForTests(): CapsuleState {
    return this.capsuleState;
  }

  async idleForTests(): Promise<void> {
    await this.queue;
  }

  pageTitleForTests(rel: string): string {
    return this.vault ? pageInfo(this.vault.root, rel).title : "";
  }

  nativeImageForTests(): typeof nativeImage {
    return nativeImage;
  }

  notificationsForTests(): { title: string; body: string }[] {
    return this.notified;
  }

  draftForTests(): string | null {
    return this.inEditor?.draft ?? null;
  }

  menuForTests(): MenuItemModel[] {
    return buildMenuModel(this.menuInput(), new Date());
  }

  /** The step the setup session is on, or null without one: for tests of steps whose body a later change builds. */
  setupStepForTests(): SetupStep | null {
    return this.setup?.step ?? null;
  }
}
