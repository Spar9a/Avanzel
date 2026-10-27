// First-run setup (§5): its window, the session it runs from the moment the window opens until it closes, and Zel's
// bubble under the menu bar icon once setup has ended. What it needs of the rest of the app, it asks the controller
// for through `SetupHost`; the controller calls its hooks as recordings and filings go on.
import { app, clipboard, dialog, screen, systemPreferences, type BrowserWindow, type Rectangle } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  Vault,
  WAITING,
  errorLine,
  git,
  loadSettings,
  selectHarness,
  type Capture,
  type CaptureOptions,
  type FileOutcome,
  type Harness,
  type ShadowTask,
} from "@avanzel/engine";
import { AGENT_INSTALLS, agentWorks, isSetupStep, NOTE_GONE } from "../shared/ipc.ts";
import type {
  AgentInstall,
  AgentStatus,
  AppSettings,
  CapsuleMode,
  CapsuleState,
  FiledPage,
  ModelStatus,
  SettingsSnapshot,
  SetupAgent,
  SetupAnswer,
  SetupFiling,
  SetupPress,
  SetupSnapshot,
  SetupStep,
  SetupThought,
  Shortcuts,
  TaskInfo,
  UpHereSnapshot,
} from "../shared/ipc.ts";
import type { AgentFailure, PartialEdits } from "../shared/problems.ts";
import { errorMessage, harnessName, LIBRARY_PICKER, type Answered, type FilingJob, type Recording } from "./jobs.ts";
import { answeredFrom, captureMeta, obsidianUrl } from "./library-info.ts";
import { stepThrottle } from "./narration.ts";
import { permissionStatus, requestMicrophone } from "./permissions.ts";
import { runningAppNames } from "./running-apps.ts";
import type { RunState } from "./schedule.ts";
import {
  afterStop,
  bestAgent,
  defaultLibraryPath,
  flightTarget,
  libraryAgent,
  libraryFolder,
  looksLikeATest,
  suggestQuestion,
  tildePath,
  tooBroad,
  unrecordedEdits,
  upHerePlace,
  type Box,
} from "./setup-model.ts";
import { freeAlternatives, likelyHolder, type ShortcutApi } from "./shortcuts.ts";
import type { FirstRunLog, NoticedShortcuts } from "./store.ts";
import { openTerminal } from "./terminal.ts";
import { createSetupWindow, createUpHereWindow, UP_HERE_SIZE } from "./windows.ts";

/** The capsule's notice of a shortcut another app holds. */
type TakenShortcut = Extract<CapsuleState, { kind: "shortcut-taken" }>;

/**
 * What setup reads from and calls on the controller, which hands it over as it makes `Setup`. Each member wraps the
 * controller's own of the same name, with its signature, unless its comment names another.
 */
export interface SetupHost {
  // What setup reads.
  /** The library, while one is open. */
  vault(): Vault | null;
  /** Whether this Mac has the speech models the [voice] settings need. */
  model(): ModelStatus;
  /** The app's own settings (the settings store's). */
  settings(): AppSettings;
  hears(): boolean;
  /** The capsule's recording, while one runs. */
  recording(): Recording | null;
  /** What the capsule shows (`capsuleState`). */
  capsuleKind(): CapsuleState["kind"];
  /** What agent `name`'s check found in this app run (`agentChecks`). */
  agentCheck(name: string): AgentStatus | undefined;
  libraryProblem(): string | null;
  shortcutProblems(): Partial<Record<keyof Shortcuts, string>>;
  takenShortcuts(): TakenShortcut[];
  /** Where the menu bar icon is (the menu bar's `bounds`). */
  trayBounds(): Rectangle;
  quitting(): boolean;
  checksStopped(): boolean;
  harnessTable(): Record<string, Harness>;
  harnessNamed(name: string): Harness | undefined;
  safeTasks(vault: Vault): ShadowTask[];
  readRunState(vault: Vault): RunState;
  taskInfo(task: ShadowTask, ran: Record<string, string>, now: Date): TaskInfo;
  /** Electron's global shortcuts, or the tests' stand-in for them (the controller module's `shortcutApi`). */
  shortcutApi(): ShortcutApi;
  obsidianInstalled(): boolean;
  agentName(harness?: string): string;

  // What setup has the controller do.
  /** Settings, the setup window (`Setup.publish`) and the menu bar get what they show now. */
  broadcast(): void;
  /**
   * The menu bar icon is shown again (the controller's `refreshTray`) without its menu rebuilt: setup's window or Zel's bubble
   * has opened or closed, and the icon's title gives way to it, or comes back.
   */
  refreshTray(): void;
  downloadModel(): Promise<SettingsSnapshot>;
  checkAgents(): SettingsSnapshot;
  runAgentCheck(name: string, harness: Harness, prompt: boolean, again?: AgentStatus): Promise<void>;
  rereadSignIns(): void;
  useLibrary(target: string, fromSetup?: boolean): Promise<SettingsSnapshot>;
  setLibrarySettings(patch: { harness?: string; models?: Record<string, string>; timeoutSeconds?: number }): Promise<SettingsSnapshot>;
  changeApp(patch: Partial<AppSettings>, picked?: keyof Shortcuts): Promise<SettingsSnapshot>;
  useShortcut(key: keyof Shortcuts, accelerator: string): Promise<void>;
  /**
   * Setup's first spoken thought is recorded as any dictation is, except that it has no file mode to switch (`Recording.fileMode`)
   * and is offered no Stop while its words are made (`Recording.forSetup`).
   */
  startRecording(mode: CapsuleMode, shot?: Recording["shot"]): Promise<void>;
  /** The capsule hides (`setCapsule`). */
  hideCapsule(): void;
  toggleDictate(): Promise<void>;
  openQuick(): void;
  /** `work` runs once the work queued before it has (the controller's queue, where every agent run waits its turn). */
  enqueue<T>(work: () => Promise<T>): Promise<T>;
  /** `job` is filed in queue order (`runFiling`), as any filing is. */
  file(job: FilingJob): void;
  takeBack(job: FilingJob): Promise<string | null>;
  /** Git takes back a filing's `commit`, in queue order (`revertFiling`). */
  revert(commit: string): Promise<boolean>;
  /** The library's agent answers `question`, read-only (`answerQuestion`); a failed answer carries why (`failure`) and how many files the run changed. */
  answer(question: string, abort: AbortController, progress: (message: string) => void): Promise<Answered>;
  /** A capture in the library's inbox (the library's `newCapture`); without a library, it throws. */
  newCapture(text: string, options: CaptureOptions): Capture;

  // What setup and the controller share.
  readonly firstRun: FirstRunLog;
  readonly queuedToFile: Set<string>;
  readonly noticed: NoticedShortcuts;
  readonly opened: string[];
  readonly copied: string[];
  /** What Install git would have run, with AVANZEL_TEST=1 only (`installGit`). */
  readonly spawned: string[];
}

/** How often setup looks for an installed agent while this Mac has none: Found says it notices one. */
const AGENT_POLL_MS = 2_000;
/**
 * How long the first-thought step waits for a press of Record a thought's shortcut, once the person reaches for it (its
 * first modifier goes down in the setup window), before it offers free ones (§5.2). macOS lets an app register a
 * shortcut another app holds, so only a press that arrives says it works (tests change it).
 */
const PRESS_WAIT_MS = (process.env.AVANZEL_TEST === "1" && Number(process.env.AVANZEL_PRESS_WAIT_MS)) || 3_000;
/**
 * At most how often a download's progress reaches the setup window: each setup snapshot reads the agents, the library's
 * place and its tasks afresh, so not at each of the download's ticks (Settings gets those).
 */
const SETUP_PROGRESS_MS = 1_000;

/** The setup window and what it is doing, from the moment it opens until it closes. */
interface SetupSession {
  window: BrowserWindow;
  /** The step the window shows. */
  step: SetupStep;
  /** Where Looks good makes or uses the library. */
  libraryPath: string;
  /**
   * Found has been entered: Set me up started the download and the agents' checks, which happens once a session. Set
   * once that work has run, so work that threw is tried again when Found is entered again.
   */
  begun: boolean;
  /**
   * The agents installed when Found was first entered, by harness name, in the table's order. With none then, the ones
   * installed since, once `pollTimer` finds the first.
   */
  installed: string[];
  /** While no agent is installed, it looks for one every AGENT_POLL_MS (`pollForAgents`); null otherwise. */
  pollTimer: NodeJS.Timeout | null;
  /** The agent the person picked on Found (Use {agent}); null while setup chooses (bestAgent). */
  picked: string | null;
  /**
   * Why Looks good couldn't make or use the library at `libraryPath`, for Found to show. Not the controller's own
   * `libraryProblem`, which says why a stored library didn't open (showHome() and the menu read that one).
   */
  makeProblem: string | null;
  /**
   * While the first-thought step waits for a press of the shortcut, which it does once the person reaches for it
   * (`reachForShortcut`): the wait's timer (PRESS_WAIT_MS), which stays set until the wait has ended, the running apps'
   * read included (`noPressArrived`). Null otherwise.
   */
  pressTimer: NodeJS.Timeout | null;
  /** A press of the shortcut arrived since the step asked for one. */
  heard: boolean;
  /** The person reached for the shortcut, no press arrived within the wait, and none since. */
  silent: boolean;
  /** While silent: the running app whose default shortcut it is, if one is running. */
  holder: string | null;
  /** While silent: free shortcuts to use instead, best first. */
  alternatives: string[];
  /** The first thought's filing, from the moment its words exist (`takeThought`); the newest one after File it again. */
  job: FilingJob | null;
  /**
   * What the window shows of that filing; null before the thought is handed over. While it runs, its `rows` and `written`
   * are those of the `job`, as they are when a snapshot is made (`snapshot`).
   */
  filing: SetupFiling | null;
  /** Why the last typed thought wasn't taken; each try clears it. */
  typeProblem: string | null;
  /**
   * The first spoken thought on the first-thought step. Its recording's own hooks move it on while the window shows that
   * step (`moveThought`, `heard`, `lost`); once its words are handed over (`takeThought`), it waits again.
   */
  thought: SetupThought;
  /**
   * The capsule's recording of that thought, from the press that starts it until its words or its problem arrive: what
   * tells setup's own recording from another one, which the capsule shows as ever. Null otherwise.
   */
  recording: Recording | null;
  /** While the thought is a mic check: its capture in the inbox, which File it anyway files and Try again removes. */
  testCapture: string | null;
  /** macOS is being asked about the microphone (`allowMicrophone`), which happens once at a time. */
  askingMicrophone: boolean;
  /** The question on the Ask step and how it went; null until one is asked, and again after Skip. */
  answer: SetupAnswer | null;
  /** Stops the question being answered (Skip, or the window closing); null while none is. */
  askAbort: AbortController | null;
  /** The last step has shown: it turned opening at login on, which happens once a session. */
  doneEntered: boolean;
  /**
   * Start using Avanzel was used. The window's closing is then the end of setup, not a close in the middle of it
   * (`end`).
   */
  finished: boolean;
}

export class Setup {
  /** The setup window's session while it is open. */
  private session: SetupSession | null = null;
  /** Zel's bubble under the menu bar icon, from the end of setup until it is put away (`closeUpHere`). */
  private upHereWindow: BrowserWindow | null = null;
  /** When the setup window was last sent the download's progress (`publishProgress`). */
  private setupProgressAt = 0;
  /** The filing whose steps the setup window is being sent (`stepped`). */
  private steppedJob: FilingJob | null = null;
  /**
   * Sends the setup window the steps of `steppedJob`, at most once every STEP_MS (`stepThrottle`), the way the capsule's card
   * is sent a filing's. A send that has waited asks again whether the window still shows that filing running: if it has ended,
   * or another has taken its place, the window was told of that at once (`broadcast`), and the send is dropped. It sends only
   * `setup:changed`, as `publishProgress` does: no Settings snapshot, and no menu.
   */
  private readonly sendSteps = stepThrottle(() => {
    const job = this.steppedJob;
    if (job && this.showsRunning(job)) this.session?.window.webContents.send("setup:changed", this.snapshot());
  });

  constructor(private readonly host: SetupHost) {}

  /** The setup window is open: its session runs. */
  isOpen(): boolean {
    return this.session !== null;
  }

  /** Zel's bubble is up under the menu bar icon (`openUpHere`) and hasn't been put away (`closeUpHere`). */
  upHereOpen(): boolean {
    return this.upHereWindow !== null && !this.upHereWindow.isDestroyed();
  }

  /**
   * Brings the setup window forward, or opens a new one, which starts a new session on Hello once it has drawn. A new
   * session makes or uses the library at `place`, where Found starts; without one, at the library stored in the settings,
   * else ~/Avanzel. A window already open keeps the place it has. While the window is open, Avanzel shows its Dock icon, so
   * a window gone behind Terminal, say, can be found again; setup's end hides it (`end`).
   */
  show(place?: string): void {
    if (this.session && !this.session.window.isDestroyed()) {
      app.focus({ steal: true });
      this.session.window.show();
      this.session.window.focus();
      return;
    }
    const win = createSetupWindow();
    void app.dock?.show().catch((error: unknown) => console.error("dock", error));
    // Shown once its page has drawn, so it never flashes blank first.
    win.once("ready-to-show", () => {
      if (win.isDestroyed()) return;
      app.focus({ steal: true });
      win.show();
      win.focus();
    });
    win.on("closed", () => this.end(win));
    // Back from Terminal, say, where the person may have signed an agent in, or from Apple's installer, where they may have
    // installed git: Found notices.
    win.on("focus", () => {
      this.host.rereadSignIns();
      this.rereadGit();
    });
    this.session = {
      window: win,
      step: "hello",
      libraryPath: place ?? this.setupLibraryPath(),
      begun: false,
      installed: [],
      pollTimer: null,
      picked: null,
      makeProblem: null,
      pressTimer: null,
      heard: false,
      silent: false,
      holder: null,
      alternatives: [],
      job: null,
      filing: null,
      typeProblem: null,
      thought: { kind: "waiting" },
      recording: null,
      testCapture: null,
      askingMicrophone: false,
      answer: null,
      askAbort: null,
      doneEntered: false,
      finished: false,
    };
    this.host.firstRun.entered("hello", new Date()); // the renderer starts there, and doesn't enter it
    this.host.refreshTray(); // the icon's title gives way to the window, which flies to the icon's bounds at the end
  }

  /**
   * The setup window closed: its session ends with it, stops looking for agents, and stops waiting for a press, so the
   * wait can't end against a closed window. A question it was answering is given up: its agent stops, and the library
   * is free. A mic check waiting for File it anyway or Try again goes, its note and its recording (`discardTest`), as
   * Try again would: left in the inbox, the evening review would file "Testing, testing" with an agent run. A filing it
   * started goes on, and says how it went by notification (`runFiling`). The Dock icon goes again: Avanzel lives in the
   * menu bar. A newer window's session is its own. Unless Start using Avanzel ended it, the step it was closed on is
   * noted (`firstRun`).
   */
  private end(win: BrowserWindow): void {
    const session = this.session;
    if (session?.window !== win) return;
    this.stopPolling(session);
    this.stopPressTest(session);
    this.discardTest(session);
    session.askAbort?.abort();
    app.dock?.hide();
    if (!session.finished) this.host.firstRun.closed(session.step);
    this.session = null;
    this.host.refreshTray();
  }

  /** Where a new session makes or uses the library unless `show` is given a place: the stored libraryPath, else ~/Avanzel. */
  private setupLibraryPath(): string {
    return this.host.settings().libraryPath ?? defaultLibraryPath(homedir());
  }

  /**
   * The window has the focus again. While this Mac has no usable git, it is looked for afresh (the engine keeps its answer
   * for the process): the person may have installed the Command Line Tools meanwhile, and Found then drops its line about
   * git and its Install git.
   */
  private rereadGit(): void {
    if (git.gitUsable()) return;
    git.resetGitUsable();
    if (git.gitUsable()) this.host.broadcast();
  }

  /**
   * What the setup window shows; without a session, what a fresh one would show. A folder that is a library already
   * offers its own agent first (bestAgent), so a library brought from another Mac keeps the agent it files with.
   */
  snapshot(): SetupSnapshot {
    const libraryPath = this.session?.libraryPath ?? this.setupLibraryPath();
    const folder = libraryFolder(libraryPath);
    const agents = this.setupAgents();
    const vault = this.host.vault();
    // Ask suggests a question only about pages that stand: not once an undo of the filing has begun, nor after it.
    const filing = this.session?.filing;
    const standing = filing?.kind === "filed" && !filing.undoing ? filing.pages : [];
    // A running filing shows what its agent has done so far: its job's rows and the pages it has written, as they are now.
    const job = this.session?.job;
    const shown = filing?.kind === "running" ? { ...filing, rows: job?.rows ?? filing.rows, written: job?.written ?? filing.written } : (filing ?? null);
    return {
      libraryPath,
      libraryLabel: tildePath(libraryPath, homedir()),
      folder,
      tooBroad: tooBroad(libraryPath, homedir()),
      gitUsable: git.gitUsable(),
      libraryReady: !!vault,
      model: this.host.model(),
      shortcut: this.host.settings().shortcuts.dictate,
      typeShortcut: this.typeShortcut(),
      noAgent: this.session?.begun === true && this.session.installed.length === 0,
      agents,
      agent: this.session?.picked ?? bestAgent(agents, folder === "library" ? libraryAgent(libraryPath) : null),
      makeProblem: this.session?.makeProblem ?? null,
      press: this.setupPressState(),
      filing: shown,
      typeProblem: this.session?.typeProblem ?? null,
      thought: this.session?.thought ?? { kind: "waiting" },
      hears: this.host.hears(),
      opensInObsidian: !!vault && obsidianUrl(vault.root, "") !== null && this.host.obsidianInstalled(),
      suggestion: suggestQuestion(standing),
      answer: this.session?.answer ?? null,
      launchAtLogin: this.host.settings().launchAtLogin,
      eveningReview: this.eveningReview(),
      sounds: this.host.settings().sounds,
    };
  }

  /** The setup window, while it is open, gets what it shows now: the controller's `broadcast` sends it. */
  publish(): void {
    const setup = this.session?.window;
    if (setup && !setup.isDestroyed()) setup.webContents.send("setup:changed", this.snapshot());
  }

  /**
   * The download's progress, to the setup window, at most once every SETUP_PROGRESS_MS, since each of its snapshots reads
   * the agents, the library's place and its tasks afresh: the controller's `broadcastProgress` sends it.
   */
  publishProgress(): void {
    const setup = this.session?.window;
    if (!setup || setup.isDestroyed() || Date.now() - this.setupProgressAt < SETUP_PROGRESS_MS) return;
    this.setupProgressAt = Date.now();
    setup.webContents.send("setup:changed", this.snapshot());
  }

  /**
   * The library's evening review, as Settings lists it, for the last step's switch: its first task whose kind is
   * "evening-review". Null without a library, and when the library has none (its owner deleted the file, say).
   */
  private eveningReview(): TaskInfo | null {
    const vault = this.host.vault();
    const task = vault ? this.host.safeTasks(vault).find((t) => t.kind === "evening-review") : undefined;
    return vault && task ? this.host.taskInfo(task, this.host.readRunState(vault).ran, new Date()) : null;
  }

  /**
   * The press test as the first-thought step shows it: a shortcut another app holds, with the holder and the free ones
   * its registration found (takenShortcuts); otherwise what the session heard, or didn't within the wait.
   */
  private setupPressState(): SetupPress {
    const taken = this.host.takenShortcuts().find((notice) => notice.key === "dictate");
    if (taken) return { taken: true, heard: false, silent: false, holder: taken.holder, alternatives: taken.alternatives };
    const session = this.session;
    return {
      taken: false,
      heard: session?.heard ?? false,
      silent: session?.silent ?? false,
      holder: session?.holder ?? null,
      alternatives: session?.alternatives ?? [],
    };
  }

  /**
   * The agents Found lists: those installed when it was first entered (or, with none then, since), with what their
   * checks found in this app run.
   */
  private setupAgents(): SetupAgent[] {
    const installed = this.session?.installed ?? [];
    if (!installed.length) return []; // before Set me up, or with nothing installed: the table needn't be read
    const table = this.host.harnessTable();
    return installed.flatMap((name) => {
      const harness = Object.hasOwn(table, name) ? table[name] : undefined;
      if (!harness) return []; // a library made since has no such agent
      return [{ name, label: harnessName(name), freeCheck: harness.signIn !== undefined, status: this.host.agentCheck(name) ?? null }];
    });
  }

  /**
   * The setup window shows `step` now; anything that isn't a step is ignored. Each step's work hangs on this: the first
   * time Found is entered, Set me up's work; each time the first-thought step is, its press test afresh
   * (`listenForPress`), which any other step stops, and its spoken thought afresh, so coming back never shows the last
   * visit's Notice. A mic check stays, since its note waits in the inbox for File it anyway or Try again. The first time
   * the last step is entered, opening at login turns on, so its switch shows the spec's default; what the person sets
   * there then stays. The first time each step is entered is noted (`firstRun`).
   */
  enterSetupStep(step: SetupStep): SetupSnapshot {
    const session = this.session;
    if (session && isSetupStep(step)) {
      session.step = step;
      this.host.firstRun.entered(step, new Date());
      if (step === "found" && !session.begun) this.beginSetup(session);
      if (step === "think") {
        if (session.thought.kind !== "test") session.thought = { kind: "waiting" };
        this.listenForPress(session);
      } else this.stopPressTest(session);
      if (step === "done" && !session.doneEntered) {
        session.doneEntered = true;
        // Saved before this returns (changeApp waits only when shortcuts change), so the snapshot below has it on.
        void this.host.changeApp({ launchAtLogin: true }).catch((error: unknown) => console.error("launch at login", error));
      }
    }
    return this.snapshot();
  }

  /**
   * Set me up, the first time Found is entered in a session: the speech models start downloading if this Mac doesn't
   * have them, and the installed agents are noted and their sign-in read. Nothing asks an agent anything. With none
   * installed, setup looks for one until it comes (`pollForAgents`). The session has begun only once all of that has
   * run: if any of it throws, entering Found again tries again.
   */
  private beginSetup(session: SetupSession): void {
    if (this.host.model().kind === "missing") void this.host.downloadModel();
    session.installed = this.installedAgents();
    this.host.checkAgents();
    if (!session.installed.length) this.pollForAgents(session);
    session.begun = true;
  }

  /** The session has begun (Set me up's work has run), for `rereadSignIns`. */
  begun(): boolean {
    return this.session?.begun ?? false;
  }

  /** The agents the session noted as installed, for `rereadSignIns`; none without a session. */
  installed(): readonly string[] {
    return this.session?.installed ?? [];
  }

  /** The agents installed on this Mac now, by harness name, in the harness table's order. */
  private installedAgents(): string[] {
    return Object.entries(this.host.harnessTable()).filter(([, harness]) => harness.available()).map(([name]) => name);
  }

  /**
   * With no agent installed, Found says to install one and that setup notices it: every AGENT_POLL_MS this looks again.
   * Once one is there, the looking stops, the agents are noted, their sign-in read (checkAgents), and Found shows them.
   */
  private pollForAgents(session: SetupSession): void {
    this.stopPolling(session);
    session.pollTimer = setInterval(() => {
      const installed = this.installedAgents();
      if (!installed.length) return;
      this.stopPolling(session);
      session.installed = installed;
      this.host.checkAgents();
      this.host.broadcast();
    }, AGENT_POLL_MS);
  }

  private stopPolling(session: SetupSession): void {
    if (session.pollTimer) clearInterval(session.pollTimer);
    session.pollTimer = null;
  }

  /** Use {agent}, on Found: the person's pick files from now on. Only an installed agent can be picked (`askPicked`). */
  chooseSetupAgent(name: string): SetupSnapshot {
    const session = this.session;
    if (session?.installed.includes(name)) {
      session.picked = name;
      this.askPicked(name);
      this.host.broadcast();
    }
    return this.snapshot();
  }

  /**
   * Setup's picked agent `name`, when nothing has said yet whether it works (it has no sign-in command, or its sign-in
   * couldn't be read), is asked its one short question: the person picked it, so the question's cost is theirs to
   * choose. Picked while its sign-in is still being read, it is asked once that read has said nothing (`checkAgents`).
   */
  private askPicked(name: string): void {
    const harness = this.host.harnessNamed(name);
    if (harness && this.session?.picked === name && this.host.agentCheck(name) === undefined) void this.host.runAgentCheck(name, harness, true);
  }

  /** Agent `name`'s free check has ended (`checkAgents`): if the person picked it meanwhile, it may be asked (`askPicked`). */
  agentChecked(name: string): void {
    this.askPicked(name);
  }

  /**
   * Looks good, or Use this folder, on Found: the library at the session's place, with the chosen agent saved as its
   * own. A missing or empty folder becomes a new library; a folder with files keeps every one (its history starts with
   * them, unless it is a git repository already); an Avanzel library is used as it is; the library already open only
   * has the agent saved. Whatever goes wrong, or a library that still isn't open afterwards, is the session's
   * `makeProblem`, which Found shows. Without a chosen agent that works, nothing is made: Found's button waits for one.
   * Nor is anything made at a place too broad for a library (tooBroad), such as ~/Documents: Found says why.
   */
  async createSetupLibrary(): Promise<SetupSnapshot> {
    const session = this.session;
    if (!session) return this.snapshot();
    const target = session.libraryPath;
    const before = this.snapshot(); // before the library's own agents replace the built-in ones
    const chosen = before.agents.find((agent) => agent.name === before.agent);
    if (!chosen || !agentWorks(chosen.status) || before.tooBroad) return before;
    let problem: string | null = null;
    try {
      if (this.host.vault()?.root !== target) {
        const folder = libraryFolder(target);
        if (folder === "missing" || folder === "empty") mkdirSync(target, { recursive: true });
        // Without a usable git (none, or only Apple's stub, which opens an install dialog when run) no git runs at all.
        if (folder !== "library") await Vault.init(target, { git: git.gitUsable() });
        await this.host.useLibrary(target, true);
        if (!this.host.vault()) throw new Error(this.host.libraryProblem() ?? `There is no Avanzel library at ${target}.`);
      }
      await this.host.setLibrarySettings({ harness: chosen.name });
    } catch (error) {
      problem = errorMessage(error);
    }
    session.makeProblem = problem;
    this.host.broadcast();
    return this.snapshot();
  }

  /**
   * Change…, on Found: the folder picker, as a sheet on the setup window. The folder chosen is where Looks good makes or
   * uses the library, and a problem making the last one goes with it. Nothing is made yet.
   */
  async chooseSetupFolder(): Promise<SetupSnapshot> {
    const session = this.session;
    if (!session || session.window.isDestroyed()) return this.snapshot();
    const result = await dialog.showOpenDialog(session.window, LIBRARY_PICKER);
    const chosen = result.filePaths[0];
    if (!result.canceled && chosen && this.session === session) {
      session.libraryPath = chosen;
      session.makeProblem = null;
      this.host.broadcast();
    }
    return this.snapshot();
  }

  /** Open Terminal, on a signed-out agent's Notice. With AVANZEL_TEST=1 Terminal stays shut, and openedForTests says so. */
  openTerminal(): void {
    openTerminal(this.host.opened);
  }

  /**
   * Copy, beside an install command on Found: the command that installs `agent` ("claude"), from AGENT_INSTALLS, so only
   * a command Found shows ever reaches the clipboard; anything else is ignored. With AVANZEL_TEST=1 the clipboard is left
   * be, and copiedForTests says what.
   */
  copyInstall(agent: unknown): void {
    if (typeof agent !== "string" || !Object.hasOwn(AGENT_INSTALLS, agent)) return;
    const { command } = AGENT_INSTALLS[agent as AgentInstall];
    if (process.env.AVANZEL_TEST === "1") this.host.copied.push(command);
    else clipboard.writeText(command);
  }

  /**
   * Install git, on Found while this Mac has no usable git: macOS opens Apple's dialog to install the Command Line Tools
   * (`xcode-select --install`, which only asks for them). The window notices the install once it has the focus again
   * (`rereadGit`). Nothing without a window or with git usable already: only what Found offers is done. With AVANZEL_TEST=1
   * nothing runs, and spawnedForTests says what would have.
   */
  installGit(): void {
    if (!this.session || git.gitUsable()) return;
    if (process.env.AVANZEL_TEST === "1") {
      this.host.spawned.push("xcode-select --install");
      return;
    }
    const child = spawn("/usr/bin/xcode-select", ["--install"], { stdio: "ignore" });
    child.on("error", (error) => console.error("xcode-select --install", error));
    child.unref();
  }

  /**
   * Record a thought, from its shortcut or the menu, is setup's while the first-thought step shows and nothing records;
   * stopping a recording isn't.
   */
  takesPress(): boolean {
    return this.session?.step === "think" && !this.host.recording();
  }

  /**
   * Record a thought's own shortcut was pressed while setup takes presses: it works, so the press test's wait ends and
   * the step says so. Only the shortcut's callback calls this (`pressDictate`): Record a thought in the menu records the
   * same way, but says nothing of the shortcut.
   */
  notePress(): void {
    const session = this.session;
    if (!session || !this.takesPress()) return;
    this.stopPressTest(session);
    session.heard = true;
    this.host.broadcast();
  }

  /**
   * Record a thought on the first-thought step: the first spoken thought. Nothing happens while macOS is about to ask
   * about the microphone (primer) or the words are being made (transcribing). A mic check on the step is put away
   * first, as Try again does: the press that arrived is the one Try again would wait for. Without the speech models
   * (`hears`) nothing records: a missing one starts downloading, and the step says its ears are on the way. A microphone
   * macOS hasn't asked about shows the primer; one turned down, where to allow it. Otherwise the capsule records it.
   */
  async press(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const { kind } = session.thought;
    if (kind === "primer" || kind === "transcribing") return;
    if (kind === "test") {
      this.discardTest(session);
      session.thought = { kind: "waiting" };
    }
    const microphone = permissionStatus("microphone");
    if (!this.host.hears()) {
      if (this.host.model().kind === "missing") void this.host.downloadModel();
    } else if (microphone === "not-determined") {
      session.thought = { kind: "primer" };
    } else if (microphone === "denied" || microphone === "restricted") {
      session.thought = { kind: "denied" };
    } else {
      return this.recordThought(session);
    }
    this.host.broadcast();
  }

  /**
   * The capsule records the first spoken thought, as it records any; once the recording exists, it is setup's own
   * (`recording`), and the step is listening.
   */
  private async recordThought(session: SetupSession): Promise<void> {
    await this.host.startRecording("dictate");
    const recording = this.host.recording();
    if (this.session === session && session.step === "think" && recording) {
      session.recording = recording;
      session.thought = { kind: "listening", startedAt: recording.startedAt };
    }
    this.host.broadcast();
  }

  /**
   * Continue, on the microphone's primer: macOS asks, once at a time. A grant records the thought at once, as the press
   * that brought the primer asked; any other answer says where to allow it.
   */
  async allowMicrophone(): Promise<void> {
    const session = this.session;
    if (!session || session.thought.kind !== "primer" || session.askingMicrophone) return;
    session.askingMicrophone = true;
    const granted = await requestMicrophone().catch(() => false);
    session.askingMicrophone = false;
    if (this.session !== session || session.step !== "think" || session.thought.kind !== "primer") return;
    if (granted) return this.recordThought(session);
    session.thought = { kind: "denied" };
    this.host.broadcast();
  }

  /**
   * What became of `recording`, said to setup's first spoken thought when it is that thought's own recording and the
   * window shows the first-thought step: the thought moves on to `next`. One that no longer listens or waits for its
   * words lets go of the recording. Whether it did. Any other recording is none of setup's business.
   */
  moveThought(recording: Recording, next: SetupThought): boolean {
    const session = this.session;
    if (session?.recording !== recording || session.step !== "think") return false;
    session.thought = next;
    if (next.kind !== "listening" && next.kind !== "transcribing") session.recording = null;
    this.host.broadcast();
    return true;
  }

  /**
   * `recording` went wrong. When it is setup's first spoken thought, the setup window says so, and the capsule's card of
   * it goes (`hideThoughtCard`). Whether it was.
   */
  lost(recording: Recording, failed: Extract<SetupThought, { kind: "failed" }>): boolean {
    if (!this.moveThought(recording, failed)) return false;
    this.hideThoughtCard();
    return true;
  }

  /**
   * The setup window has taken setup's first spoken thought over from the capsule: the capsule's card of its recording
   * (listening, or transcribing) goes. Not while another recording runs, whose card the capsule shows now, and which
   * must stay in view.
   */
  private hideThoughtCard(): void {
    const kind = this.host.capsuleKind();
    if (!this.host.recording() && (kind === "listening" || kind === "transcribing")) this.host.hideCapsule();
  }

  /**
   * The words of the capture at `capturePath` exist, spoken in `recording`. When that is setup's first spoken thought,
   * they are that thought, and the capsule's card of it goes: a mic check stays on the step with its warm answer, its
   * capture kept in the inbox for File it anyway or Try again; anything else is filed in the window (`takeThought`).
   * Whether setup took them.
   */
  heard(recording: Recording, capturePath: string, words: string, transcribedIn: number | null): boolean {
    const session = this.session;
    if (session?.recording !== recording || session.step !== "think") return false;
    session.recording = null;
    this.hideThoughtCard();
    if (looksLikeATest(words)) {
      session.testCapture = capturePath;
      session.thought = { kind: "test", words };
      this.host.broadcast();
    } else {
      this.takeThought(capturePath, words, transcribedIn);
    }
    return true;
  }

  /**
   * Try again, on a mic check's answer or a recording problem's Notice: the mic check's capture and its recording leave
   * the library, and the step asks for the thought afresh, and for a press: its press test starts over, though its wait
   * starts only once the person reaches for the shortcut.
   */
  retrySetupThought(): void {
    const session = this.session;
    const kind = session?.thought.kind;
    if (!session || session.step !== "think" || (kind !== "test" && kind !== "failed")) return;
    this.discardTest(session);
    session.thought = { kind: "waiting" };
    this.listenForPress(session);
    this.host.broadcast();
  }

  /** File it anyway, on a mic check's answer: its capture is the first thought after all, filed in the window. */
  fileSetupAnyway(): void {
    const session = this.session;
    const thought = session?.thought;
    if (!session || session.step !== "think" || thought?.kind !== "test" || !session.testCapture) return;
    this.takeThought(session.testCapture, thought.words, null);
  }

  /**
   * A mic check isn't a thought: its capture leaves the inbox, and its recording leaves raw/audio/. Only a recording in
   * there goes. Gone already (say, filed by another Avanzel), it is left be.
   */
  private discardTest(session: SetupSession): void {
    const capture = session.testCapture;
    session.testCapture = null;
    const vault = this.host.vault();
    if (!capture || !vault || !existsSync(capture)) return;
    try {
      const audio = captureMeta(capture).audio;
      const recording = audio ? path.resolve(vault.root, audio) : null;
      if (recording?.startsWith(path.resolve(vault.root, "raw", "audio") + path.sep)) rmSync(recording, { force: true });
      rmSync(capture, { force: true });
    } catch (error) {
      console.error("mic check", error);
    }
  }

  /**
   * The capture at `capturePath` is the mic check's, which waits for the person's File it anyway or Try again: an
   * evening review leaves it be (`leftAlone`).
   */
  holds(capturePath: string): boolean {
    return this.session?.testCapture === capturePath;
  }

  /**
   * The first-thought step asks for a press of Record a thought's shortcut, afresh: nothing heard or missed yet. One
   * another app holds is named by the step at once, so it is noticed (the capsule won't name it at the next launch).
   * Nothing is waited for yet: the wait starts when the person reaches for the shortcut (`reachForShortcut`), so
   * entering the step, reading it, thinking and typing never bring the nudge.
   */
  private listenForPress(session: SetupSession): void {
    this.stopPressTest(session);
    const taken = this.host.takenShortcuts().find((notice) => notice.key === "dictate");
    if (taken) this.host.noticed.add(taken.accelerator);
  }

  /**
   * Record a thought's shortcut changed (`changeApp`), wherever it was set: on the first-thought step itself, or in
   * Settings → Voice, where the step's Open Settings leads. While that step shows, its press test starts over.
   */
  shortcutChanged(): void {
    if (this.session?.step === "think") this.listenForPress(this.session);
  }

  /**
   * Record a thought's first modifier (reachKey: ⌥ for ⌥Space) went down in the setup window, outside the box for a
   * typed thought, where it types a character: the person reaches for the shortcut. On the first-thought step, while a
   * press would be setup's and none has been heard or missed, the press test waits PRESS_WAIT_MS for one from now, a
   * wait under way included (`noPressArrived`). Not while macOS is about to ask about the microphone or the words are
   * being made, when no press is asked for, nor for a shortcut another app holds, which the step names already.
   */
  reachForShortcut(): void {
    const session = this.session;
    if (!session || !this.takesPress() || session.heard || session.silent) return;
    const { kind } = session.thought;
    if (kind === "primer" || kind === "transcribing" || this.host.takenShortcuts().some((notice) => notice.key === "dictate")) return;
    if (session.pressTimer) clearTimeout(session.pressTimer);
    const timer: NodeJS.Timeout = setTimeout(() => void this.noPressArrived(session, timer), PRESS_WAIT_MS);
    session.pressTimer = timer;
  }

  /**
   * The person reached for the shortcut, and no press arrived within the wait: the shortcut may be another app's, though
   * it registered. The step says so, naming the running app whose default it is, with free ones to use instead. A
   * press, another shortcut or step, or the window closing while the running apps are read ends this wait first
   * (`stopPressTest`), and it says nothing; so does another reach, which waits afresh.
   */
  private async noPressArrived(session: SetupSession, timer: NodeJS.Timeout): Promise<void> {
    const running = await runningAppNames();
    if (session.pressTimer !== timer) return;
    session.pressTimer = null;
    const shortcuts = this.host.settings().shortcuts;
    session.silent = true;
    session.holder = likelyHolder(shortcuts.dictate, running);
    session.alternatives = freeAlternatives("dictate", shortcuts, this.host.shortcutApi());
    this.host.broadcast();
  }

  /** The press test stops: no wait goes on, and nothing is heard or missed. The first-thought step starts it again. */
  private stopPressTest(session: SetupSession): void {
    if (session.pressTimer) clearTimeout(session.pressTimer);
    session.pressTimer = null;
    session.heard = false;
    session.silent = false;
    session.holder = null;
    session.alternatives = [];
  }

  /**
   * Use {shortcut}, on the first-thought step's Notice of a taken or silent shortcut: `accelerator` becomes Record a
   * thought's shortcut, the way the capsule's Use sets one. Changing it starts the step's press test over (changeApp),
   * so the window never shows the new shortcut beside what the old one's test found. Only on that step, and only for a
   * shortcut its Notice offers: anything else is ignored.
   */
  async useSetupShortcut(accelerator: unknown): Promise<SetupSnapshot> {
    const offered = this.session?.step === "think" ? this.setupPressState().alternatives : [];
    if (typeof accelerator === "string" && offered.includes(accelerator)) await this.host.useShortcut("dictate", accelerator);
    return this.snapshot();
  }

  /**
   * File it, on the first-thought step's typing rows: the words become a capture in the inbox, which setup files
   * (`takeThought`). It never throws: a capture that can't be written is the session's `typeProblem`, which the step
   * shows under the box, and each try clears the last one. Only the first-thought step takes a thought, and only words:
   * anything else, empty words included, is ignored (File it waits for words).
   */
  typeSetupThought(words: unknown): SetupSnapshot {
    const session = this.session;
    const trimmed = typeof words === "string" ? words.trim() : "";
    if (session?.step !== "think" || !trimmed) return this.snapshot();
    session.typeProblem = null;
    let capture: Capture;
    try {
      capture = this.host.newCapture(trimmed, { source: "text", now: new Date() });
    } catch (error) {
      session.typeProblem = errorMessage(error);
      this.host.broadcast();
      return this.snapshot();
    }
    this.takeThought(capture.path, trimmed, null);
    return this.snapshot();
  }

  /**
   * The first thought's words exist, as the capture at `capturePath`: the window shows its filing from now on (entered as
   * any step is, so what hangs on entering one runs). It files as any filing does, in queue order and in `withRun`, but
   * no Edit reaches it: it is never the capsule's `job`. While the window shows it, `runFiling` reports to it; once the
   * window has closed, by notification. The spoken thought has been handed over: it waits again. The capsule is left as
   * it is: a recording started meanwhile, on Filing say, keeps its card.
   */
  private takeThought(capturePath: string, words: string, transcribedIn: number | null): void {
    const session = this.session;
    if (!session) return;
    session.thought = { kind: "waiting" };
    session.testCapture = null;
    this.enterSetupStep("filing");
    const now = Date.now();
    const job: FilingJob = {
      capturePath,
      text: words,
      transcribedIn,
      agent: this.host.agentName(),
      harness: this.libraryHarness() ?? "auto",
      abort: new AbortController(),
      edited: false,
      rows: [],
      written: [],
      startedAt: now,
      stepAt: now,
      setup: true,
    };
    session.job = job;
    session.filing = { kind: "running", words, agent: job.agent, startedAt: now, waiting: false, cancelling: false, rows: job.rows, written: job.written };
    this.host.queuedToFile.add(capturePath);
    this.host.file(job);
    this.host.broadcast();
  }

  /**
   * Cancel, while the first thought is filed: its run stops at once, and once that run is over (queue order), what it did
   * is taken back. Then the filing is cancelled, its words back in the inbox; `partial` says that what the run did stays
   * as its own commit, because taking it back failed, and `leftovers` how many files it changed that no commit holds (a
   * library without git, or with automatic commits off), which stay as they are. Except a run that had filed when Cancel came,
   * with no commit to take back (`afterStop`): it stands, and the window already shows it filed (`filed`), which stays.
   */
  cancelSetupFiling(): void {
    const session = this.session;
    const job = session?.job;
    if (!session || !job || job.cancelled || session.filing?.kind !== "running") return;
    job.cancelled = true;
    job.abort.abort();
    session.filing = { ...session.filing, cancelling: true };
    this.host.broadcast();
    void this.host.enqueue(async () => {
      if (afterStop(job.outcome) === "filed") return; // filed and standing: nothing to take back, and the window says so already
      const problem = await this.host.takeBack(job);
      if (this.session !== session || session.job !== job) return; // the window has closed: there is nothing to tell
      session.filing = { kind: "cancelled", words: job.text, agent: job.agent, partial: problem !== null, leftovers: unrecordedEdits(job.outcome) };
      this.host.broadcast();
    });
  }

  /**
   * File it again, or Try again: once the first thought's filing has stopped short or been taken back (any state but
   * running and filed), the same capture is filed in a new run.
   */
  fileSetupAgain(): void {
    const job = this.session?.job;
    const kind = this.session?.filing?.kind;
    if (!job || kind === undefined || kind === "running" || kind === "filed") return;
    this.takeThought(job.capturePath, job.text, job.transcribedIn);
  }

  /**
   * Undo, or ⌘Z, once the first thought is filed: its commit is taken back in queue order, as the capsule's Undo does
   * (`revertFiling`), which puts the words back in the inbox. Then the filing is undone, or, when git refused (or the
   * revert failed), still filed with `undoRefused`, and nothing offers to undo it again. One undo at a time: while one
   * runs, another press does nothing.
   */
  async undoSetupFiling(): Promise<void> {
    const session = this.session;
    const job = session?.job;
    const filing = session?.filing;
    const commit = job?.outcome?.commit;
    if (!session || !job || !commit || filing?.kind !== "filed" || !filing.canUndo || filing.undoing || filing.undoRefused) return;
    this.host.firstRun.undid(); // Undo was used, whether git takes the filing back or refuses
    session.filing = { ...filing, undoing: true };
    this.host.broadcast();
    const undone = await this.host.revert(commit).catch(() => false);
    if (this.session !== session || session.job !== job) return; // the window has closed: there is nothing to tell
    session.filing = undone ? { kind: "undone", words: job.text } : { ...filing, undoing: false, undoRefused: true };
    this.host.broadcast();
  }

  /** `job` is the first thought's filing, and the setup window shows it: the filing reports to the window (`runFiling`). */
  owns(job: FilingJob): boolean {
    return this.session?.job === job;
  }

  /**
   * `job`'s run waits for the library (another run has it), or its own run has started (`filingProgress`): the window
   * shows the wait until the run starts, and its working line then counts from that start.
   */
  waiting(job: FilingJob, waiting: boolean): void {
    const session = this.session;
    if (session?.job === job && session.filing?.kind === "running") {
      session.filing = { ...session.filing, waiting, ...(waiting ? {} : { startedAt: Date.now() }) };
      this.host.broadcast();
    }
  }

  /**
   * `job`, the first thought's filing, has taken another step, and its `rows` and `written` have it (`filingStep`): the
   * setup window is sent them, at most once every STEP_MS (`sendSteps`). A step that comes sooner after the last send waits,
   * and the steps that come meanwhile go in the one send that ends the wait, so the window is never more than STEP_MS behind.
   * Another filing's wait is dropped: the window no longer shows that filing.
   */
  stepped(job: FilingJob): void {
    if (!this.showsRunning(job)) return;
    if (this.steppedJob !== job) this.sendSteps.cancel();
    this.steppedJob = job;
    this.sendSteps();
  }

  /** The setup window shows `job`'s filing, and it is running. */
  private showsRunning(job: FilingJob): boolean {
    const session = this.session;
    return session?.job === job && session.filing?.kind === "running" && !session.window.isDestroyed();
  }

  /**
   * The setup window's filing is filed: its pages, new ones first, and how long the agent took, as the window's working
   * line counted it.
   */
  filed(job: FilingJob, outcome: FileOutcome, pages: FiledPage[]): void {
    const session = this.session;
    if (session?.job !== job) return;
    const startedAt = session.filing?.kind === "running" ? session.filing.startedAt : Date.now();
    session.filing = {
      kind: "filed",
      words: job.text,
      agent: job.agent,
      seconds: (Date.now() - startedAt) / 1000,
      pages,
      created: pages.filter((page) => outcome.changes.created.includes(page.path)).length,
      canUndo: !!outcome.commit,
      undoing: false,
      undoRefused: false,
    };
    this.host.broadcast();
  }

  /**
   * The setup window's filing failed. `failure` says why, and the window tells it in the capsule's words, with "try again"
   * where the capsule promises a wait, since setup starts neither a wait nor a watch; `partial`: what the run left behind in the
   * library. `failure` is null when the note left the inbox before any run: no agent failed, and the window has a line of its
   * own for it (NOTE_GONE). The capture stays put.
   */
  failed(job: FilingJob, failure: AgentFailure | null, partial: PartialEdits): void {
    const session = this.session;
    if (session?.job !== job) return;
    session.filing = { kind: "failed", words: job.text, agent: job.agent, line: failure ? failure.line : NOTE_GONE, failure, partial };
    this.host.broadcast();
  }

  /** The harness the library files with, by name ("claude"); null when its settings don't say. */
  private libraryHarness(): string | null {
    try {
      const vault = this.host.vault();
      return vault ? selectHarness(loadSettings(vault.root)).name : null;
    } catch {
      return null;
    }
  }

  /**
   * The suggestion, or Return in Ask your library, on the Ask step: the library's agent answers `question` as the Ask
   * window's does (`answerQuestion`), one question at a time. While it waits for the library, the step says so; its
   * seconds count from when the agent starts to look. Then the answer and the pages its [[links]] name, or the line that
   * says why it failed. A result that comes after Skip, or after the window has closed, is dropped. Only the Ask step
   * asks, and only a question in words: anything else is ignored.
   */
  async askInSetup(question: unknown): Promise<SetupSnapshot> {
    const session = this.session;
    const asked = typeof question === "string" ? question.trim() : "";
    if (session?.step !== "ask" || !asked || session.askAbort) return this.snapshot();
    const abort = new AbortController();
    session.askAbort = abort;
    session.answer = { kind: "asking", question: asked, startedAt: Date.now(), waiting: false };
    this.host.broadcast();
    // Still this window's question: not skipped, and its window still open.
    const ours = () => this.session === session && session.askAbort === abort;
    const progress = (message: string) => {
      const answer = session.answer;
      const waiting = message === WAITING;
      if (!ours() || answer?.kind !== "asking" || answer.waiting === waiting) return;
      session.answer = { ...answer, waiting, ...(waiting ? {} : { startedAt: Date.now() }) };
      this.host.broadcast();
    };
    const result = await this.host.answer(asked, abort, progress);
    if (!ours()) return this.snapshot();
    session.askAbort = null;
    session.answer = result.ok
      ? { kind: "answered", question: asked, ...answeredFrom(this.host.vault()?.root ?? null, result.text) }
      : { kind: "failed", question: asked, agent: result.agent, line: errorLine(result.text), failure: result.failure, changedFiles: result.changedFiles };
    this.host.broadcast();
    return this.snapshot();
  }

  /** Skip, on the Ask step: the question being answered is given up, its agent stopped, and the answer cleared. */
  skipSetupAsk(): void {
    const session = this.session;
    if (!session) return;
    session.askAbort?.abort();
    session.askAbort = null;
    session.answer = null;
    this.host.broadcast();
  }

  /**
   * Start using Avanzel, on the last step: setup ends, once, and Avanzel waits in the menu bar, where Record a thought
   * is now. Only the last step finishes setup. That is noted (`firstRun`) before the window goes, so its closing, even
   * during the flight, isn't noted as a close in the middle of setup (`end`).
   *
   * The window, whose page now shows Zel alone in its middle, flies onto a 24 px square on the menu bar icon
   * (flightTarget): macOS animates its frame, holding this thread until it lands, and the window closes the moment it
   * has. Closing it ends the session. Then Zel's bubble says it's up there (openUpHere). Under Reduce Motion the window
   * just closes. So it does when the icon is hidden, and there is no bubble, since there is nothing to point at:
   * opening Avanzel again finds it (`showHome`). A window closed during the flight, or by quitting, gets no bubble
   * either. Whatever goes wrong in the flight, the window still closes: the person pressed Start using Avanzel.
   */
  finish(): void {
    const session = this.session;
    if (session?.step !== "done" || session.finished || session.window.isDestroyed()) return;
    session.finished = true;
    this.host.firstRun.finished(new Date());
    const win = session.window;
    let icon: Box | null = null;
    try {
      const tray = this.host.trayBounds();
      const target = flightTarget(tray);
      if (target) icon = tray;
      if (target && !systemPreferences.getAnimationSettings().prefersReducedMotion) {
        win.setWindowButtonVisibility(false);
        win.setBounds(target, true); // returns once it has landed
      }
    } catch (error) {
      console.error("the flight into the menu bar", error);
    } finally {
      if (!win.isDestroyed()) {
        // Once the window has gone, so the bubble takes the focus from nothing on its way out.
        const at = icon;
        if (at) win.once("closed", () => this.openUpHere(at));
        win.close();
      }
    }
  }

  /**
   * Zel's bubble, once the setup window has gone into the menu bar icon at `tray`: on the icon's display, its tail
   * under the icon (upHerePlace). Like Quick, it takes focus, and a click elsewhere puts it away. Nothing brings it back.
   * None opens once Avanzel is quitting (its agent checks have stopped then, busy or not).
   */
  private openUpHere(tray: Box): void {
    if (this.host.quitting() || this.host.checksStopped()) return;
    this.closeUpHere();
    const win = createUpHereWindow();
    this.upHereWindow = win;
    this.host.refreshTray(); // no title beside the icon the bubble points at: it would widen the bounds the bubble centres on
    const { x, y } = upHerePlace(tray, screen.getDisplayMatching(tray).workArea, UP_HERE_SIZE);
    win.setPosition(x, y);
    app.focus({ steal: true });
    win.show();
    win.focus();
    win.on("blur", () => {
      if (this.upHereWindow === win) this.closeUpHere();
    });
  }

  /**
   * What Zel's bubble says: the shortcuts to talk and to type, whether Avanzel can hear yet (`hears`), and the speech
   * model, which says why not.
   */
  upHereSnapshot(): UpHereSnapshot {
    return { shortcut: this.host.settings().shortcuts.dictate, typeShortcut: this.typeShortcut(), hears: this.host.hears(), model: this.host.model() };
  }

  /**
   * Type a thought's shortcut while it works, for setup's last step and the bubble to teach; null when it didn't
   * register (another app holds it, or another action has it), when they point to the menu bar's Type a thought….
   */
  private typeShortcut(): string | null {
    const { type } = this.host.settings().shortcuts;
    return type && !this.host.shortcutProblems().type ? type : null;
  }

  /** Try it now, in the bubble: it goes, and Record a thought starts, as its shortcut would start it. */
  tryItNow(): void {
    this.closeUpHere();
    void this.host.toggleDictate();
  }

  /** Type a thought, in the bubble while Avanzel can't hear yet: it goes, and Quick opens for the thought. */
  typeFromUpHere(): void {
    this.closeUpHere();
    this.host.openQuick();
  }

  /** Not now, Esc or a click elsewhere: the bubble goes, for good. */
  closeUpHere(): void {
    const win = this.upHereWindow;
    this.upHereWindow = null;
    if (win && !win.isDestroyed()) win.close();
    if (win) this.host.refreshTray(); // the icon's title may come back
  }

  /** The step the session is on, or null without one: for tests of steps whose body a later change builds. */
  stepForTests(): SetupStep | null {
    return this.session?.step ?? null;
  }
}
