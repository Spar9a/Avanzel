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
  downloadModel,
  ensureDefaultTasks,
  formatSchedule,
  harnesses as listHarnesses,
  lastDue,
  loadSettings,
  loadTasksReport,
  locateModel,
  makeTranscriber,
  nextRun,
  parseSchedule,
  readWav,
  resampleLinear,
  rememberVault,
  saveSettings,
  saveTask,
  selectHarness,
  writeWav,
  type Capture,
  type FileOutcome,
  type Settings,
  type ShadowTask,
  type Transcriber,
  type VoiceSettings,
} from "@avanzel/engine";
import type {
  AppSettings,
  AskResult,
  CapsuleMode,
  CapsuleState,
  FiledPage,
  ModelStatus,
  ScreenContext,
  SettingsSnapshot,
  Shortcuts,
  TaskInfo,
} from "../shared/ipc.ts";
import { frontContext } from "./front-app.ts";
import { captureMeta, filedPages, findPage, obsidianUrl, pageInfo, recentFromLog } from "./library-info.ts";
import { buildMenuModel, type MenuInput, type MenuItemModel } from "./menu-model.ts";
import { openPrivacyPane, permissionStatus, requestMicrophone } from "./permissions.ts";
import { RunStateStore } from "./run-state.ts";
import { dueTasks, markChecked, markRan, type RunState } from "./schedule.ts";
import { captureDisplay, looksBlank } from "./screenshot.ts";
import { prettyAccelerator, registerShortcuts } from "./shortcuts.ts";
import { SettingsStore } from "./store.ts";
import { MenuBar } from "./tray.ts";
import {
  createAskWindow,
  createCapsuleWindow,
  createQuickWindow,
  createSettingsWindow,
  placeCapsule,
  placeQuick,
} from "./windows.ts";

const MODEL_ID = "nemo-parakeet-tdt-0.6b-v3";
// Quitting waits at most this long for stopped agent runs to finish their bookkeeping.
const QUIT_WAIT_MS = 10_000;
// How long a stopped recording's audio may take to arrive from the capsule (tests shorten it).
const AUDIO_TIMEOUT_MS = (process.env.AVANZEL_TEST === "1" && Number(process.env.AVANZEL_AUDIO_TIMEOUT_MS)) || 15_000;
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
  outcome?: FileOutcome;
  pages?: FiledPage[];
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const lastLines = (text: string, n = 3) => text.trim().split("\n").filter(Boolean).slice(-n).join("\n");

export class Controller {
  private readonly store: SettingsStore;
  private readonly modelsDir: string;
  private vault: Vault | null = null;
  private capsule!: BrowserWindow;
  private settingsWindow: BrowserWindow | null = null;
  private quickWindow: BrowserWindow | null = null;
  private askWindow: BrowserWindow | null = null;
  private menuBar!: MenuBar;
  private capsuleState: CapsuleState = { kind: "hidden" };
  private recording: Recording | null = null;
  private job: FilingJob | null = null;
  private hideTimer: NodeJS.Timeout | null = null;
  private keepOpen = false;
  private queue: Promise<unknown> = Promise.resolve();
  /** Work in the queue that hasn't finished. */
  private queued = 0;
  /** Every agent run going on, by the controller that stops it. */
  private runs = new Map<AbortController, Promise<unknown>>();
  private quitting = false;
  private transcriber: Transcriber | null = null;
  private transcriberKey = "";
  private model: ModelStatus = { kind: "missing" };
  private libraryProblem: string | null = null;
  private readonly runState: RunStateStore;
  private shortcutProblems: Partial<Record<keyof Shortcuts, string>> = {};
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
    this.applyShortcuts();
    await this.refreshModelStatus();
    this.refreshMenu();
    setInterval(() => this.tick(), 60_000);
    powerMonitor.on("resume", () => this.tick());
    powerMonitor.on("unlock-screen", () => this.tick());
    this.tick();
    if (!this.vault) this.showSettings();
  }

  /** Whether quitting now would cut an agent run, or work queued behind one, short. */
  busy(): boolean {
    return this.runs.size > 0 || this.queued > 0;
  }

  /**
   * Before quitting: stop every agent run, then wait (at most QUIT_WAIT_MS) while the engine does
   * its bookkeeping: protected files put back, what a run left committed, the capture kept in the
   * inbox. Nothing new starts meanwhile.
   */
  async stopForQuit(): Promise<void> {
    this.quitting = true;
    for (const abort of this.runs.keys()) abort.abort();
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise<void>((resolve) => (timer = setTimeout(resolve, QUIT_WAIT_MS)));
    await Promise.race([Promise.allSettled([this.queue, ...this.runs.values()]), waited]);
    clearTimeout(timer);
  }

  /** What goes wrong opening it is kept in `libraryProblem`, which the menu and Settings show. */
  private openLibrary(libraryPath: string | null): void {
    this.vault = null;
    this.recent = [];
    this.transcriber = null;
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
      this.transcriber = await makeTranscriber(voice, this.modelsDir).catch((error: unknown): Transcriber => ({
        engine: "none",
        transcribe: () => Promise.reject(error),
      }));
      this.transcriberKey = key;
    }
    return this.transcriber;
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

  private applyShortcuts(): void {
    this.shortcutProblems = registerShortcuts(
      this.store.get().shortcuts,
      {
        dictate: () => void this.toggleDictate(),
        capture: () => void this.toggleCapture(),
        type: () => this.openQuick(),
        ask: () => this.openAsk(),
      },
      globalShortcut,
    );
  }

  private async menuAction(action: string): Promise<void> {
    if (action === "dictate") return this.toggleDictate();
    if (action === "capture") return this.toggleCapture();
    if (action === "type") return this.openQuick();
    if (action === "ask") return this.openAsk();
    if (action === "settings") return this.showSettings();
    if (action === "open-library") return this.openLibraryFolder();
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

  /** Library, speech model and microphone must all be ready; explains what's missing otherwise. */
  private async readyToListen(): Promise<boolean> {
    if (!this.vault) {
      this.showSettings();
      this.fail("Set up your library first", "Choose or create a library folder in Avanzel Settings → General.", "open-settings");
      return false;
    }
    if (!process.env.AVANZEL_FAKE_TRANSCRIPT && this.model.kind !== "ready") {
      if (this.model.kind === "missing" || this.model.kind === "error") void this.downloadModel();
      const progress = this.model.kind === "downloading" && this.model.totalBytes
        ? ` (${Math.round((100 * this.model.receivedBytes) / this.model.totalBytes)}%)` : "";
      this.fail(`Downloading the speech model${progress}`, "Parakeet runs on this Mac and is downloaded once (670 MB). Avanzel can listen as soon as it's ready.", "open-settings");
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
      this.fail("The recording didn't arrive", "Try again; if it keeps happening, check the microphone in Settings → Voice.");
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
      const samples = process.env.AVANZEL_FAKE_AUDIO ? this.fakeAudio(process.env.AVANZEL_FAKE_AUDIO) : received;
      const audioPath = vault.newAudioPath(now);
      let text = "";
      let engine = "";
      let seconds: number | null = null;
      if (samples.length >= 16000 * 0.3) {
        writeWav(audioPath, samples, 16000);
        const started = performance.now();
        const transcript = await this.transcribe(samples);
        seconds = (performance.now() - started) / 1000;
        text = transcript.text.trim();
        engine = transcript.engine;
      }
      if (!text) rmSync(audioPath, { force: true });

      if (recording.mode === "comment" && recording.shot) {
        (await this.librarian()).captureScreen({
          image: recording.shot.path,
          comment: text,
          ...(text ? { audio: audioPath, transcriber: engine } : {}),
          context: recording.shot.context,
        });
        this.setCapsule(
          { kind: "saved", text, thumbnail: recording.shot.thumbnail, context: recording.shot.context, note: "Saved to your inbox for tonight's review" },
          5000,
        );
        return;
      }
      if (!text) {
        return this.fail("No speech recognized", "If you did speak, check the microphone in Settings → Voice.");
      }
      const capture = vault.newCapture(text, { source: "voice", audio: audioPath, transcriber: engine, now });
      this.afterCapture(capture.path, text, seconds);
    } catch (error) {
      this.fail(error instanceof AvanzelError ? error.message : "Couldn't transcribe that", error instanceof AvanzelError ? undefined : errorMessage(error));
    }
  }

  private fakeAudio(file: string): Float32Array {
    const wav = readWav(file);
    return wav.sampleRate === 16000 ? wav.samples : resampleLinear(wav.samples, wav.sampleRate, 16000);
  }

  private async transcribe(samples: Float32Array): Promise<{ text: string; engine: string }> {
    const fake = process.env.AVANZEL_FAKE_TRANSCRIPT;
    if (fake !== undefined) return { text: fake, engine: "fake" };
    const transcriber = await this.transcriberFor(loadSettings(this.requireVault().root).voice);
    return transcriber.transcribe(samples, 16000);
  }

  // ---------------------------------------------------------------- filing

  private afterCapture(capturePath: string, text: string, transcribedIn: number | null): void {
    if (this.store.get().fileMode === "evening") {
      this.setCapsule({ kind: "saved", text, note: "Saved to your inbox for tonight's review" }, 4000);
      return;
    }
    this.beginFiling({ capturePath, text, transcribedIn, agent: this.agentName(), abort: new AbortController(), edited: false });
  }

  /** Filing starts right away; Edit can stop it until it ends. */
  private beginFiling(job: FilingJob): void {
    this.showFiling(job);
    void this.enqueue(() => this.runFiling(job));
  }

  private showFiling(job: FilingJob): void {
    this.job = job;
    this.setCapsule({ kind: "filing", text: job.text, agent: job.agent, transcribedIn: job.transcribedIn, canEdit: true });
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
    if (job.abort.signal.aborted) return; // Edit stopped it before its turn came
    if (!existsSync(job.capturePath)) {
      // Already filed meanwhile (e.g. by the evening review); nothing left to do.
      if (this.job === job && this.capsuleState.kind === "filing") this.setCapsule({ kind: "hidden" });
      return;
    }
    const started = performance.now();
    let outcome: FileOutcome | undefined;
    try {
      [outcome] = await this.withRun(async (signal) => (await this.librarian()).file([job.capturePath], { signal }), job.abort);
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

  private filingFailed(job: FilingJob, error: string, outcome?: FileOutcome): void {
    const where = outcome?.savedOriginal
      ? `Your words are kept in ${outcome.savedOriginal}; the inbox now holds the agent's version.`
      : "The note is still in your inbox; the evening review will try again.";
    const partial = outcome?.commit ? ` ${job.agent}'s partial edits are kept as their own commit in the library's history.` : "";
    const detail = `${lastLines(error)}\n${where}${partial}`;
    if (this.job === job && this.capsuleState.kind === "filing") this.fail(`${job.agent} couldn't file this note`, detail);
    else this.notify("A note couldn't be filed", lastLines(error, 1));
    this.refreshMenu();
  }

  /** Stops the agent at once and shows the words; Submit or Cancel then takes back what it did (`refile`). */
  edit(): void {
    const job = this.job;
    if (!job || job.edited || this.capsuleState.kind !== "filing") return;
    job.edited = true;
    job.abort.abort();
    this.setCapsule({ kind: "editing", text: job.text });
  }

  submitEdit(text: string): void {
    const job = this.job;
    if (!job || this.capsuleState.kind !== "editing") return;
    const words = text.trim();
    if (!words) return this.cancelEdit();
    this.refile(job, words);
  }

  cancelEdit(): void {
    const job = this.job;
    if (!job || this.capsuleState.kind !== "editing") return;
    this.refile(job, null);
  }

  /**
   * After Edit: once the stopped run is over (queue order), undo the commit it made (its leftovers,
   * or its filing if it finished first), then file the corrected `words` as a fresh capture, or
   * (null) the capture as it was.
   */
  private refile(job: FilingJob, words: string | null): void {
    const next: FilingJob = {
      capturePath: job.capturePath,
      text: words ?? job.text,
      transcribedIn: job.transcribedIn,
      agent: job.agent,
      abort: new AbortController(),
      edited: false,
    };
    this.showFiling(next);
    void this.enqueue(async () => {
      const problem = await this.takeBack(job); // first: undoing a finished filing puts the misheard capture back in the inbox
      try {
        next.capturePath = words === null ? job.capturePath : this.recapture(job, words);
      } catch (error) {
        return this.filingFailed(next, errorMessage(error));
      }
      if (problem === null) return this.runFiling(next);
      if (this.job === next && this.capsuleState.kind === "filing") {
        const waiting = existsSync(next.capturePath) ? " The note waits in your inbox for the evening review." : "";
        this.fail("Couldn't take back the agent's first try", `${problem}${waiting}`);
      }
    });
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
    const inInbox = existsSync(old);
    // Filed meanwhile, it is in raw/: read what to keep from there, and leave it be.
    const source = [old, vault.archivePath(old)].find((file) => existsSync(file));
    const meta = source ? captureMeta(source) : { source: "text" };
    const aside = path.join(path.dirname(old), `.${path.basename(old)}.editing`);
    if (inInbox) renameSync(old, aside);
    try {
      const fresh = vault.newCapture(words, {
        source: meta.source,
        audio: meta.audio ? path.join(vault.root, meta.audio) : null,
        transcriber: meta.transcriber ?? null,
        now: meta.created ?? new Date(),
      });
      if (inInbox) rmSync(aside, { force: true });
      return fresh.path;
    } catch (error) {
      if (inInbox) renameSync(aside, old);
      throw error;
    }
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
    else this.showSettings();
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
    if (!this.vault) return this.showSettings();
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
    if (!this.vault) return this.showSettings();
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
    try {
      const outcome = await this.withRun(async (signal) => (await this.librarian()).ask(question, { save: false, signal }));
      const seconds = (performance.now() - started) / 1000;
      return outcome.result.ok
        ? { ok: true, answer: outcome.result.output, agent, seconds }
        : { ok: false, answer: `${agent} couldn't answer:\n${lastLines(outcome.result.stderr || outcome.result.output)}`, agent, seconds };
    } catch (error) {
      return { ok: false, answer: errorMessage(error), agent, seconds: (performance.now() - started) / 1000 };
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
    if (!vault) return this.showSettings();
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

  showSettings(): void {
    if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
      this.settingsWindow = createSettingsWindow();
      this.settingsWindow.once("ready-to-show", () => this.settingsWindow?.show());
    }
    app.focus({ steal: true });
    this.settingsWindow.show();
    this.settingsWindow.focus();
  }

  private broadcast(): void {
    const win = this.settingsWindow;
    if (win && !win.isDestroyed()) win.webContents.send("settings:changed", this.snapshot());
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
      harnesses: Object.values(all).map((h) => ({ name: h.name, available: h.available(), experimental: h.experimental })),
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
      obsidian: this.obsidianInstalled(),
    };
  }

  setApp(patch: Partial<AppSettings>): SettingsSnapshot {
    const before = this.store.get();
    const after = this.store.update(patch);
    if (JSON.stringify(before.shortcuts) !== JSON.stringify(after.shortcuts)) this.applyShortcuts();
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

  private useLibrary(target: string): SettingsSnapshot {
    this.store.update({ libraryPath: target });
    this.openLibrary(target);
    try {
      rememberVault(target);
    } catch (error) {
      console.error("remember vault", error);
    }
    this.broadcast();
    return this.snapshot();
  }

  // ---------------------------------------------------------------- speech model

  private async refreshModelStatus(): Promise<void> {
    if (this.model.kind === "downloading") return;
    const dir = locateModel(MODEL_ID, this.modelsDir);
    this.model = dir ? { kind: "ready", dir } : { kind: "missing" };
  }

  async downloadModel(): Promise<SettingsSnapshot> {
    if (this.model.kind === "downloading" || this.model.kind === "ready") return this.snapshot();
    this.model = { kind: "downloading", receivedBytes: 0, totalBytes: 0 };
    this.broadcast();
    let lastBroadcast = 0;
    void downloadModel(MODEL_ID, this.modelsDir, {
      onProgress: (p) => {
        this.model = { kind: "downloading", receivedBytes: p.overallReceived, totalBytes: p.overallTotal ?? 0 };
        if (Date.now() - lastBroadcast > 250) {
          lastBroadcast = Date.now();
          this.broadcast();
        }
      },
    })
      .then((dir) => {
        this.model = { kind: "ready", dir };
        this.transcriber = null;
        this.notify("Avanzel is ready to listen", "The speech model is downloaded. Press the shortcut and start talking.");
      })
      .catch((error) => {
        this.model = { kind: "error", message: errorMessage(error) };
      })
      .finally(() => this.broadcast());
    return this.snapshot();
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
    for (const id of due) void this.runTask(id, true);
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

  /** Run a shadow task now: by hand (the menu, Run now), or because it is due (`scheduled`). */
  async runTask(id: string, scheduled = false): Promise<SettingsSnapshot> {
    const vault = this.vault;
    if (!vault || this.running.has(id)) return this.snapshot();
    const task = this.safeTasks(vault).find((t) => t.id === id);
    if (!task) return this.snapshot();
    this.writeRunState(vault, markRan(this.readRunState(vault), id, new Date()));
    this.running.add(id);
    this.broadcast();
    void this.enqueue(() => this.executeTask(task, scheduled)).finally(() => {
      this.running.delete(id);
      this.recent = this.vault ? recentFromLog(this.vault.root) : [];
      this.broadcast();
    });
    return this.snapshot();
  }

  private async executeTask(task: ShadowTask, scheduled: boolean): Promise<void> {
    const agent = this.agentName(task.agent);
    try {
      if (task.kind === "evening-review") {
        const result = await this.withRun(async (signal) =>
          (await this.librarian(task.agent)).eveningReview({ instructions: task.instructions, signal }));
        const filed = result.outcomes.filter((o) => o.ok).length;
        if (!result.outcomes.length) {
          if (!scheduled) this.notify(task.name, "Inbox was empty.");
          return;
        }
        this.lastEveningCommits = result.commits;
        const failed = result.outcomes.length - filed;
        const digest = result.digestPath;
        this.notify(
          `${task.name}: ${filed} ${filed === 1 ? "thing" : "things"} filed`,
          failed ? `${failed} couldn't be filed and are still in the inbox.` : `${agent} sorted today's inbox. Click to read the summary.`,
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

  menuForTests(): MenuItemModel[] {
    return buildMenuModel(this.menuInput(), new Date());
  }
}
