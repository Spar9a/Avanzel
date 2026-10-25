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
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, renameSync, rmSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  AvanzelError,
  BUILTIN_ORDER,
  Librarian,
  NoAgentError,
  SHELVES,
  Vault,
  WAITING,
  checkAgent as checkHarness,
  classifyFailure,
  defaultSettings,
  DownloadError,
  downloadModels,
  downloadSize,
  ensureDefaultTasks,
  errorLine,
  formatSchedule,
  harnesses as listHarnesses,
  installHook,
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
  type FilingStep,
  type Harness,
  type RunFailure,
  type Settings,
  type ShadowTask,
  type Transcriber,
  type VoiceOptions,
  type VoiceSettings,
} from "@avanzel/engine";
import { isSettingsPane, NOTE_GONE, noSuchReview } from "../shared/ipc.ts";
import {
  correctedWordsProblem,
  filingProblem,
  ownLine,
  takeBackRefused,
  takeBackRefusedProblem,
  undoRefused,
  type AgentFailure,
  type FailureKind,
  type FilingProblemOptions,
  type PartialEdits,
  type Problem,
} from "../shared/problems.ts";
import type {
  AgentStatus,
  AppSettings,
  AskResult,
  CapsuleMode,
  CapsuleState,
  CardAction,
  FiledPage,
  ModelStatus,
  RecordingProblem,
  ScreenContext,
  SettingsPane,
  SettingsSnapshot,
  SetupSnapshot,
  SetupStep,
  Shortcuts,
  TaskInfo,
} from "../shared/ipc.ts";
import { frontContext } from "./front-app.ts";
import { errorMessage, harnessName, lastLines, LIBRARY_PICKER, type Answered, type Correction, type FilingJob, type Recording } from "./jobs.ts";
import { answeredFrom, captureMeta, filedPages, findPage, obsidianUrl, pageInfo, recentFromLog } from "./library-info.ts";
import { buildMenuModel, type MenuInput, type MenuItemModel } from "./menu-model.ts";
import { rowPage, withStep, withWritten } from "./narration.ts";
import { openPrivacyPane, permissionStatus, requestMicrophone } from "./permissions.ts";
import { pickRequest, popupChoice } from "./popup.ts";
import { RunStateStore } from "./run-state.ts";
import { runningAppNames } from "./running-apps.ts";
import {
  dueTasks,
  markChecked,
  markRan,
  resetMarginMs,
  signInPollMs,
  signInWatchMs,
  splitWaits,
  timerDelay,
  withWait,
  type RunState,
} from "./schedule.ts";
import { captureDisplay, looksBlank } from "./screenshot.ts";
import { Setup, type SetupHost } from "./setup.ts";
import { tildePath } from "./setup-model.ts";
import { freeAlternatives, likelyHolder, prettyAccelerator, registerShortcuts, type ShortcutApi } from "./shortcuts.ts";
import { FirstRunLog, NoticedShortcuts, SettingsStore } from "./store.ts";
import { openTerminal } from "./terminal.ts";
import { MenuBar } from "./tray.ts";
import {
  createAskWindow,
  createCapsuleWindow,
  createQuickWindow,
  createSettingsWindow,
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

/** How long quitting waits for stopped agent runs: QUIT_WAIT_MS, or in tests the positive number of ms in AVANZEL_QUIT_WAIT_MS. */
function quitWaitMs(): number {
  const shortened = process.env.AVANZEL_TEST === "1" ? Number(process.env.AVANZEL_QUIT_WAIT_MS) : 0;
  return shortened > 0 ? shortened : QUIT_WAIT_MS;
}

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

/** What an error card's one button does: where its Open Settings goes, or the fix a failed filing offers. */
type ErrorAction = Extract<CapsuleState, { kind: "error" }>["action"];

/**
 * The watch of one agent's sign-in (`watchSignIn`): the notes that wait for it, each with what its failure says once no watch
 * will file it (`unwatched`); when it gives up; and its next look.
 */
interface SignInWatch {
  notes: Map<string, Problem>;
  endsAt: number;
  timer: NodeJS.Timeout | null;
}

/** What a failed filing's run left behind in the library: its edits as their own commit, or outside any history; null when it left none. */
function leftBehind(outcome: FileOutcome | undefined): PartialEdits {
  return !outcome ? null : outcome.commit ? "commit" : outcome.changes.empty ? null : "uncommitted";
}

/**
 * What a sign-in failure says when no watch will file the note once the agent is signed in: the words for an agent that is
 * signed in by hand (no `command` to run), which promise only the evening review.
 */
function unwatched(failure: AgentFailure, now: Date, options: FilingProblemOptions): Problem {
  return filingProblem({ ...failure, command: null }, now, options);
}

/** The callback the shortcut stand-in holds for each accelerator it registered: what pressShortcutForTests presses. */
const fakeShortcuts = new Map<string, () => void>();

/**
 * Electron's global shortcuts or, when AVANZEL_FAKE_TAKEN_SHORTCUTS is set (comma-separated, possibly empty; the e2e
 * tests set it), a stand-in that registers nothing for real and refuses exactly the accelerators it lists. It keeps
 * the callback of each one it registers (`fakeShortcuts`), so a test can press it as the person would.
 */
function shortcutApi(): ShortcutApi {
  const fake = process.env.AVANZEL_FAKE_TAKEN_SHORTCUTS;
  if (fake === undefined) return globalShortcut;
  const taken = new Set(fake.split(",").map((accelerator) => accelerator.trim()).filter(Boolean));
  return {
    register: (accelerator, callback) => {
      if (taken.has(accelerator)) return false;
      fakeShortcuts.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator) => {
      fakeShortcuts.delete(accelerator);
    },
    unregisterAll: () => fakeShortcuts.clear(),
  };
}

export class Controller {
  private readonly store: SettingsStore;
  private readonly modelsDir: string;
  private vault: Vault | null = null;
  private capsule!: BrowserWindow;
  private settingsWindow: BrowserWindow | null = null;
  private quickWindow: BrowserWindow | null = null;
  private askWindow: BrowserWindow | null = null;
  /** Gives up the Ask window's question being answered, as closing that window does: Stop calls it (cancelAsk). */
  private giveUpAsk: (() => void) | null = null;
  /** First-run setup: its window and session, and Zel's bubble once it has ended (setup.ts). */
  readonly setup: Setup;
  private menuBar!: MenuBar;
  private capsuleState: CapsuleState = { kind: "hidden" };
  /**
   * The capture of the filing whose failure card the capsule shows, while it shows that card: what the card's Try again and
   * File it with … button files again (`openSettingsFor`'s `refile:`). It is set with the card (`fail`) and goes with it:
   * whatever the capsule shows next has none.
   */
  private cardCapture: string | null = null;
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
  /** When a first run reached each of setup's milestones (§5.4): kept on this Mac, never sent anywhere. */
  private readonly firstRun: FirstRunLog;
  /** What each agent's check found in this app run, by harness name, for Settings → Agents. */
  private readonly agentChecks = new Map<string, AgentStatus>();
  /** The agent checks going on, each by the controller that stops it when Avanzel quits. */
  private readonly runningChecks = new Set<AbortController>();
  /** When the open library's next usage-limit wait comes due (`armWaits`). */
  private waitTimer: NodeJS.Timeout | null = null;
  /** The sign-in watches going on, by the agent each one watches (`watchSignIn`). */
  private readonly signInWatches = new Map<string, SignInWatch>();
  /** The agents whose sign-in is being read again because the setup window has the focus again (`rereadSignIns`). */
  private readonly rereading = new Set<string>();
  /** Avanzel is quitting, busy or not (`stopAgentChecks`): no agent check starts any more. */
  private checksStopped = false;
  /** Where agent checks run while there is no library (`checkDir`): made at the first such check, kept for the app run. */
  private checkScratch: string | null = null;
  private recent: FiledPage[] = [];
  private running = new Set<string>();
  private lastEveningCommits: string[] = [];
  private audioTimeout: NodeJS.Timeout | null = null;
  /** Whether the capsule page listens yet; commands for its recorder wait until it does. */
  private capsuleListening = false;
  private heldCommands: ("start" | "stop" | "cancel")[] = [];
  /** Notifications posted, kept for the e2e tests only. */
  private readonly notified: { title: string; body: string }[] = [];
  /**
   * What Open Terminal and Open System Settings would have opened, and text Copy would have copied: with AVANZEL_TEST=1,
   * for the e2e tests only.
   */
  private readonly opened: string[] = [];
  private readonly copied: string[] = [];
  /** Quit and reopen was asked (`relaunch`), and the quit it began may still be waiting for a filing to stop. */
  private relaunching = false;
  /** How many times Quit and reopen was asked while AVANZEL_TEST=1, which relaunches nothing: for the e2e tests only. */
  private relaunched = 0;

  constructor(userData: string) {
    this.store = new SettingsStore(path.join(userData, "settings.json"));
    this.modelsDir = path.join(userData, "models");
    this.runState = new RunStateStore(path.join(userData, "run-state.json"));
    this.noticed = new NoticedShortcuts(path.join(userData, "noticed-shortcuts.json"));
    this.firstRun = new FirstRunLog(path.join(userData, "first-run.json"));
    this.setup = new Setup(this.setupHost()); // last: the host hands setup the stores made above
  }

  // ---------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    this.firstRun.launched(new Date());
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
   * wait (at most quitWaitMs()) while the engine does the runs' bookkeeping: protected files put
   * back, what a run left committed, the capture kept in the inbox. A check isn't waited for. Nothing
   * new starts meanwhile. Words the wait left only in memory (`saveUnwritten`) are saved all the same.
   */
  async stopForQuit(): Promise<void> {
    this.quitting = true;
    for (const abort of this.runs.keys()) abort.abort();
    this.stopAgentChecks();
    this.keepEdit();
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise<void>((resolve) => (timer = setTimeout(resolve, quitWaitMs())));
    await Promise.race([Promise.allSettled([this.queue, ...this.runs.values()]), waited]);
    clearTimeout(timer);
    this.saveUnwritten();
  }

  /** What goes wrong opening it is kept in `libraryProblem`, which the menu and Settings show. */
  private openLibrary(libraryPath: string | null): void {
    this.dropLibraryTimers(); // a wait or a watch is for the library that closes; the next one's waits are armed again by whoever opens it
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

  /**
   * The harness that `harness` selects, by name ("claude"): the library's own choice when it names none or says "auto".
   * Null while none can be selected: there is no library, its settings can't be read, or the agent it names (or any, on auto)
   * isn't installed. What a failure says of that is the error's (`agentFailure`), not this.
   */
  private selectedHarness(harness?: string): string | null {
    try {
      const settings = this.vault ? loadSettings(this.vault.root) : undefined;
      return settings ? selectHarness(settings, harness && harness !== "auto" ? harness : undefined).name : null;
    } catch {
      return null;
    }
  }

  private agentName(harness?: string): string {
    const name = this.selectedHarness(harness);
    return name ? harnessName(name) : "your agent";
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
      dictate: () => this.pressDictate(),
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
    if (action === "setup") return this.setup.show();
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

  /** The usable scheduled reviews; Settings → Reviews says what is wrong with the others. */
  private safeTasks(vault: Vault): ShadowTask[] {
    return loadTasksReport(vault).tasks;
  }

  // ---------------------------------------------------------------- capsule plumbing

  /** `capture`: the note an error card is about (`cardCapture`), which stays only as long as that card is what the capsule shows. */
  private setCapsule(state: CapsuleState, autoHideMs?: number, capture?: string): void {
    if (state.kind !== "editing") this.keepEdit(); // whatever replaces the editor (a recording, a typed thought, an error) keeps its edit
    this.capsuleState = state;
    this.cardCapture = capture ?? null;
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

  /**
   * The capsule's card of what went wrong: `message` says what happened and `detail` what is safe. Its one button does
   * `action` and says `actionLabel` (Open Settings when it names none). `capture`: the note the card is about, if it is
   * about one, which the card keeps for as long as it shows.
   */
  private fail(message: string, detail?: string, action?: ErrorAction, actionLabel?: string, capture?: string): void {
    this.setCapsule({ kind: "error", message, detail, action, actionLabel }, undefined, capture);
  }

  /**
   * `recording` went wrong: the capsule's card says so (`message`, `detail`, and its button: `action` and `actionLabel`),
   * unless it is setup's first spoken thought, which the setup window says in its own words instead (`setup.lost`): the
   * `problem`, and whether the recording is `kept` in the library, which nothing else of it is.
   */
  private recordingFailed(
    recording: Recording,
    { problem, kept = false }: { problem: RecordingProblem; kept?: boolean },
    message: string,
    detail?: string,
    action?: ErrorAction,
    actionLabel?: string,
  ): void {
    if (!this.setup.lost(recording, { kind: "failed", problem, kept })) this.fail(message, detail, action, actionLabel);
  }

  // ---------------------------------------------------------------- recording

  /**
   * Record a thought's own shortcut was pressed: setup's press test hears it (`setup.notePress`), then it records or stops
   * as Record a thought in the menu does. Only this is a press of the shortcut.
   */
  private pressDictate(): void {
    this.setup.notePress();
    void this.toggleDictate();
  }

  /** Record a thought, from its shortcut or the menu. On setup's first-thought step, the press is setup's (`setup.press`). */
  async toggleDictate(): Promise<void> {
    if (this.setup.takesPress()) return this.setup.press();
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
      "Avanzel can't see the screen yet.",
      "Allow it in System Settings, under Screen Recording, then quit and reopen Avanzel.",
      "open-screen-settings",
      "Open System Settings",
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
    if (!this.hears()) {
      // A failed download waits for Try again: pressing the shortcut says so and fetches nothing.
      if (this.model.kind === "missing") void this.downloadModel();
      this.showModelStatus();
      return false;
    }
    if (!(await requestMicrophone())) {
      this.fail("Avanzel can't hear you yet.", "Allow it in System Settings, under Microphone.", "open-microphone-settings", "Open System Settings");
      return false;
    }
    return true;
  }

  /** Speech can become words: the speech models are ready, or AVANZEL_FAKE_TRANSCRIPT stands in for them. */
  private hears(): boolean {
    return !!process.env.AVANZEL_FAKE_TRANSCRIPT || this.model.kind === "ready";
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
    this.setup.moveThought(recording, { kind: "transcribing", startedAt: Date.now() });
    this.capsuleCommand("stop");
    this.clearAudioTimeout();
    this.audioTimeout = setTimeout(() => {
      this.audioTimeout = null;
      if (this.recording !== recording) return; // only ever this recording, never a newer one
      this.abandonRecording(recording);
      this.recordingFailed(
        recording,
        { problem: "lost" },
        "The recording didn't arrive",
        "Try again; if it keeps happening, check the microphone in Settings → Voice.",
        "open-settings:voice",
      );
    }, AUDIO_TIMEOUT_MS);
  }

  /**
   * Esc, or the capsule's ×, while it records: the recording is given up, and nothing is saved. When it is setup's first
   * spoken thought, that waits for a press again; one given up after its stop (no Esc then) would otherwise wait for
   * words that never come.
   */
  cancelRecording(): void {
    const recording = this.recording;
    if (!recording) return;
    this.abandonRecording(recording);
    this.setCapsule({ kind: "hidden" });
    this.setup.moveThought(recording, { kind: "waiting" });
  }

  /**
   * The capsule's page couldn't start the microphone, and says why in the words the browser gave (`message`). Nothing was
   * recorded, and the card sends the person to Settings → Voice, where the microphone is chosen.
   */
  micError(message: string): void {
    const recording = this.recording;
    if (!recording) return;
    this.abandonRecording(recording);
    this.recordingFailed(
      recording,
      { problem: "microphone" },
      "The microphone didn't start.",
      [ownLine(message), "Nothing was recorded. Check the microphone in Settings → Voice."].filter(Boolean).join(" "),
      "open-settings:voice",
      "Open Settings",
    );
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
    // What a failure can say is safe: the recording, once written to the library, and whether its words were made.
    let written: string | null = null;
    let text = "";
    try {
      const samples = process.env.AVANZEL_FAKE_AUDIO ? await this.fakeAudio(process.env.AVANZEL_FAKE_AUDIO) : received;
      const { audioPath, unkept } = this.claimRecording(vault, now);
      let engine = "";
      let seconds: number | null = null;
      if (samples.length >= 16000 * 0.3) {
        if (audioPath) {
          writeWav(audioPath, samples, 16000);
          written = audioPath;
        }
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
        // Its recording went with it: nothing is kept.
        return this.recordingFailed(
          recording,
          { problem: "silence" },
          "Nothing was heard.",
          "Is the right microphone selected? Nothing was saved.",
          "open-settings:voice",
          "Choose microphone",
        );
      }
      const capture = vault.newCapture(text, { source: "voice", audio: audioPath, transcriber: engine, now });
      this.afterCapture(capture.path, text, seconds, unkept, recording);
    } catch (error) {
      console.error("recording", error);
      this.recordingFailed(
        recording,
        { problem: text ? "unsaved" : "unheard", kept: written !== null && existsSync(written) },
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

  /**
   * `detail`: a line the capsule shows under the words, e.g. why the recording itself wasn't kept. Words spoken in
   * `recording` that is setup's first spoken thought are setup's first (`setup.heard`), which files them now, whatever
   * the file mode.
   */
  private afterCapture(capturePath: string, text: string, transcribedIn: number | null, detail?: string, recording?: Recording): void {
    if (recording && this.setup.heard(recording, capturePath, text, transcribedIn)) return;
    if (this.store.get().fileMode === "evening") {
      this.setCapsule({ kind: "saved", text, note: "Saved to your inbox for tonight's review", ...(detail ? { detail } : {}) }, 4000);
      return;
    }
    this.beginFiling({
      capturePath,
      text,
      transcribedIn,
      agent: this.agentName(),
      harness: this.selectedHarness() ?? "auto",
      abort: new AbortController(),
      edited: false,
      rows: [],
      written: [],
      detail,
    });
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
   * Avanzel) has the library, then the start of its own run. Its card, or the setup window, shows the wait
   * until the run starts; the window's working line then counts from that start.
   */
  private filingProgress(job: FilingJob, message: string): void {
    const waiting = message === WAITING;
    if (!!job.waiting === waiting) return;
    job.waiting = waiting;
    if (this.job === job && this.capsuleState.kind === "filing") this.showFiling(job);
    this.setup.waiting(job, waiting);
  }

  /**
   * A step the agent takes in setup's first filing, told as it takes it (`file`'s `steps`): it joins the filing's rows,
   * and the pages written, which the shelf tabs count, and the setup window, if it still shows the filing, is sent them
   * (`setup.stepped`). Narration is best effort: what goes wrong here is noted, and never fails the filing.
   */
  private filingStep(job: FilingJob, step: FilingStep): void {
    try {
      const root = this.requireVault().root;
      job.written = withWritten(job.written, step);
      job.rows = withStep(job.rows, step, (rel) => rowPage(root, rel));
      if (this.setup.owns(job)) this.setup.stepped(job);
    } catch (error) {
      console.warn("narration", error);
    }
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
    if (job.abort.signal.aborted) return; // Edit, or Cancel in setup, stopped it before its turn came
    if (!existsSync(job.capturePath)) return this.noteGone(job); // already filed meanwhile (e.g. by another Avanzel on this library)
    const started = performance.now();
    let outcome: FileOutcome | undefined;
    const progress = (message: string) => this.filingProgress(job, message);
    // Only setup's first thought is narrated; the capsule's filings are not, yet.
    const steps = this.setup.owns(job) ? (step: FilingStep) => this.filingStep(job, step) : null;
    try {
      [outcome] = await this.withRun(
        async (signal) => (await this.librarian(job.harness)).file([job.capturePath], { signal, progress, ...(steps ? { steps } : {}) }),
        job.abort,
      );
    } catch (error) {
      if (job.edited || job.cancelled || this.quitting) return;
      return this.filingFailed(job, error);
    }
    job.outcome = outcome;
    // Edit takes back what this run did (`refile`), and so does Cancel in setup (`cancelSetupFiling`).
    if (job.edited || job.cancelled || this.quitting) return;
    const seconds = (performance.now() - started) / 1000;
    // No outcome at all: the capture left the inbox while the run waited for the library, and another Avanzel filed it. Setup
    // says so, in its window or its notification; for anything else there is nothing left to do, as when the note was gone
    // before the run's turn. The agent didn't stop without filing: its card would say that, and that the note is in the inbox.
    if (!outcome) return job.setup ? this.filingFailed(job, NOTE_GONE) : this.noteGone(job);
    if (!outcome.ok) return this.filingFailed(job, outcome.error || outcome.message || "The agent stopped without filing.", outcome);
    const vault = this.requireVault();
    job.pages = filedPages(vault.root, outcome.changes);
    this.recent = [...job.pages, ...this.recent.filter((p) => !job.pages?.some((q) => q.path === p.path))].slice(0, 3);
    this.noteFiled((capture) => capture === job.capturePath);
    // Setup's thought is filed, which counts whether its window is still there to show it or has closed (§5.4).
    if (job.setup) this.firstRun.filed(new Date());
    if (this.setup.owns(job)) {
      this.setup.filed(job, outcome, job.pages);
    } else if (this.job === job && this.capsuleState.kind === "filing") {
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

  /**
   * `job`'s filing failed. `error` is what the run threw, or for a run that came back without filing the line that says why,
   * and `outcome` is then the run's own, with the engine's classification of the failure and what the run left behind. The
   * capsule's card says what happened and what is safe, and offers the one fix (`cardFix`). That is the card of this job's
   * filing or, when a wait's or the watch's filing in the background finds the card of the note's earlier failure still up
   * (`cardCapture`), that card, replaced: left as it is, it would promise what is not so now. With no card of the note, a
   * notification says the same. Setup's window tells it in its own, with the failure and what the run left behind
   * (`setup.failed`): setup starts no wait and no watch, so it says to try again. A note gone from the inbox has no failure to
   * tell. What the words promise of a usage limit or a missing sign-in, the app then does (`keepPromise`).
   */
  private filingFailed(job: FilingJob, error: unknown, outcome?: FileOutcome): void {
    const harness = this.failedHarness(job.harness, error);
    const failure = this.agentFailure(harness, error, outcome?.failure ?? null);
    const partial = leftBehind(outcome);
    if (this.setup.owns(job)) return this.setup.failed(job, error === NOTE_GONE ? null : failure, partial);
    const now = new Date();
    const options: FilingProblemOptions = {
      ...(outcome?.savedOriginal ? { where: outcome.savedOriginal } : {}),
      partial,
      eveningReview: this.eveningReviewOn(),
    };
    // A note that the watch filed and that still can't sign in is left to the evening review: no watch follows it.
    const outAgain = job.background?.by === "watch" && failure.kind === "signin";
    const problem = outAgain ? unwatched(failure, now, options) : filingProblem(failure, now, options);
    this.keepPromise(job, failure, harness, now, options);
    if ((this.job === job && this.capsuleState.kind === "filing") || this.cardCapture === job.capturePath) {
      const fix = this.cardFix(failure, harness);
      this.fail(problem.title, problem.body, fix?.action, fix?.label, job.capturePath);
    } else {
      this.notify(problem.title, problem.body);
    }
    this.refreshMenu();
  }

  /**
   * The harness a failed run was for, by name ("claude"): the one its error names (an agent that is gone), else `chosen`, the
   * harness the run was asked to use, or on "auto" the one selected now. Null when there is no agent to name.
   */
  private failedHarness(chosen: string, error: unknown): string | null {
    if (error instanceof NoAgentError && error.agent) return error.agent;
    return chosen === "auto" ? this.selectedHarness() : chosen;
  }

  /**
   * What went wrong with a run of an agent (a filing, or a question), as the copy tells it: the kind comes from the engine's
   * classification of the run (`run`), or from the error that kept the run from starting. `harness` is the agent it was for,
   * when one can be named (`failedHarness`).
   */
  private agentFailure(harness: string | null, error: unknown, run: RunFailure | null = null): AgentFailure {
    // Only the engine says that an agent isn't there: gone, when its error names the library's own agent, and missing when
    // none is installed. With no agent to name for any other reason (the library's settings can't be read, say) the failure
    // is Avanzel's own, in the line of its error. No title says "your agent".
    const kind: FailureKind =
      error instanceof NoAgentError ? (error.agent ? "gone" : "missing") : harness === null ? "other" : (run?.kind ?? "other");
    return {
      kind,
      agent: harness ? harnessName(harness) : "Avanzel",
      command: harness === "claude" || harness === "codex" ? harness : null,
      resetsAt: run?.resetsAt ?? null,
      seconds: this.timeoutSeconds(),
      line: run?.line || errorLine(errorMessage(error)),
    };
  }

  /**
   * The one button of a failure's card, or null when the card has no fix to offer. A usage limit offers another agent
   * (`otherAgent`), a sign-in Terminal, a timeout or any other failure the same agent again (none when no agent can be
   * named, as when the library's settings need mending by hand), and an agent that isn't there Settings → Agents. A
   * `refile:` button files the card's note again with that agent.
   */
  private cardFix(failure: AgentFailure, harness: string | null): { action: CardAction; label: string } | null {
    switch (failure.kind) {
      case "limit": {
        const other = this.otherAgent(harness);
        return other ? { action: `refile:${other}`, label: `File it with ${harnessName(other)} now` } : null;
      }
      case "signin":
        return { action: "open-terminal", label: "Open Terminal" };
      case "timeout":
      case "other":
        return harness ? { action: `refile:${harness}`, label: "Try again" } : null;
      case "gone":
      case "missing":
        return { action: "open-settings:agents", label: "Open Settings" };
    }
  }

  /**
   * The agent to offer a note that `stopped`'s usage limit stopped, by harness name: the first of the built-in agents, in the
   * engine's order, besides that one that is installed and isn't known to be signed out. Null when there is none.
   */
  private otherAgent(stopped: string | null): string | null {
    const table = this.harnessTable();
    const usable = (name: string) => name !== stopped && table[name]?.available() && this.agentChecks.get(name)?.kind !== "signed-out";
    return BUILTIN_ORDER.find(usable) ?? null;
  }

  /**
   * The failure card's button, Try again or File it with … now: the card's note, `capturePath`, is filed again with `harness`
   * (an agent's name) as any note is, and the capsule shows the filing. Its words, and how long they took to transcribe, are
   * the failed job's, which is still `this.job` while its card shows. A note that no longer waits in the open library's inbox
   * was filed meanwhile (by the evening review, another Avanzel or the person) or belongs to another library: there is
   * nothing to file, and the card just goes.
   */
  private fileAgainWith(capturePath: string, harness: string): void {
    const failed = this.job;
    if (failed?.capturePath !== capturePath || !this.vault?.pending().includes(capturePath)) return this.setCapsule({ kind: "hidden" });
    this.beginFiling({
      capturePath,
      text: failed.text,
      transcribedIn: failed.transcribedIn,
      agent: harnessName(harness),
      harness,
      abort: new AbortController(),
      edited: false,
      rows: [],
      written: [],
    });
  }

  /** Whether the library's evening review is on: what a failed note's "the evening review will try again" relies on. */
  private eveningReviewOn(): boolean {
    const vault = this.vault;
    return !!vault && this.safeTasks(vault).some((task) => task.kind === "evening-review" && task.enabled);
  }

  /** How long the library lets an agent run, in seconds. */
  private timeoutSeconds(): number {
    try {
      return (this.vault ? loadSettings(this.vault.root) : defaultSettings()).timeoutSeconds;
    } catch {
      return defaultSettings().timeoutSeconds;
    }
  }

  // ---------------------------------------------------------------- notes that wait for a limit or a sign-in

  /**
   * What the words of a failed filing promise, the app does. A usage limit whose reset is still to come is a wait for it
   * (`addWait`): the words say the note "will be filed then". A sign-in that Claude Code or Codex asks for is a watch of the
   * agent's free sign-in check (`watchSignIn`): the note "will be filed straight away". Only a note that waits in the open
   * library's inbox is waited for. Any other failure promises only the evening review, and keeps no wait. Neither goes round
   * without end: a reset that has passed arms no wait, a note that a wait filed and the limit stopped again waits only for a
   * later reset, and a note that the watch filed and that still can't sign in starts no new watch.
   */
  private keepPromise(job: FilingJob, failure: AgentFailure, harness: string | null, now: Date, options: FilingProblemOptions): void {
    if (harness === null || !this.vault?.pending().includes(job.capturePath)) return;
    try {
      if (failure.kind === "limit" && failure.resetsAt !== null && failure.resetsAt > now.getTime()) {
        const until = failure.resetsAt + resetMarginMs();
        if (job.background?.by !== "wait" || until > job.background.until) this.addWait(job.capturePath, harness, until);
      } else if (failure.kind === "signin" && failure.command !== null && job.background?.by !== "watch") {
        this.watchSignIn(harness, job.capturePath, unwatched(failure, now, options));
      }
    } catch (error) {
      console.error("what a failed filing promised", error); // the words stay; the evening review still has the note
    }
  }

  /** Keeps a wait with the open library for `capture`'s note, to be filed with `agent` at `until` (epoch ms), and sets its timer. */
  private addWait(capture: string, agent: string, until: number): void {
    const vault = this.vault;
    if (!vault) return;
    const state = this.readRunState(vault);
    this.writeRunState(vault, { ...state, waiting: withWait(state.waiting, { capture, agent, until }) });
    this.armWaits();
  }

  /**
   * Starts the open library's usage-limit waits over from what its run state keeps. The notes whose wait has come due are
   * filed now (`fileInBackground`) if they still wait in the inbox, and are done with either way; one timer is set for the
   * next to come due. It runs when a wait is added or forgotten, when Avanzel starts (`tick`) or opens another library
   * (`useLibrary`), and when its timer fires. That timer is set for at most what a timer can hold, and finds nothing due
   * if it fires early, so it sets itself again. `tick` runs it every minute and when the Mac wakes too, as a timer set
   * before the Mac slept is late by the sleep.
   */
  private armWaits(): void {
    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.waitTimer = null;
    const vault = this.vault;
    if (!vault || this.quitting || this.checksStopped) return;
    const state = this.readRunState(vault);
    const now = Date.now();
    const { due, later } = splitWaits(state.waiting, now);
    if (due.length) {
      // Done with before they are filed: waits that could not be saved as done would file their notes again, every minute.
      try {
        this.writeRunState(vault, { ...state, waiting: later });
      } catch (error) {
        console.error("usage-limit waits", error);
        return;
      }
      const inbox = new Set(vault.pending());
      for (const wait of due) {
        if (inbox.has(wait.capture)) this.fileInBackground(wait.capture, wait.agent, { by: "wait", until: wait.until });
      }
    }
    if (later.length) this.waitTimer = setTimeout(() => this.armWaits(), timerDelay(Math.min(...later.map((wait) => wait.until)), now));
  }

  /**
   * The notes `filed` picks are filed, and need no wait. Their waits go, so that a note put back in the inbox (Undo) isn't
   * filed again by a wait that was made before.
   */
  private forgetWaits(filed: (capture: string) => boolean): void {
    const vault = this.vault;
    if (!vault) return;
    try {
      const state = this.readRunState(vault);
      const waiting = state.waiting.filter((wait) => !filed(wait.capture));
      if (waiting.length === state.waiting.length) return;
      this.writeRunState(vault, { ...state, waiting });
      this.armWaits();
    } catch (error) {
      console.error("usage-limit waits", error);
    }
  }

  /**
   * Files the note at `capturePath` with `harness` (an agent's name), in the background: no card of its own, and a notification
   * says how it went, as for any filing whose card is gone. `background` says what asked, which `keepPromise` checks if it fails.
   * The note joins `queuedToFile`, so the evening review leaves it to this filing. At its turn it is filed only if it still
   * waits in the open library's inbox, and its editor isn't open: not if it was filed meanwhile or another library has opened,
   * and not while the person corrects its words, which their Edit files.
   */
  private fileInBackground(capturePath: string, harness: string, background: NonNullable<FilingJob["background"]>): void {
    const job: FilingJob = {
      capturePath,
      text: "",
      transcribedIn: null,
      agent: harnessName(harness),
      harness,
      abort: new AbortController(),
      edited: false,
      rows: [],
      written: [],
      background,
    };
    this.queuedToFile.add(capturePath);
    void this.enqueue(async () => {
      const waiting = this.vault?.pending().includes(capturePath);
      if (waiting && !this.editing.has(capturePath)) return this.runFiling(job);
      this.queuedToFile.delete(capturePath);
      if (!waiting) this.noteGone(job);
    });
  }

  /**
   * The notes `filed` picks are filed, by a filing of their own or by the evening review. No wait is left for them
   * (`forgetWaits`), and a card that still tells of one of them has nothing more to say.
   */
  private noteFiled(filed: (capture: string) => boolean): void {
    this.forgetWaits(filed);
    if (this.cardCapture !== null && filed(this.cardCapture)) this.setCapsule({ kind: "hidden" });
  }

  /**
   * `job`'s note isn't in the inbox, so there is nothing to file: it was filed meanwhile, say by another Avanzel on this
   * library, and its waits are done with. The setup window, which waits on its first thought, says the note has gone. The
   * card of its filing goes, and so does one that told of its failure and said it would be filed.
   */
  private noteGone(job: FilingJob): void {
    this.forgetWaits((capture) => capture === job.capturePath);
    if (this.setup.owns(job)) return this.setup.failed(job, null, null);
    if ((this.job === job && this.capsuleState.kind === "filing") || this.cardCapture === job.capturePath) this.setCapsule({ kind: "hidden" });
  }

  /**
   * `agent` (Claude Code or Codex, by harness name) isn't signed in, and the failed filing of `capture`'s note said it would be
   * filed straight away once it is. Its free sign-in check is read every `signInPollMs()` for `signInWatchMs()`, and the first
   * time it reads signed in the notes that wait are filed again, in the background, and the watch ends. Notes that wait on one
   * agent share one watch, which each new note keeps going for another full length. After that length the note is the evening
   * review's, and the card that said it would be filed straight away says only that it is safe (`unwatch`; `unkept` is
   * what it then says). The watch lives in memory: it ends with Avanzel, and with the library its notes are in.
   */
  private watchSignIn(agent: string, capture: string, unkept: Problem): void {
    const endsAt = Date.now() + signInWatchMs();
    const running = this.signInWatches.get(agent);
    if (running) {
      running.notes.set(capture, unkept);
      running.endsAt = endsAt;
      return;
    }
    const watch: SignInWatch = { notes: new Map([[capture, unkept]]), endsAt, timer: null };
    this.signInWatches.set(agent, watch);
    this.scheduleSignInLook(agent, watch);
  }

  private scheduleSignInLook(agent: string, watch: SignInWatch): void {
    watch.timer = setTimeout(() => void this.lookAtSignIn(agent, watch), signInPollMs());
  }

  /** One look of `watch` at `agent`'s sign-in, and then the end of the watch, or the next look. */
  private async lookAtSignIn(agent: string, watch: SignInWatch): Promise<void> {
    watch.timer = null;
    const harness = this.harnessNamed(agent);
    const check = harness && !this.quitting && !this.checksStopped ? await this.freeSignInCheck(harness) : null;
    if (this.signInWatches.get(agent) !== watch) return; // it ended while the check ran: another library opened, or Avanzel is quitting
    const inbox = new Set(this.vault?.pending());
    for (const capture of [...watch.notes.keys()]) if (!inbox.has(capture)) watch.notes.delete(capture); // a note filed meanwhile waits for nothing
    if (check?.ok) {
      this.endSignInWatch(agent);
      const status = statusOf(check);
      if (status && this.agentChecks.has(agent)) {
        this.agentChecks.set(agent, status); // what Settings → Agents showed of it, "Not signed in" say, is not so any more
        this.broadcast();
      }
      for (const capture of watch.notes.keys()) this.fileInBackground(capture, agent, { by: "watch" });
      return;
    }
    if (!watch.notes.size || Date.now() >= watch.endsAt || this.quitting || this.checksStopped) return this.unwatch(agent);
    this.scheduleSignInLook(agent, watch);
  }

  /**
   * What `harness`'s own sign-in command says, which is free: it never asks the model (`prompt: false`), as a check that may
   * does. It is read here and not through `runAgentCheck`, which records every finding in `agentChecks` for Settings and
   * setup, and leaves an older finding standing when a read learns nothing: the watch needs this read's own answer, and
   * leaves what Settings shows as it is while the agent is signed out. Null when Avanzel is quitting, or the command couldn't run.
   */
  private async freeSignInCheck(harness: Harness): Promise<AgentCheck | null> {
    const abort = new AbortController();
    this.runningChecks.add(abort);
    try {
      const check = await checkHarness(harness, this.checkDir(), { signal: abort.signal, prompt: false });
      return abort.signal.aborted ? null : check;
    } catch {
      return null; // say there is no folder to run it in; the next look tries again
    } finally {
      this.runningChecks.delete(abort);
    }
  }

  private endSignInWatch(agent: string): void {
    const timer = this.signInWatches.get(agent)?.timer;
    if (timer) clearTimeout(timer);
    this.signInWatches.delete(agent);
  }

  /**
   * `agent`'s watch ends with its notes unfiled: its length is up, or the library they are in has closed. A card that still
   * shows one of them said that it would be filed straight away, which nothing will do now. It says what is so instead
   * (`unwatched`), and keeps its button. Not while Avanzel is quitting, which ends every watch.
   */
  private unwatch(agent: string): void {
    const watch = this.signInWatches.get(agent);
    this.endSignInWatch(agent);
    const card = this.cardCapture;
    const state = this.capsuleState;
    const unkept = card === null ? undefined : watch?.notes.get(card);
    if (card === null || !unkept || this.quitting || this.checksStopped || state.kind !== "error" || state.message !== unkept.title) return;
    this.fail(unkept.title, unkept.body, state.action, state.actionLabel, card);
  }

  /**
   * The open library closes, or Avanzel quits: its waits' timer and the sign-in watches of its notes end (`unwatch`). Its
   * waits are kept.
   */
  private dropLibraryTimers(): void {
    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.waitTimer = null;
    for (const agent of [...this.signInWatches.keys()]) this.unwatch(agent);
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
      harness: job.harness,
      abort: new AbortController(),
      edited: false,
      rows: [],
      written: [],
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
        return this.correctedWordsNotSaved(next, error, existsSync(job.capturePath));
      } finally {
        this.settleEdit(job, next);
      }
      if (problem === null) return this.runFiling(next);
      if (this.job === next && this.capsuleState.kind === "filing") {
        // The card says where the corrected words wait, and promises the evening review only while the library's is on.
        const refused = takeBackRefusedProblem(existsSync(next.capturePath), this.eveningReviewOn());
        this.fail(refused.title, refused.body);
      }
    });
  }

  /**
   * The corrected words of `job` (File after Edit) couldn't be written to the inbox yet. That isn't an agent's failure, so
   * the card is its own, with OK alone: another try would file the misheard capture. A capsule that no longer shows `job`
   * gets a notification with the same words. `originalKept`: the note they correct is still in the inbox.
   */
  private correctedWordsNotSaved(job: FilingJob, error: unknown, originalKept: boolean): void {
    const problem = correctedWordsProblem(lastLines(errorMessage(error)), originalKept);
    if (this.job === job && this.capsuleState.kind === "filing") this.fail(problem.title, problem.body);
    else this.notify(problem.title, problem.body);
    this.refreshMenu();
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
        if (problem !== null) this.notify(takeBackRefused.title, takeBackRefused.body);
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

  /**
   * Undo the commit a stopped run made (none without git or auto_commit, or when it changed nothing); null, or why it couldn't.
   * What the person is told of a refusal is the copy's (`takeBackRefused`); the reason is kept in the log.
   */
  private async takeBack(job: FilingJob): Promise<string | null> {
    const commit = job.outcome?.commit;
    if (!commit) return null;
    let why: string | null;
    try {
      why = (await (await this.librarian()).undo([commit])) === 1 ? null : "Git refused to undo it; see the library's history.";
    } catch (error) {
      why = errorMessage(error);
    }
    if (why !== null) console.warn("take back", why);
    return why;
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

  /**
   * Undo, on the capsule's filed card or in setup: once the queue gets to it, git takes back `commit`, a filing's, which
   * puts its capture back in the inbox. Whether it did; either way the menu's recent pages are read again.
   */
  private async revertFiling(commit: string): Promise<boolean> {
    try {
      return (await this.enqueue(async () => (await this.librarian()).undo([commit]))) === 1;
    } finally {
      this.recent = this.vault ? recentFromLog(this.vault.root) : [];
    }
  }

  async undo(): Promise<void> {
    const job = this.job;
    const commit = job?.outcome?.commit;
    if (!job || !commit) return;
    const undone = await this.revertFiling(commit);
    this.setCapsule(
      undone ? { kind: "saved", text: job.text, note: "Undone. The note is back in your inbox." } : { kind: "error", message: undoRefused.title, detail: undoRefused.body },
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

  /**
   * A button on the capsule's card is clicked (an error card's one button, or a notice's Open Settings): `action`, as the
   * page sent it, says what to do (see CardAction), and the card goes away. `refile:<agent>` files the card's note
   * (`cardCapture`) again with that agent (`fileAgainWith`): the filing the capsule shows replaces the card. A second click
   * on the button finds no note, since that filing has replaced the card, and does nothing.
   */
  openSettingsFor(action: string): void {
    if (action.startsWith("refile:")) {
      const capture = this.cardCapture; // before the filing replaces the card, and the card's note with it
      if (capture !== null) this.fileAgainWith(capture, action.slice("refile:".length));
      return;
    }
    if (action === "open-microphone-settings") void this.openPrivacy("microphone");
    else if (action === "open-screen-settings") void this.openPrivacy("screen");
    else if (action === "open-terminal") openTerminal(this.opened);
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
    // With AVANZEL_TEST=1 System Settings stays shut, and openedForTests says which pane it would have opened.
    if (process.env.AVANZEL_TEST === "1") {
      this.opened.push(`System Settings → ${kind === "microphone" ? "Microphone" : "Screen Recording"}`);
      return;
    }
    if (kind === "screen" && permissionStatus("screen") !== "granted") await captureDisplay().catch(() => undefined);
    openPrivacyPane(kind);
  }

  /**
   * Quit and reopen, on Privacy's screen row: macOS applies a Screen Recording grant only when the app starts again. It quits
   * as anywhere does (`before-quit`, index.ts), so a filing under way is stopped first; its note stays in the inbox, which is
   * safe. Asked again while that quit waits for the filing to stop, it does nothing: Avanzel opens once. With AVANZEL_TEST=1
   * nothing quits or relaunches, and relaunchedForTests counts the asks.
   */
  relaunch(): void {
    if (process.env.AVANZEL_TEST === "1") {
      this.relaunched += 1;
      return;
    }
    if (this.relaunching) return;
    this.relaunching = true;
    app.relaunch();
    app.quit();
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
    if (this.askWindow && !this.askWindow.isDestroyed()) this.askWindow.close();
  }

  /**
   * The pages on the six shelves, counted as Settings' library line counts them: a folder of the owner's own doesn't count.
   * Ask invites a first thought, not a question, while there are none. Nothing without a library that is there.
   */
  libraryPages(): number {
    const vault = this.vault;
    if (!vault?.exists()) return 0;
    const shelves = vault.shelfCounts();
    return SHELVES.reduce((sum, shelf) => sum + (shelves[shelf] ?? 0), 0);
  }

  async ask(question: string): Promise<AskResult> {
    const win = this.askWindow; // the window that asked, even once another one opens
    // The engine's messages go to the Ask window as they are, except its waiting one, which names no run: in the window's
    // words it names none either, for what holds the library may be a filing, a review, or a stopped question letting go.
    const progress = (message: string) => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send("ask:progress", message === WAITING ? "Waiting for Avanzel to finish with your library…" : message);
    };
    // Closing that window, or Stop in it, gives the question up: its agent run stops, and the library is free for a
    // filing waiting on it. One question is answered at a time, so Stop gives up the newest one.
    const abort = new AbortController();
    const giveUp = () => abort.abort();
    this.giveUpAsk = giveUp;
    if (win?.isDestroyed()) giveUp();
    else win?.once("closed", giveUp);
    try {
      const { ok, ran, text, agent, seconds, changedFiles, failure } = await this.answerQuestion(question, abort, progress);
      // A run that failed says whose it was; a message thrown before any run comes back as it is. An answer comes with its
      // lines and the pages its links name; anything else has none. Either says how many files the run changed in the library,
      // and a question that failed says why (`failure`) when an agent can be told of it.
      return {
        ok,
        answer: ran && !ok ? `${agent} couldn't answer.\n${text}` : text,
        agent,
        seconds,
        ...(ok ? answeredFrom(this.vault?.root ?? null, text) : { paragraphs: [], sources: [] }),
        changedFiles,
        failure,
      };
    } finally {
      if (win && !win.isDestroyed()) win.removeListener("closed", giveUp);
      if (this.giveUpAsk === giveUp) this.giveUpAsk = null;
    }
  }

  /** Stop, in the Ask window: the question being answered is given up, as closing the window gives it up. */
  cancelAsk(): void {
    this.giveUpAsk?.();
  }

  /**
   * One question, answered from the library by its agent, read-only, for the Ask window and for setup's Ask step:
   * `abort` stops the run, and `progress` hears the engine's messages. `ran` says whether the agent's run came to its
   * end: true for an answer, whose `text` is the agent's reply, and for a run that failed, whose `text` is the agent's
   * last lines; false when something threw instead (no library, a question the engine refuses), whose `text` is the
   * error's message. `changedFiles` counts the files the run left changed in the library, created, modified or deleted, as
   * the engine's diff of it finds: an agent asked read-only leaves none, but one that doesn't keep to it may. Nothing
   * changes when nothing ran. `failure` says why a question failed, as the engine classifies the run (`classifyFailure`), or
   * for an agent that isn't there as `gone` (the library's own) or `missing` (none installed); it is null for an answer, and
   * for anything else that threw, since no agent failed then.
   */
  private async answerQuestion(question: string, abort: AbortController, progress: (message: string) => void): Promise<Answered> {
    const agent = this.agentName();
    const harness = this.selectedHarness(); // the agent the question goes to, named before it is asked
    const started = performance.now();
    const seconds = () => (performance.now() - started) / 1000;
    try {
      const { result, changes } = await this.withRun(async (signal) => (await this.librarian()).ask(question, { save: false, signal, progress }), abort);
      const changedFiles = changes.created.length + changes.modified.length + changes.deleted.length;
      if (result.ok) return { ok: true, ran: true, text: result.output, agent, seconds: seconds(), changedFiles, failure: null };
      const text = lastLines(result.stderr || result.output);
      return { ok: false, ran: true, text, agent, seconds: seconds(), changedFiles, failure: this.agentFailure(harness, text, classifyFailure(result)) };
    } catch (error) {
      const failure = error instanceof NoAgentError ? this.agentFailure(this.failedHarness("auto", error), error) : null;
      return { ok: false, ran: false, text: errorMessage(error), agent, seconds: seconds(), changedFiles: 0, failure };
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
      // Back from System Settings, say, where the person may have allowed the microphone or Screen Recording: Privacy follows
      // it, as setup reads the sign-ins again when it has the focus (`rereadSignIns`). That is a read of what is on this
      // Mac, and starts no agent check, which could cost quota.
      this.settingsWindow.on("focus", () => {
        try {
          this.refreshSettings();
        } catch (error) {
          console.error("settings", error); // an event handler that throws would bring up Electron's error box
        }
      });
    } else if (pane) {
      this.settingsWindow.webContents.send("settings:show-pane", pane);
    }
    app.focus({ steal: true });
    this.settingsWindow.show();
    this.settingsWindow.focus();
  }

  /**
   * Choose…, in Settings: a native menu of the page's `options` pops up over the Settings window, at `at`. Resolves with
   * the value picked; null when the menu closes without one, and without an open Settings window or a request that can
   * be read.
   */
  pickFromSettings(options: unknown, at: unknown): Promise<string | null> {
    const win = this.settingsWindow;
    const request = pickRequest(options, at);
    if (!win || win.isDestroyed() || !request) return Promise.resolve(null);
    return popupChoice(win, request.options, request.at);
  }

  /** Settings' Show in Finder: the library's folder opens in Finder. Nothing without a library. */
  showLibraryInFinder(): void {
    const vault = this.vault;
    if (vault) void shell.openPath(vault.root);
  }

  /**
   * Settings' Set up Avanzel…, offered while there is no library: setup, where a library is made, opens or comes forward,
   * and Settings closes. Nothing while a library is open and still there; one that went while Avanzel ran doesn't count.
   */
  openSetupFromSettings(): void {
    if (this.vault?.exists()) return;
    this.setup.show();
    const win = this.settingsWindow;
    if (win && !win.isDestroyed()) win.close();
  }

  /** Settings, if it is open, is sent a fresh snapshot (`settings:changed`), which its shell draws in the pane it shows. */
  private refreshSettings(): void {
    const win = this.settingsWindow;
    if (win && !win.isDestroyed()) win.webContents.send("settings:changed", this.snapshot());
  }

  private broadcast(): void {
    this.refreshSettings();
    this.setup.publish();
    this.refreshMenu();
  }

  /**
   * The download's progress, to the windows that show it: Settings at each tick, and the setup window at most once every
   * SETUP_PROGRESS_MS (`setup.publishProgress`), since each of its snapshots reads the agents, the library's place and
   * its tasks afresh. The menu shows no progress, so it isn't rebuilt. The download's end goes to all of them
   * (`broadcast`).
   */
  private broadcastProgress(): void {
    this.refreshSettings();
    this.setup.publishProgress();
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
    const home = homedir();
    const kept = this.store.get().libraryPath; // the library to open at launch, which may not have opened
    // A library moved, renamed or unmounted while Avanzel runs is missing: what it held isn't read, so Settings still opens.
    const exists = vault?.exists() ?? false;
    return {
      app: this.store.get(),
      library: vault
        ? {
            path: vault.root,
            label: tildePath(vault.root, home),
            exists,
            isGit: existsSync(path.join(vault.root, ".git")),
            inbox: exists ? vault.pending().length : 0,
            shelves: exists ? vault.shelfCounts() : {},
            harness: settings?.harness ?? "auto",
            models: settings?.models ?? {},
            timeoutSeconds: settings?.timeoutSeconds ?? 900,
          }
        : kept
          ? { path: kept, label: tildePath(kept, home), exists: false, isGit: false, inbox: 0, shelves: {}, harness: "auto", models: {}, timeoutSeconds: 900 }
          : null,
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
      tasks: report.tasks.map((task) => this.taskInfo(task, stateRuns, now)),
      taskProblems: report.problems.map((p) => ({ file: vault ? vault.relativePath(p.file) : p.file, message: p.message })),
      shortcutProblems: this.shortcutProblems,
      shortcutAlternatives: Object.fromEntries(this.takenShortcuts.map((taken) => [taken.key, taken.alternatives])),
      obsidian: this.obsidianInstalled(),
      opensInObsidian: !!vault && obsidianUrl(vault.root, "") !== null && this.obsidianInstalled(),
    };
  }

  /**
   * A shadow task as Settings lists it, and setup's last step shows the evening review: its schedule as text ("daily
   * 21:00"), when it last ran (`ran`, by task) and runs next, and whether it is running.
   */
  private taskInfo(task: ShadowTask, ran: Record<string, string>, now: Date): TaskInfo {
    return {
      id: task.id,
      name: task.name,
      schedule: formatSchedule(task.schedule),
      kind: task.kind,
      agent: task.agent,
      enabled: task.enabled,
      instructions: task.instructions,
      lastRun: ran[task.id] ?? null,
      nextRun: task.enabled ? nextRun(task.schedule, now).toISOString() : null,
      running: this.running.has(task.id),
    };
  }

  /** Changed shortcuts are registered before it returns, so its snapshot says which are taken, with their alternatives. */
  async setApp(patch: Partial<AppSettings>): Promise<SettingsSnapshot> {
    return this.changeApp(patch);
  }

  /**
   * setApp, for `picked`'s shortcut chosen on the capsule's notice of a taken one, when it is (`useShortcut`). A new
   * Record a thought shortcut while setup's first-thought step shows starts that step's press test over, wherever it was
   * set: on the step itself, or in Settings → Voice, where the step's Open Settings leads. Opening at login is saved,
   * and macOS's login items follow it in a packaged Avanzel. Not with AVANZEL_TEST=1, which leaves this Mac's login
   * items be, nor in a development run, whose app is node_modules' Electron.app: the setting is kept all the same.
   */
  private async changeApp(patch: Partial<AppSettings>, picked?: keyof Shortcuts): Promise<SettingsSnapshot> {
    const before = this.store.get();
    const after = this.store.update(patch);
    if (JSON.stringify(before.shortcuts) !== JSON.stringify(after.shortcuts)) {
      await this.applyShortcuts();
      this.followShortcuts(picked);
      if (before.shortcuts.dictate !== after.shortcuts.dictate) this.setup.shortcutChanged();
    }
    if (patch.launchAtLogin !== undefined && process.env.AVANZEL_TEST !== "1" && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: after.launchAtLogin });
    }
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
    const result = parent ? await dialog.showOpenDialog(parent, LIBRARY_PICKER) : await dialog.showOpenDialog(LIBRARY_PICKER);
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

  /**
   * Makes a library in a new or empty folder and opens it. No window calls it: the e2e tests do, by name, to have a
   * library without the folder picker. A person chooses a folder with chooseLibrary, or sets one up in setup.
   */
  async createLibrary(requested: string): Promise<SettingsSnapshot> {
    const target = path.resolve(requested.replace(/^~(?=$|\/)/, homedir()));
    if (!new Vault(target).exists() && existsSync(target) && readdirSync(target).some((n) => n !== ".DS_Store")) {
      throw new AvanzelError(`${target} already has files in it. Pick an empty folder.`);
    }
    mkdirSync(target, { recursive: true });
    await Vault.init(target, { git: true });
    return this.useLibrary(target);
  }

  /**
   * Opens the library at `target` and keeps it for the next launch. Then the capsule names a shortcut another app holds,
   * now that the menu has Record a thought, unless the library comes `fromSetup`, whose own step names it.
   */
  private async useLibrary(target: string, fromSetup = false): Promise<SettingsSnapshot> {
    this.store.update({ libraryPath: target });
    this.openLibrary(target);
    this.armWaits(); // its notes that a usage limit stopped, and whose reset has come meanwhile, are filed now
    try {
      rememberVault(target);
    } catch (error) {
      console.error("remember vault", error);
    }
    await this.refreshModelStatus(); // its [voice] settings say which speech models it needs
    if (this.vault && this.model.kind === "missing") void this.downloadModel();
    this.checkAgents();
    if (!fromSetup) this.noticeTakenShortcut();
    this.broadcast();
    return this.snapshot();
  }

  // ---------------------------------------------------------------- setup

  /**
   * Avanzel's own window, for whatever asks for one: the shortcut, Quick or Ask before there is a library, or opening
   * Avanzel again. Setup while it is open, even once a step has made the library, so Settings never opens beside it.
   * Otherwise setup while there is no library, unless one failed to open (`libraryProblem`): Settings says why, and
   * fixes it. With a library, Settings.
   */
  showHome(): void {
    if (this.setup.isOpen() || (!this.vault && this.libraryProblem === null)) return this.setup.show();
    this.showSettings();
  }

  // What the e2e tests call on the controller by name (`call(app, name)`) that is now setup's: each passes the call on.

  setupSnapshot(): SetupSnapshot {
    return this.setup.snapshot();
  }

  enterSetupStep(step: SetupStep): SetupSnapshot {
    return this.setup.enterSetupStep(step);
  }

  chooseSetupAgent(name: string): SetupSnapshot {
    return this.setup.chooseSetupAgent(name);
  }

  createSetupLibrary(): Promise<SetupSnapshot> {
    return this.setup.createSetupLibrary();
  }

  typeSetupThought(words: unknown): SetupSnapshot {
    return this.setup.typeSetupThought(words);
  }

  askInSetup(question: unknown): Promise<SetupSnapshot> {
    return this.setup.askInSetup(question);
  }

  /** What setup reads from and calls on the controller (`SetupHost`), handed to it once, as it is made. */
  private setupHost(): SetupHost {
    return {
      vault: () => this.vault,
      model: () => this.model,
      settings: () => this.store.get(),
      hears: () => this.hears(),
      recording: () => this.recording,
      capsuleKind: () => this.capsuleState.kind,
      agentCheck: (name) => this.agentChecks.get(name),
      libraryProblem: () => this.libraryProblem,
      shortcutProblems: () => this.shortcutProblems,
      takenShortcuts: () => this.takenShortcuts,
      trayBounds: () => this.menuBar.bounds(),
      quitting: () => this.quitting,
      checksStopped: () => this.checksStopped,
      harnessTable: () => this.harnessTable(),
      harnessNamed: (name) => this.harnessNamed(name),
      safeTasks: (vault) => this.safeTasks(vault),
      readRunState: (vault) => this.readRunState(vault),
      taskInfo: (task, ran, now) => this.taskInfo(task, ran, now),
      shortcutApi: () => shortcutApi(),
      obsidianInstalled: () => this.obsidianInstalled(),
      agentName: (harness) => this.agentName(harness),
      broadcast: () => this.broadcast(),
      downloadModel: () => this.downloadModel(),
      checkAgents: () => this.checkAgents(),
      runAgentCheck: (name, harness, prompt, again) => this.runAgentCheck(name, harness, prompt, again),
      rereadSignIns: () => this.rereadSignIns(),
      useLibrary: (target, fromSetup) => this.useLibrary(target, fromSetup),
      setLibrarySettings: (patch) => this.setLibrarySettings(patch),
      changeApp: (patch, picked) => this.changeApp(patch, picked),
      useShortcut: (key, accelerator) => this.useShortcut(key, accelerator),
      startRecording: (mode, shot) => this.startRecording(mode, shot),
      hideCapsule: () => this.setCapsule({ kind: "hidden" }),
      toggleDictate: () => this.toggleDictate(),
      openQuick: () => this.openQuick(),
      enqueue: (work) => this.enqueue(work),
      file: (job) => void this.enqueue(() => this.runFiling(job)),
      takeBack: (job) => this.takeBack(job),
      revert: (commit) => this.revertFiling(commit),
      answer: (question, abort, progress) => this.answerQuestion(question, abort, progress),
      newCapture: (text, options) => this.requireVault().newCapture(text, options),
      firstRun: this.firstRun,
      queuedToFile: this.queuedToFile,
      noticed: this.noticed,
      opened: this.opened,
      copied: this.copied,
    };
  }

  // ---------------------------------------------------------------- agent checks

  /**
   * Starts the free checks of the installed agents not checked yet in this app run: each reads the agent's own sign-in
   * command and never asks the model (`prompt: false`). A sign-in it can't read leaves the agent unchecked, for Check.
   * Without a library, the built-in agents are checked in a scratch folder (`harnessTable`, `checkDir`). It returns at
   * once; Settings and setup get each result through settings:changed and setup:changed. An agent setup's person
   * picked meanwhile is asked its question when its sign-in said nothing (`setup.agentChecked`).
   */
  checkAgents(): SettingsSnapshot {
    for (const [name, harness] of Object.entries(this.harnessTable())) {
      if (harness.signIn && !this.agentChecks.has(name) && harness.available()) {
        void this.runAgentCheck(name, harness, false).then(() => this.setup.agentChecked(name));
      }
    }
    return this.snapshot();
  }

  /**
   * The setup window has the focus again, say back from Terminal, where the person may have signed an agent in: each
   * installed agent whose sign-in last said it isn't signed in has it read again. That only reads the sign-in, and never
   * asks the agent its question, unlike Check again (`checkAgent`). The row keeps saying "Not signed in" while it is
   * read, so Found changes only once the answer has. A read that learns nothing, as of a sign-in that can't be read
   * (whose "not signed in" came from its question), leaves that finding and its Notice; so does an answer that comes
   * after a newer one (Check again's).
   */
  rereadSignIns(): void {
    if (!this.setup.begun()) return;
    for (const name of this.setup.installed()) {
      const harness = this.harnessNamed(name);
      const status = this.agentChecks.get(name);
      if (!harness?.signIn || status?.kind !== "signed-out" || this.rereading.has(name)) continue;
      this.rereading.add(name);
      void this.runAgentCheck(name, harness, false, status).finally(() => this.rereading.delete(name));
    }
  }

  /**
   * Checks agent `name` again (Check in Settings → Agents, Check again in setup): its sign-in command, then its one
   * short question when it has none or that doesn't say. A check under way is left to finish.
   */
  checkAgent(name: string): SettingsSnapshot {
    const harness = this.harnessNamed(name);
    if (harness && this.agentChecks.get(name)?.kind !== "checking") void this.runAgentCheck(name, harness, true);
    return this.snapshot();
  }

  /** The agents by name: the library's (none when its settings don't load), or the built-in ones while there is none. */
  private harnessTable(): Record<string, Harness> {
    if (!this.vault) return listHarnesses(defaultSettings());
    try {
      return listHarnesses(loadSettings(this.vault.root));
    } catch {
      return {};
    }
  }

  /** Agent `name` from the harness table, if there is one by that name. */
  private harnessNamed(name: string): Harness | undefined {
    const table = this.harnessTable();
    return Object.hasOwn(table, name) ? table[name] : undefined;
  }

  /**
   * Where an agent check runs: the library, or before there is one, a scratch folder in the system's temporary folder,
   * made at the first such check and used for the rest of the app run. Making it may throw (a full disk, say).
   */
  private checkDir(): string {
    if (this.vault) return this.vault.root;
    this.checkScratch ??= mkdtempSync(path.join(tmpdir(), "avanzel-check-"));
    return this.checkScratch;
  }

  /**
   * When Avanzel quits, busy or not: stops every agent check still going on, its agent too (it runs detached, and its
   * timeout lives here), and no check starts after it. Quitting doesn't wait for them, and what they find is dropped.
   * The scratch folder the checks ran in goes too.
   */
  stopAgentChecks(): void {
    this.checksStopped = true;
    this.dropLibraryTimers();
    for (const abort of this.runningChecks) abort.abort();
    if (!this.checkScratch) return;
    try {
      rmSync(this.checkScratch, { recursive: true, force: true });
    } catch (error) {
      console.error("remove the agent checks' scratch folder", error); // the system clears its temporary folder in time
    }
    this.checkScratch = null;
  }

  /**
   * One check, run in the library or its scratch folder (`checkDir`): Settings and setup show it running, then what it
   * found. A scratch folder that can't be made is the check's failure, and the next check tries to make it again. Only
   * with `prompt` may it ask the model. Once Avanzel is quitting, none starts. A read `again` of a sign-in whose last
   * finding was `again` shows nothing while it runs, and what it finds replaces only that finding, not a newer one, and
   * only when it found something: learning nothing, it leaves the finding as it was.
   */
  private async runAgentCheck(name: string, harness: Harness, prompt: boolean, again?: AgentStatus): Promise<void> {
    if (this.quitting || this.checksStopped) return;
    const abort = new AbortController();
    this.runningChecks.add(abort);
    if (!again) {
      this.agentChecks.set(name, { kind: "checking" });
      this.broadcast();
    }
    let status: AgentStatus | null;
    try {
      status = statusOf(await checkHarness(harness, this.checkDir(), { signal: abort.signal, prompt }));
    } catch (error) {
      status = { kind: "failed", detail: errorMessage(error) }; // a check that throws still ends
    } finally {
      this.runningChecks.delete(abort);
    }
    if (abort.signal.aborted) return; // stopped for quitting: its "… was cancelled" is no news
    // A read again that learned nothing leaves the finding it was to check, which still stands; and a newer check may
    // have said more meanwhile.
    if (again && (!status || this.agentChecks.get(name) !== again)) return;
    if (status) this.agentChecks.set(name, status);
    else this.agentChecks.delete(name); // a first read that couldn't read the sign-in: "Installed", with Check
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
      return { kind: "error", cause: "settings", message: errorMessage(error), resumable: false };
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
      this.model = { kind: "error", cause: "settings", message: errorMessage(error), resumable: false }; // [voice] settings it can't use: nothing to fetch
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
          this.broadcastProgress();
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
        // Its message names the file and why, with no URL in it. Only a DownloadError can have kept a part to continue from.
        const reason = errorMessage(error);
        const resumable = error instanceof DownloadError && error.resumable;
        this.model = { kind: "error", cause: "download", message: reason, resumable };
        this.followDownload({ kind: "model-failed", reason, resumable });
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
    else if (model.kind === "error" && model.cause === "download") this.setCapsule({ kind: "model-failed", reason: model.message, resumable: model.resumable });
    else if (model.kind === "error") this.fail("Avanzel can't use these voice settings", model.message);
    else this.setCapsule({ kind: "hidden" }); // ready: nothing to wait for (missing never gets here: downloadModel() runs first)
  }

  /** Try again, on the capsule's notice of a failed download: it goes on from the part the download kept, if it kept one, and the capsule shows it. */
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
    // First, so that a note a limit stopped is filed by its own wait, with the agent that was stopped, ahead of a review that
    // comes due with it. A timer set before the Mac slept is late by the sleep, so this looks at the clock again, every minute
    // and on waking.
    this.armWaits();
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
      if (!task) throw new AvanzelError(noSuchReview(patch.id));
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
   * corrected words, once), one whose own filing waits in the queue (that files it, on its own card), or setup's mic
   * check, which waits for the person's File it anyway or Try again.
   */
  private leftAlone(left: Set<string>): (capturePath: string) => boolean {
    return (capturePath) => {
      const theirs = this.editing.has(capturePath) || this.queuedToFile.has(capturePath) || this.setup.holds(capturePath);
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
        const filedIds = new Set(result.outcomes.filter((o) => o.ok).map((o) => o.captureId));
        this.noteFiled((capture) => filedIds.has(path.basename(capture, path.extname(capture)))); // as a filing does (`runFiling`)
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
        this.notify(task.name, "Avanzel doesn't run custom reviews yet, so this one was skipped.");
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
    return this.setup.stepForTests();
  }

  /**
   * Presses `key`'s shortcut as the person would: the callback the shortcut stand-in (AVANZEL_FAKE_TAKEN_SHORTCUTS)
   * registered for it runs. False when it holds none, as for a shortcut another app holds: that press never reaches
   * Avanzel.
   */
  pressShortcutForTests(key: keyof Shortcuts): boolean {
    const press = fakeShortcuts.get(this.store.get().shortcuts[key]);
    press?.();
    return press !== undefined;
  }

  /**
   * What Open Terminal and Open System Settings opened, oldest first ("Terminal", "System Settings → Microphone");
   * recorded only with AVANZEL_TEST=1, which keeps them shut.
   */
  openedForTests(): string[] {
    return this.opened;
  }

  /** How many times Quit and reopen was asked; the app relaunches nothing with AVANZEL_TEST=1, which only counts. */
  relaunchedForTests(): number {
    return this.relaunched;
  }

  /** The capture of the note the capsule's failure card is about, while it shows one (what its button files again); else null. */
  cardCaptureForTests(): string | null {
    return this.cardCapture;
  }

  /** The agents whose sign-in is being watched for a failed filing (`watchSignIn`), and how many notes wait for each. */
  signInWatchesForTests(): { agent: string; notes: number }[] {
    return [...this.signInWatches].map(([agent, watch]) => ({ agent, notes: watch.notes.size }));
  }

  /** The text Copy put on the clipboard, oldest first; recorded only with AVANZEL_TEST=1. */
  copiedForTests(): string[] {
    return this.copied;
  }

  /**
   * What the filing guard's hook prints for a Write of `filePath` by an agent working in `root`: its deny, or "" when it
   * lets the write through. The hook runs as in a filing, through the shell, with this binary as Node.
   */
  guardForTests(root: string, filePath: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), "avanzel-guard-"));
    try {
      const command = installHook(dir, root, process.execPath);
      const input = JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath }, cwd: root });
      return execFileSync("/bin/sh", ["-c", command], { input, encoding: "utf8" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
