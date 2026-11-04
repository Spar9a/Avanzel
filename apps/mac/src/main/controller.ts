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
  type WebContents,
} from "electron";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  git,
  harnesses as listHarnesses,
  idStamp,
  installHook,
  lastDue,
  loadSettings,
  loadTasksReport,
  localDate,
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
  type Transcript,
  type VoiceOptions,
  type VoiceSettings,
} from "@avanzel/engine";
import { DAY_FILE_NOT_UPDATED, isSettingsPane, noSuchReview, type DeleteDictationResult, type DictationList } from "../shared/ipc.ts";
import {
  ANOTHER_LIBRARY,
  avanzelFailure,
  commentNotStartedProblem,
  copyPromptProblem,
  correctedWordsProblem,
  filingProblem,
  linkedPageNotice,
  NO_GIT_LINE,
  ownLine,
  recordingLost,
  screenCaptureProblem,
  stopFailedProblem,
  stopRefused,
  stoppedNotice,
  takeBackRefused,
  takeBackRefusedProblem,
  thoughtNotSavedProblem,
  tooBroadLine,
  undoRefused,
  unheardProblem,
  unsavedProblem,
  voiceSettingsProblem,
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
  AskSnapshot,
  CapsuleCommand,
  CapsuleMode,
  CapsuleState,
  CardAction,
  FiledPage,
  LibraryPatch,
  ModelStatus,
  RecordingProblem,
  SaveResult,
  ScreenContext,
  SettingsPane,
  SettingsSnapshot,
  SetupSnapshot,
  SetupStep,
  Shortcuts,
  TaskInfo,
} from "../shared/ipc.ts";
import { callAppLabel, runningCallApps, type CallApp } from "./call-apps.ts";
import { CALL_CONSENT_DIALOG, CALL_KEPT_LINE, CallNotes, MAX_CALL_MS, type CallHost } from "./call-notes.ts";
import { CallTap } from "./calltap.ts";
import { fakeCallTranscriber, fakeTranscript, patchedSettings } from "./dictionary-settings.ts";
import { TranscriberCache } from "./transcriber-cache.ts";
import { browserWindow, frontContext } from "./front-app.ts";
import { electronClipboard } from "./cursor-clipboard.ts";
import { COPY_PROMPT_MS, CursorDictation, type CursorHost } from "./cursor-dictation.ts";
import { CursorHelper, cursorPermissionsOf, type CursorPermissionState } from "./cursor-helper.ts";
import { DEFAULT_SKIP_APPS } from "./cursor-policy.ts";
import { DictationHistory, type DictationEntry } from "./dictation-history.ts";
import { deleteDictationResult, forgetDictation, pageOf, type ForgetHook, type Forgotten } from "./dictation-rows.ts";
import { moveInto, writeInto } from "./inbox-file.ts";
import { errorMessage, harnessName, lastLines, LIBRARY_PICKER, type Answered, type Correction, type FilingJob, type Recording } from "./jobs.ts";
import {
  answeredFrom,
  askLinks,
  captureMeta,
  captureWords,
  dictationInfo,
  filedPages,
  filedToday,
  findPage,
  obsidianUrl,
  pageAt,
  pageInfo,
  recentFromLog,
  savedPage,
} from "./library-info.ts";
import { forgetKept, logDictation } from "./library-log.ts";
import { buildMenuModel, reviewProgress, speechProblemOf, type MenuInput, type MenuItemModel } from "./menu-model.ts";
import { rowPage, stepThrottle, withStep, withWritten, type StepThrottle } from "./narration.ts";
import { openPrivacyPane, permissionStatus, requestMicrophone } from "./permissions.ts";
import { pickRequest, popupChoice, trayChoice } from "./popup.ts";
import { RunStateStore } from "./run-state.ts";
import { runningAppNames } from "./running-apps.ts";
import {
  DEFAULT_ESTIMATE_SECONDS,
  dueTasks,
  durationsOf,
  estimateSeconds,
  markChecked,
  markRan,
  resetMarginMs,
  reviewTime,
  savedNote,
  signInPollMs,
  signInWatchMs,
  splitWaits,
  timerDelay,
  undoneNote,
  withDuration,
  withWait,
  type RunState,
} from "./schedule.ts";
import { captureDisplay, looksBlank } from "./screenshot.ts";
import { Setup, type SetupHost } from "./setup.ts";
import { afterStop, defaultLibraryPath, suggestQuestions, tildePath, tooBroad, unrecordedEdits } from "./setup-model.ts";
import { freeAlternatives, likelyHolder, registerShortcuts, type ShortcutApi } from "./shortcuts.ts";
import { CaptureCount, FirstRunLog, NoticedShortcuts, SettingsStore } from "./store.ts";
import { openTerminal } from "./terminal.ts";
import { bringForward, showWhenReady, stealFocus } from "./stage.ts";
import { MenuBar } from "./tray.ts";
import { nextTrayWake, reviewEndedAt, sleepsAfterReview, trayView, wholePercent, type TrayInput, type TrayView } from "./tray-state.ts";
import { UndoRecordStore, type FilingReceipt } from "./undo-records.ts";
import {
  createAskWindow,
  createCapsuleWindow,
  createQuickWindow,
  createSettingsWindow,
  isPageOf,
  placeCapsule,
  placeQuick,
} from "./windows.ts";

/** A recording's words: its text, the engine that made it, and `heard`, what was recognised, when the dictionary corrected it. */
type Heard = Pick<Transcript, "text" | "engine" | "heard">;

// Quitting waits at most this long for stopped agent runs to finish their bookkeeping.
const QUIT_WAIT_MS = 10_000;
// How long a stopped recording's audio may take to arrive from the capsule (tests shorten it).
const AUDIO_TIMEOUT_MS = (process.env.AVANZEL_TEST === "1" && Number(process.env.AVANZEL_AUDIO_TIMEOUT_MS)) || 15_000;
// How long a transcription runs before the capsule's card turns slow and offers Stop (tests shorten it).
const TRANSCRIBE_STOP_MS = (process.env.AVANZEL_TEST === "1" && Number(process.env.AVANZEL_TRANSCRIBE_STOP_MS)) || 20_000;
// How long AVANZEL_FAKE_TRANSCRIPT, the stand-in for the speech model, takes to give its words: a test sets it to have one run long.
const FAKE_TRANSCRIPT_DELAY_MS = (process.env.AVANZEL_TEST === "1" && Number(process.env.AVANZEL_FAKE_TRANSCRIPT_DELAY_MS)) || 0;
// How long the download's progress stays in the capsule by itself; Settings → Voice keeps showing it (tests change it).
const PREPARING_SHOW_MS = (process.env.AVANZEL_TEST === "1" && Number(process.env.AVANZEL_PREPARING_SHOW_MS)) || 8_000;
// How long the capsule says that a shortcut picked on its notice works.
const PICKED_SHOW_MS = 3_000;
// How long the capsule says that the Undo shortcut found no filing to take back.
const NOTHING_TO_UNDO_MS = 3_000;
// How long the capsule shows a filed card by itself, a reprint of it (`showLastReceipt`) too; hovering over it keeps it longer.
const FILED_SHOW_MS = 8_000;
/**
 * The capsule shows nothing, or a card that is finished: a result or a notice that has nothing more to say, and no one's work in it. "Show
 * the last receipt" is offered over these alone, and replaces them (`showLastReceipt`), as does the bar that says there is no filing to
 * undo (`pressUndoShortcut`): over a problem with its fix, the editor or a capture, either would take the person's work or a problem's one
 * fix away. Ask `showsFinishedCard`, not the set: a Stopped card and a Saved card are in it by their kind, but are not finished when the
 * Stopped card says that the stopped run's edits stay, or the Saved card has a line about what became of its recording.
 */
const FINISHED_CARDS: ReadonlySet<CapsuleState["kind"]> = new Set<CapsuleState["kind"]>(["hidden", "filed", "saved", "cancelled", "recorded", "shortcut-picked", "nothing-to-undo"]);
// How long the capsule says that a filing or a transcription is stopped (hovering over it keeps it longer, as it does any card that
// hides itself).
const STOPPED_SHOW_MS = 6_000;
// How long after the pointer leaves what the capsule draws a card that hides itself is let go (`setKeepOpen`). The card and its bar are
// a few pixels apart, and crossing them is a leave and an enter.
const KEEP_OPEN_LET_GO_MS = 250;
// The listening card names the shortcut that finishes a recording until the library has kept this many recordings: the first ones
// teach the keys.
const HINT_CAPTURES = 10;
// How many characters of an agent's own line, or of a system error's message (Node's, the speech engine's), a problem of the
// capsule keeps in its card and in the notification of the same words: the card is a notice in a panel 300 px tall, and a
// notification shows a few lines, so a line that went on would push out the sentence that says what is safe, and the button.
// The windows don't clip, and tell the whole line.
const CAPSULE_LINE_MAX = 100;
// How long the menu bar's face wears the stamp of a filing that ended well (the filed face, §4.2).
const FILED_FACE_MS = 2_000;

/**
 * How much of `error`'s message a problem's card keeps: the whole of an AvanzelError, which Avanzel wrote for the person and which
 * says what to mend (a folder that is a link, a settings file that can't be read), and `CAPSULE_LINE_MAX` characters of any other,
 * which names paths and says little that a person can use.
 */
const reasonMax = (error: unknown): number | undefined => (error instanceof AvanzelError ? undefined : CAPSULE_LINE_MAX);

/** A recording that holds no words (too short to hold speech, or nothing said) leaves nothing, thought or question: its card says so. */
const NOTHING_HEARD: Problem = { title: "Nothing was heard.", body: "Is the right microphone selected? Nothing was saved." };

/** Fewer samples than this (0.3 s at 16 kHz) are too short to hold speech: a recording of them, a thought's or a question's, has no words. */
const MIN_SPEECH_SAMPLES = 16000 * 0.3;

/** What a dictation into any app hears when there are no words: too little sound, a recognition that failed, or one that was dropped. */
const NO_WORDS = { text: "", seconds: 0 };

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

/** The capsule's card of a filing under way. */
type FilingState = Extract<CapsuleState, { kind: "filing" }>;

/** What an error card's one button does: where its Open Settings goes, or the fix a failed filing offers. */
type ErrorAction = Extract<CapsuleState, { kind: "error" }>["action"];

/**
 * The capsule page's microphone didn't start, in the words the browser gave (`message`): nothing was recorded, or, for a call whose
 * folder kept what the call app played meanwhile (`kept`), the notes weren't made and that is safe.
 */
const microphoneProblem = (message: string, kept = false): Problem => ({
  title: "The microphone didn't start.",
  body: [ownLine(message), kept ? CALL_KEPT_LINE : "Nothing was recorded.", "Check the microphone in Settings → Voice."].filter(Boolean).join(" "),
});

/**
 * The watch of one agent's sign-in (`watchSignIn`): the notes that wait for it, each with what its failure says once no watch
 * will file it (`unwatched`); when it gives up; and its next look.
 */
interface SignInWatch {
  notes: Map<string, Problem>;
  endsAt: number;
  timer: NodeJS.Timeout | null;
}

/**
 * The transcription of a dictation while it runs (`transcribeWithStop`), with what Stop needs to keep its recording
 * (`stopTranscribing`). `vault`: the library the recording was made in, which another may replace meanwhile. `audioPath`: where
 * that library keeps the recording under raw/audio/, null when it keeps none (`claimRecording`). `now`: when its audio arrived, which
 * names a recording that has no `audioPath`. `stopped`: Stop has kept the recording, so whatever the transcription gives is dropped.
 * `forAsk`: the transcription of a question for the Ask window (`heardQuestion`), whose recording is never kept: Stop only drops its words.
 */
interface Transcribing {
  vault: Vault;
  audioPath: string | null;
  now: Date;
  samples: Float32Array;
  stopped: boolean;
  forAsk: boolean;
}

/**
 * What a failed run left behind in the library (a filing's, or a save's): its edits as their own commit, or outside any history; null when
 * it left none, and when there is no outcome to look at.
 */
function leftBehind(outcome: { commit: string | null; changes: { empty: boolean } } | undefined): PartialEdits {
  return !outcome ? null : outcome.commit ? "commit" : outcome.changes.empty ? null : "uncommitted";
}

/**
 * What a filing's failure says when the app keeps no wait and no watch for its note (`keepPromise` set up neither), and what a
 * card says once the watch that would have filed its note ends (`unwatch`): a usage limit still names its reset, a sign-in is
 * told in the words for an agent signed in by hand (no `command` to run), and only the evening review is promised.
 */
function unwatched(failure: AgentFailure, now: Date, options: FilingProblemOptions): Problem {
  return filingProblem(failure, now, { ...options, after: "review" });
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
  /** Gives up the Ask window's question being answered or answer being saved, as closing that window does: Stop calls it (cancelAsk). */
  private giveUpAsk: (() => void) | null = null;
  /**
   * How many answers are being saved as pages (`saveAnswer`), each from Save's press until it answers, whether the save waits for the
   * library or runs. A save commits after any filing that ended while it waited, so none of those is offered for Undo meanwhile
   * (`undoableFiling`). It is a count and not a flag: a save given up by closing Ask goes on polling the library's lock (`Vault.withLock`
   * takes no signal), so one begun after it can overlap it, and the first to end must not clear the mark of the other.
   */
  private savesGoing = 0;
  /**
   * The answers saved as pages that the Ask window can take back (`undoSave`): each save's commit, with the library it was saved in. A
   * commit is added when the save hands it to the window, while that window is open; it goes as the Undo asks for it (one try), and all
   * of them go when the window closes (`openAsk`). The library's history keeps the commits either way. Closing the window ends the right
   * to ask for an Undo, not an Undo already asked for: that one has left the map and waits in the queue, and takes the save back when its
   * turn comes, whether the window is open or not (`undoSave`).
   */
  private readonly savedAnswers = new Map<string, Vault>();
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
  /**
   * What a failure card that promised its note's filing at the limit's reset says without that promise (`unwatched`): its words
   * once the library its note waits in closes, and its wait with it (`unkeepCard`). Set with the card (`fail`), and gone with
   * it, as `cardCapture` is.
   */
  private cardUnkept: Problem | null = null;
  private recording: Recording | null = null;
  /** Dictating into any app: the session from tap to paste (cursor-dictation.ts), with this controller as its host (`cursorHost`). */
  private readonly cursor: CursorDictation;
  /** The native helper that sees the key and pastes, while the setting is on and a library is open (`applyCursorDictation`). */
  private cursorHelper: CursorHelper | null = null;
  /** The key the running helper was last told to watch. */
  private cursorKey: AppSettings["cursorDictation"]["key"] | null = null;
  /** The history of dictations, in the app's own data (`<userData>/dictations.jsonl`), never in the library. */
  private readonly dictations: DictationHistory;
  /**
   * Whether the history holds a dictation, for the menu, which is built often: null until it is asked, and again after every change to
   * the history (`dictationsChanged`), so that the file is not read at each build.
   */
  private hasDictation: boolean | null = null;
  /**
   * Called with the entry that "Forget the last dictation" or a pane's Delete has just taken out of the history (`forgetDictation`).
   * It exists so that whatever else keeps a copy of a dictation can drop it too: the open library's day file (`forgetFromLibrary`).
   * The forget waits for it, and a hook that throws or rejects is told to the person, as the words may still be there.
   */
  onForget: ForgetHook | undefined = (entry) => this.forgetFromLibrary(entry);
  /**
   * Bumped when a dictation is dropped (`cancelCursorRecording`): a recognition that started before reads it again when it ends, and
   * its words are thrown away if it has moved on, so they can't be pasted into the next dictation.
   */
  private cursorGeneration = 0;
  /** A dictation's words are being made (`heardForCursor`), so dropping it must tell the session that they won't come. */
  private cursorRecognising = false;
  /** The words of the last copy prompt, which its Copy button copies (`copy-dictation`). */
  private copyPromptText: string | null = null;
  /** Notes on a call: a call is not a recording, and while one runs no recording starts (`CallNotes.refuse`). */
  private readonly calls: CallNotes;
  /** The listening card of the call that runs, which the capsule goes back to instead of hiding (`setCapsule`); null with no call. */
  private callCard: CapsuleState | null = null;
  /** The calls left over from an earlier launch were looked for (`recoverCalls`). */
  private callsRecovered = false;
  /**
   * The transcription whose recording Stop can keep while it runs, as long as the capsule's card is its card (`transcribeWithStop`,
   * and `stopRecording`, which takes the card for a newer recording).
   */
  private transcribing: Transcribing | null = null;
  /**
   * The recording whose Transcribing card the capsule was last given (`stopRecording`), whoever has the capsule since: a newer recording's
   * stop takes the card. A transcription that ends hides a card only if it is its own (`heardQuestion`), so one that ends late leaves a
   * newer recording's card, its slow state and its Stop alone.
   */
  private transcribingCardOf: Recording | null = null;
  private job: FilingJob | null = null;
  /** The job whose words are in the capsule's editor: from Edit until File or Cancel (`refile`), or `keepEdit`. */
  private inEditor: FilingJob | null = null;
  private hideTimer: NodeJS.Timeout | null = null;
  /** The pointer is over what the capsule draws, so a card that hides itself waits (`scheduleHide`). */
  private keepOpen = false;
  /** The pending end of that hold, once the pointer has left (`setKeepOpen`): a return before it fires cancels it. */
  private letGoTimer: NodeJS.Timeout | null = null;
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
  /**
   * The speech-to-text engine the library's [voice] settings ask for, made again only when they change, the dictionary aside: that
   * is applied on each use, so editing it never reloads the model. Making one costs nothing (the model loads on first use); one the
   * settings can't make reports why on use.
   */
  private readonly speech = new TranscriberCache((voice) =>
    makeTranscriber(voice, this.modelsDir).catch((error: unknown): Transcriber => ({
      engine: "none",
      transcribe: () => Promise.reject(error),
    })),
  );
  private model: ModelStatus = { kind: "missing", bytes: 0 };
  private libraryProblem: string | null = null;
  /**
   * The remembered library's place when it isn't there, as `openLibrary` found it: moved, renamed or unmounted since it was
   * chosen. Settings names it, and so does the menu (`showHome` opens Settings, not setup); null otherwise.
   */
  private libraryMissing: string | null = null;
  private readonly runState: RunStateStore;
  /**
   * What the menu's two Undo items take back, kept for each library on this Mac (`lastFiled` and `lastEveningCommits` are the open
   * library's, loaded as it opens and checked against its git, `checkUndo`). Whoever changes one of them for a library writes the
   * change here for that library, which may no longer be the open one.
   */
  private readonly undoRecords: UndoRecordStore;
  private shortcutProblems: Partial<Record<keyof Shortcuts, string>> = {};
  /** The notice of each shortcut another app holds, with its free alternatives, in the order they register. */
  private takenShortcuts: TakenShortcut[] = [];
  /** The taken shortcuts whose notice the capsule has shown, in this app run or an earlier one. */
  private readonly noticed: NoticedShortcuts;
  /** When a first run reached each of setup's milestones (§5.4): kept on this Mac, never sent anywhere. */
  private readonly firstRun: FirstRunLog;
  /** How many recordings the library has kept, in the app's own folder: the first ones get the listening card's hint (`hintFor`). */
  private readonly captureCount: CaptureCount;
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
  /** Avanzel is quitting, busy or not (`stopAgentChecks`): no agent check starts any more, and the menu bar sets no timer. */
  private checksStopped = false;
  /**
   * The menu bar's one timer (`showTray`): it shows the icon again at the next whole second of a count its title shows, and when
   * a filed stamp wears off. Set only while something counts down; cleared when Avanzel quits (`stopAgentChecks`).
   */
  private trayTimer: NodeJS.Timeout | null = null;
  /** The icon is to be shown at the end of this turn of the event loop (`refreshTray`). */
  private trayFlush: NodeJS.Immediate | null = null;
  /** When the stamp of the last filing that ended well wears off (`markFiled`): the menu bar's face shows filed until then. */
  private filedUntil: number | null = null;
  /** An evening review finished at night (`fallAsleep`): the menu bar's face sleeps until the next capture or library (`wake`). */
  private asleep = false;
  /** Where agent checks run while there is no library (`checkDir`): made at the first such check, kept for the app run. */
  private checkScratch: string | null = null;
  private recent: FiledPage[] = [];
  /**
   * How many thoughts today's lines of the log say were filed (`filedToday`), and the day they are for. The menu is built often and
   * the log grows, so it is read where `recent` is (`readLog`, a filing's end), and again when the day turns (`tick`).
   */
  private filed = { day: "", count: 0 };
  /**
   * The filing the menu's Undo takes back (`undoLastFiling`): the last capsule or background filing that ended well with a commit, and
   * the root of the library it filed in, which is the open one. Each filing's run clears it as it starts (`runFiling`), and so does a
   * review that writes to the library (`executeTask`), since a revert of the filing would meet the review's later commits: the weekly
   * review as it starts, and the evening review as it ends, if it filed anything or threw (one with nothing to file writes nothing, and
   * leaves it). So does the take-back of its commit (`takeBack`, `revertFiling`: `forgetFiling`). A Stop on a filing that still waits in
   * the queue clears nothing: no run has begun. Setup's first thought never sets it, and nor does the evening review: each has its own Undo.
   * Each library keeps its own in `undoRecords`: a library that opens loads its own (`openLibrary`), and the menu offers it once
   * `checkUndo` has found its commit in the library's history. `job` is the filing's own, which only a filing of this app run has.
   */
  private lastFiled: { commit: string; library: string; job?: FilingJob } | null = null;
  private running = new Set<string>();
  /** How far each running review is ("2 of 5", by task id) once it has begun a capture (`countReview`): the menu shows it in place of "Running…". */
  private reviewing = new Map<string, string>();
  /** The open library's last evening review's commits, oldest first: the menu's Undo the last evening review (`undoEveningReview`). Kept per library in `undoRecords`, as `lastFiled` is. */
  private lastEveningCommits: string[] = [];
  /** The open library, once `checkUndo` has checked the records it loaded against its git: the menu offers neither Undo before (`undoChecked`). */
  private undoCheckedFor: Vault | null = null;
  /**
   * The open library's last receipt: what its last filing that ended well told the person, which "Show the last receipt" prints again
   * (`showLastReceipt`). Loaded with the other records as the library opens, checked against its git (`checkUndo`), written where a
   * filing ends (`runFiling`) and cleared with its filing's take-back (`forgetFiling`). A filing that fails, is stopped or is gone leaves
   * it as it was, and so does a review: the next filing's result replaces it. Setup's first thought has none.
   */
  private lastReceipt: FilingReceipt | null = null;
  /**
   * The receipt the capsule shows as a reprint, while it does (`showLastReceipt`): its pages are the ones Open and the rows open, and its
   * commit the one its Undo answers for. `setCapsule` clears it for every card, so it holds only while the reprint is what the capsule shows.
   */
  private reprint: FilingReceipt | null = null;
  /**
   * The filing whose run has begun, from the moment it clears the last filing (`runFiling`) to the moment its run ends. Set that early so
   * that the menu that clearing builds already hides the receipt: with the last filing held it is built with `queuedToFile` empty, and
   * nothing builds it again until the run ends.
   */
  private filingRun: FilingJob | null = null;
  /** The commits being taken back (`revertFiling`): a reprint's Undo of one of them does nothing, and the take-back in flight tells the card, once. */
  private readonly reverting = new Set<string>();
  private audioTimeout: NodeJS.Timeout | null = null;
  /** Whether the capsule page listens yet; commands for its recorder wait until it does. */
  private capsuleListening = false;
  private heldCommands: CapsuleCommand[] = [];
  /** Notifications posted, kept for the e2e tests only. `silent`: posted without macOS's sound, and only then present. */
  private readonly notified: { title: string; body: string; silent?: true }[] = [];
  /** What clicking each of `notified` does, by its index (none: nothing): for the e2e tests only (`clickNotificationForTests`). */
  private readonly notifiedClicks: ((() => void) | undefined)[] = [];
  /**
   * What Open Terminal and Open System Settings would have opened, and text Copy would have copied: with AVANZEL_TEST=1,
   * for the e2e tests only.
   */
  private readonly opened: string[] = [];
  private readonly copied: string[] = [];
  /** What Install git would have run ("xcode-select --install"): with AVANZEL_TEST=1, for the e2e tests only. */
  private readonly spawned: string[] = [];
  /** Quit and reopen was asked (`relaunch`), and the quit it began may still be waiting for a filing to stop. */
  private relaunching = false;
  /** How many relaunches Quit and reopen began while AVANZEL_TEST=1, which relaunches nothing: for the e2e tests only. */
  private relaunched = 0;

  constructor(userData: string) {
    this.store = new SettingsStore(path.join(userData, "settings.json"));
    this.modelsDir = path.join(userData, "models");
    this.runState = new RunStateStore(path.join(userData, "run-state.json"));
    this.undoRecords = new UndoRecordStore(path.join(userData, "undo-records.json"));
    this.noticed = new NoticedShortcuts(path.join(userData, "noticed-shortcuts.json"));
    this.firstRun = new FirstRunLog(path.join(userData, "first-run.json"));
    this.captureCount = new CaptureCount(path.join(userData, "captures.json"));
    this.calls = new CallNotes(this.callHost(path.join(userData, "calls")));
    this.dictations = new DictationHistory(path.join(userData, "dictations.jsonl"), () => this.dictationsChanged());
    this.cursor = new CursorDictation(this.cursorHost()); // after the history, which the host hands it
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
   * words only in memory (kept edits and corrections whose save failed): `stopForQuit` saves those. A call that runs is busy too:
   * `stopForQuit` ends it and keeps its folder for the next start.
   */
  busy(): boolean {
    return this.runs.size > 0 || this.queued > 0 || this.editing.size > 0 || this.kept.size > 0 || this.unwritten.size > 0 || this.calls.running;
  }

  /**
   * Before quitting: stop every agent run and agent check, and keep an open edit (`keepEdit`), then
   * wait (at most quitWaitMs()) while the engine does the runs' bookkeeping: protected files put
   * back, what a run left committed, the capture kept in the inbox. A check isn't waited for. Nothing
   * new starts meanwhile. Words the wait left only in memory (`saveUnwritten`) are saved all the same.
   */
  async stopForQuit(): Promise<void> {
    this.quitting = true;
    const leaving = this.calls.leave();
    for (const abort of this.runs.keys()) abort.abort();
    this.stopAgentChecks();
    this.keepEdit();
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise<void>((resolve) => (timer = setTimeout(resolve, quitWaitMs())));
    await Promise.race([Promise.allSettled([this.queue, ...this.runs.values(), leaving]), waited]);
    clearTimeout(timer);
    this.saveUnwritten();
  }

  /**
   * What goes wrong opening it is kept in `libraryProblem`, which the menu and Settings show. A remembered library that isn't
   * there is no problem of opening it: its place is kept in `libraryMissing`, which they name too. However it went, an Ask window that is
   * open is told to read again (`askChanged`): its pages, suggestions and hint were those of the library that closed.
   */
  private openLibrary(libraryPath: string | null): void {
    try {
      this.closeAndOpenLibrary(libraryPath);
    } finally {
      this.askChanged();
    }
    this.recoverCalls();
    this.applyCursorDictation(); // dictating into any app needs a library, whose dictionary its words go through
  }

  /** `openLibrary`'s work: the library that is open closes, and the one at `libraryPath`, if any, opens in its place. */
  private closeAndOpenLibrary(libraryPath: string | null): void {
    // A reprint that shows is the closing library's: its Open opens that library's pages and its Undo takes back that library's filing.
    if (this.reprint) this.setCapsule({ kind: "hidden" });
    this.dropLibraryTimers(); // a wait or a watch is for the library that closes; the next one's waits are armed again by whoever opens it
    this.vault = null;
    this.recent = [];
    this.filed = { day: "", count: 0 };
    // The Undo of the library that closes is dropped from the menu, not from the disk: `undoRecords` keeps it for the library's return.
    this.lastFiled = null; // a filing of the library that closes, whose menu is built again by whoever opens one
    this.lastEveningCommits = [];
    this.lastReceipt = null;
    this.undoCheckedFor = null;
    this.dropTranscriber();
    this.libraryProblem = null;
    this.libraryMissing = null;
    this.filedUntil = null; // a stamp for a filing in the library that closes
    this.wake(); // and a night's sleep is for it too
    if (!libraryPath) return;
    const vault = new Vault(libraryPath);
    if (!vault.exists()) {
      this.libraryMissing = libraryPath;
      return;
    }
    try {
      ensureDefaultTasks(vault);
      this.recent = recentFromLog(vault.root);
      this.countFiled(vault.root);
    } catch (error) {
      this.recent = [];
      this.filed = { day: "", count: 0 };
      this.libraryProblem = `Avanzel couldn't open the library at ${vault.root}: ${errorMessage(error)}`;
      return;
    }
    this.vault = vault;
    const saved = this.undoRecords.get(vault.root);
    this.lastFiled = saved.filing === null ? null : { commit: saved.filing, library: vault.root };
    this.lastEveningCommits = saved.evening;
    this.lastReceipt = saved.receipt;
    void this.checkUndo(vault); // not awaited: the library is open at once, and neither Undo shows until its commits are found in its history
    void this.keepAudioOutOfGit(vault.root); // not awaited: the library is open at once, and its git is told meanwhile
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

  /**
   * Recordings that wait in the inbox of the library at `root` stay out of its git (the engine's `keepInboxAudioOut`): as the library
   * opens, so a repository Avanzel didn't make, or one with auto_commit off, has the lines before any recording waits there, and again
   * before Stop puts one there. Best effort: why the lines can't be written is logged, and the library opens, and the recording lands,
   * either way.
   */
  private async keepAudioOutOfGit(root: string): Promise<void> {
    const why = await git.keepInboxAudioOut(root);
    if (why !== null) console.warn(`recordings waiting in the inbox of ${root} aren't kept out of git: ${why}`);
  }

  /** A librarian for the open library, as it is as the call is made. */
  private async librarian(harnessName?: string): Promise<Librarian> {
    return this.librarianFor(this.requireVault(), harnessName);
  }

  /**
   * A librarian for `vault`: the open library for everything but an Undo, which takes back in the library it was asked in, and another
   * may be open by the time the queue gets to it (`revertFiling`, `undoEveningReview`). Always with the speech-to-text engine: the
   * evening review may find recordings in the inbox.
   */
  private async librarianFor(vault: Vault, harnessName?: string): Promise<Librarian> {
    const settings = loadSettings(vault.root);
    return new Librarian(vault, settings, {
      harnessName: harnessName && harnessName !== "auto" ? harnessName : undefined,
      transcriber: await this.transcriberFor(settings.voice),
    });
  }

  /** The engine the library's [voice] settings ask for, with its dictionary (`speech`). */
  private async transcriberFor(voice: VoiceSettings): Promise<Transcriber> {
    return this.speech.for(voice);
  }

  /** Lets the speech-to-text engine go: it frees its model (Parakeet's is ~700 MB) once the transcriptions in progress end. */
  private dropTranscriber(): void {
    this.speech.drop();
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

  /**
   * The harness a run that was asked to use `chosen` is for, by name ("claude"): `chosen`, or on "auto" the one selected now
   * (`selectedHarness`). A job that could select none when it was made says "auto"; this is what it ran with, or failed with.
   * Null when there is no agent to name.
   */
  private harnessFor(chosen: string): string | null {
    return chosen === "auto" ? this.selectedHarness() : chosen;
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
      undo: () => this.pressUndoShortcut(),
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
    if (action === "call-notes") return this.pickCall();
    if (action === "call-notes-stop") return this.stopCallNotes();
    if (action === "finish-cut-short") return this.calls.finishOldestCutShort();
    if (action === "type") return this.openQuick();
    if (action === "ask") return this.openAsk();
    if (action === "settings") return this.showSettings();
    if (action === "setup") return this.setup.show();
    if (action === "open-library") return this.openLibraryFolder();
    if (action === "open-inbox" && this.vault) return void shell.openPath(this.vault.inbox);
    // The speech model's problem names Settings → Voice, where its fix is. The person comes to see what is wrong, so the voice settings
    // are read again first: they show what is, not what was a minute ago. Settings opens and nothing else changes: the card the capsule
    // shows is about something of its own, which `openSettingsFor`, the path of a card's button, would hide if it were an error.
    if (action === "open-settings:voice") {
      this.rereadVoiceSettings();
      return this.showSettings("voice");
    }
    if (action === "forget-dictation") return this.forgetLastDictation();
    if (action === "show-receipt") return this.showLastReceipt();
    if (action === "undo-filing") return this.undoLastFiling();
    if (action === "undo-review") return void this.undoEveningReview();
    if (action === "quit") return app.quit();
    if (action.startsWith("open:")) return this.openPage(action.slice(5));
    if (action.startsWith("task:")) {
      // A person's press asks first, as Settings' Run now does (`confirmRun`): the run uses their plan. One that comes due (`tick`) doesn't.
      const id = action.slice(5);
      if (await this.confirmRun(id)) void this.runTask(id);
    }
  }

  private menuInput(): MenuInput {
    const vault = this.vault;
    const now = new Date();
    const tasks = vault ? this.safeTasks(vault) : [];
    const speech = speechProblemOf(this.model);
    return {
      libraryReady: !!vault,
      problem: this.libraryProblem,
      missingLibrary: this.libraryMissing === null ? null : tildePath(this.libraryMissing, homedir()),
      inbox: vault ? vault.pending().length : 0,
      recent: this.recent,
      filedToday: this.filed.count,
      tasks: tasks.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        at: t.enabled ? nextRun(t.schedule, now) : null,
        enabled: t.enabled,
        running: this.running.has(t.id),
        progress: this.reviewing.get(t.id),
      })),
      speechProblem: speech?.title ?? null,
      ...(speech ? { speechSublabel: speech.sublabel } : {}),
      recording: !!this.recording,
      callNotes: this.callNotesOffer(),
      cutShortCalls: this.cutShortOffer(),
      shortcuts: this.store.get().shortcuts,
      unregisteredShortcuts: Object.keys(this.shortcutProblems) as (keyof Shortcuts)[],
      undoableReview: this.lastEveningCommits.length > 0 && this.undoChecked(),
      undoableFiling: this.undoableFiling(),
      showableReceipt: this.receiptShowable(),
      hasReceipt: this.lastReceipt !== null && this.undoChecked(),
      forgettableDictation: (this.hasDictation ??= this.dictations.last() !== null),
    };
  }

  /**
   * Whether the open library's saved Undo (`lastFiled`, `lastEveningCommits`) has been checked against its git (`checkUndo`). Until it
   * has, neither menu item is offered: a commit that a reset left behind would be offered for the moment the check takes.
   */
  private undoChecked(): boolean {
    return this.vault !== null && this.undoCheckedFor === this.vault;
  }

  /**
   * Whether the menu offers Undo the last filing: there is one (`lastFiled`), the library it filed in is the open one and its saved
   * Undo is checked (`undoChecked`), Avanzel isn't quitting, and no filing, review or save of an answer waits or runs. A filing whose run
   * has begun has cleared `lastFiled` already, so the filing that waits for its turn (`queuedToFile`) and the review that waits or runs
   * (`running`) are what the item hides for. A save clears nothing as it begins (`saveAnswer`), but it waits for the library as a question
   * does, and a filing that ends meanwhile would be offered with the save about to commit after it: the saves going (`savesGoing`) hide it
   * too, and a save that commits drops it for good as it ends. One that commits nothing leaves it, and the item comes back.
   */
  private undoableFiling(): boolean {
    const last = this.lastFiled;
    return (
      last !== null && this.vault?.root === last.library && this.undoChecked() && !this.quitting && this.queuedToFile.size === 0 && this.running.size === 0 && this.savesGoing === 0
    );
  }

  /**
   * A filing waits for its turn (`queuedToFile`), a filing's run has begun (`filingRun`: it has cleared the last filing, so nothing else
   * says so for the length of the run) or a review waits or runs (`running`). The menu offers nothing that shows a card or takes a filing
   * back meanwhile.
   */
  private filingOrReviewGoing(): boolean {
    return this.queuedToFile.size > 0 || this.filingRun !== null || this.running.size > 0;
  }

  /**
   * The capsule shows nothing or a finished card (`FINISHED_CARDS`): what a reprint of the last receipt may replace, and the only cards the
   * menu offers it over, and what the bar that says there is no filing to undo may replace. Two cards in the set are not finished, because
   * each is the one place the person is told something that a replacement would take away:
   * - A Stopped card that tells the person the stopped run's edits stay (`partial`, `leftovers`): `settleStop` posts no notification while
   *   that card is up, and the notice that would say it later is a problem (`stoppedNotice`).
   * - A Saved card with a line about what became of its recording (`detail`, such as "Only your words were kept: …").
   * Whatever else may replace a finished card asks this and not the set, so that the set and its exceptions are read together.
   */
  private showsFinishedCard(): boolean {
    const card = this.capsuleState;
    const keepsEdits = card.kind === "cancelled" && (card.partial || card.leftovers > 0);
    const hasRecordingLine = card.kind === "saved" && !!card.detail;
    return FINISHED_CARDS.has(card.kind) && !keepsEdits && !hasRecordingLine;
  }

  /**
   * The capsule is free for a reply to a press of the person's: a reprint of the last receipt (`showLastReceipt`) or the bar that says
   * there is no filing to undo (`pressUndoShortcut`). Avanzel isn't quitting, no thought is in flight (`capturing`: a recording, a
   * transcription, a filing's card or its hidden run, the editor, a refile that waits for its turn), no filing or review goes on
   * (`filingOrReviewGoing`), and the capsule shows nothing or a finished card (`showsFinishedCard`), which the reply may replace. A refile is
   * in neither `queuedToFile` nor `runs` until its turn, and the editor keeps the menu's rebuilds going (`tick`, `leftWithoutRun`), so
   * `capturing` is what holds a reply back there. Both replies ask this, so that a condition added for one is added for the other.
   */
  private capsuleFreeForReply(): boolean {
    return !this.quitting && !this.capturing() && !this.filingOrReviewGoing() && this.showsFinishedCard();
  }

  /**
   * Whether "Show the last receipt" can be chosen now: the open library has a receipt and its saved Undo is checked (`undoChecked`, which
   * also dropped a receipt whose commit has left the history), and the capsule is free for a reply (`capsuleFreeForReply`). Over a problem's
   * notice, the editor or a capture the item is not there, as Undo's is not where it can't act: a press would do nothing, and a notice stays
   * until the person acts. `setCapsule` builds the menu for every card, so the item follows them.
   */
  private receiptShowable(): boolean {
    return this.lastReceipt !== null && this.undoChecked() && this.capsuleFreeForReply();
  }

  /**
   * Whether the menu's Undo takes back the filing of `commit` now (`lastFiled`, `undoableFiling`). A receipt's Undo is the menu's: the
   * reprint offers it when it is drawn, and answers its press, only while this holds. A receipt with no commit (a library without git) has
   * none to take back.
   */
  private offersUndoOf(commit: string | null): boolean {
    return commit !== null && this.lastFiled?.commit === commit && this.undoableFiling();
  }

  /**
   * The Undo records `vault` loaded as it opened are kept only for what is still in its history: a commit a reset, a rebase, a pull that
   * rewrote history or a library restored from a backup left behind is dropped, quietly, from the menu and from `undoRecords`. A commit
   * that is still in the history is offered after any number of relaunches (a revert made by hand leaves it there: the Undo is offered,
   * and git's refusal of it is told as `undoRefused`). It runs as the library opens and not in the way: until it ends neither item is
   * offered (`undoChecked`). A library that opens meanwhile checks its own: `vault` is compared by object, not by folder, since a
   * library opened again loads its records again and checks them itself. Only what is still as it was loaded is dropped: a filing, a
   * review or an Undo since then is newer, and stands. While git can't run (no git, or only Apple's stub of it) nothing is known of the
   * history: nothing is offered, because nothing can be undone, but the records stay on disk for a launch that has git, and the
   * library is checked all the same.
   */
  private async checkUndo(vault: Vault): Promise<void> {
    const filing = this.lastFiled;
    const evening = this.lastEveningCommits;
    const receipt = this.lastReceipt;
    const gitRuns = git.available(); // before the awaits, as `inHistory` finds it: without git every commit reads as gone
    const filingOk = filing === null || (await git.inHistory(vault.root, filing.commit));
    // The receipt is checked by its commit, if it has one (a filing without git or with auto_commit off left none, and there is nothing to
    // check): the filing's own answer when it is the filing's commit, as it is straight after a launch.
    let receiptOk = true;
    if (receipt?.commit) receiptOk = receipt.commit === filing?.commit ? filingOk : await git.inHistory(vault.root, receipt.commit);
    let eveningOk = true;
    for (const sha of evening) if (!(eveningOk = await git.inHistory(vault.root, sha))) break; // one at a time: a review may have made dozens
    if (this.vault !== vault) return; // another library opened meanwhile, and checks its own
    if (!filingOk && this.lastFiled === filing) {
      this.lastFiled = null;
      if (gitRuns) this.undoRecords.patch(vault.root, { filing: null });
    }
    if (!receiptOk && this.lastReceipt === receipt) {
      this.lastReceipt = null; // it prints a filing that is no longer in the library's history
      if (gitRuns) this.undoRecords.patch(vault.root, { receipt: null });
    }
    if (!eveningOk && this.lastEveningCommits === evening) {
      this.lastEveningCommits = [];
      if (gitRuns) this.undoRecords.patch(vault.root, { evening: [] });
    }
    this.undoCheckedFor = vault;
    this.refreshMenu();
  }

  /**
   * The menu's Undo has nothing to take back in the library at `root` (the open library's unless said): a filing's run begins
   * (`runFiling`), or a review writes to it (`executeTask`: the weekly one as it starts, an evening review that filed something as it
   * ends, with the review's own library: another may have opened since). The open library's filing is dropped from the menu and from
   * `undoRecords`, and the menu is built again, but only if it was holding a filing. For another library only its record goes: the menu
   * shows the open library's.
   */
  private clearLastFiled(root: string | undefined = this.vault?.root): void {
    if (root === undefined) return;
    // The record goes whether or not the filing is held in memory: while git can't run, `checkUndo` dropped it from memory only and kept it
    // on disk, and a filing that begins now makes it stale (a patch that changes nothing writes nothing). The receipt is no part of this: it
    // stays until the next filing that ends well replaces it, or the take-back of its filing clears it (`forgetFiling`).
    this.undoRecords.patch(root, { filing: null });
    if (root !== this.vault?.root || this.lastFiled === null) return;
    this.lastFiled = null;
    this.refreshMenu();
  }

  /**
   * The menu's Undo the last evening review has nothing to take back in the library at `root` (`executeTask`: a review of that library
   * threw, and may have filed some of its inbox after the review that the record is of). Its record goes from `undoRecords` whether or not
   * the library is open, and for the open library from the menu, which is built again, but only if it was holding the commits.
   */
  private clearLastEvening(root: string): void {
    this.undoRecords.patch(root, { evening: [] });
    if (root !== this.vault?.root || this.lastEveningCommits.length === 0) return;
    this.lastEveningCommits = [];
    this.refreshMenu();
  }

  /**
   * The commit of the filing the menu would take back is being taken back already (`takeBack`, `revertFiling`, `undoLastFiling`):
   * `commit` is that commit, and any other filing's take-back leaves it be. It is dropped from the menu and from `undoRecords` before
   * the take-back's first await, so that it is asked for once, here and after a relaunch, and so is the last receipt when it is that
   * filing's: what it prints is no longer so. Both go in one patch and the menu is built again once, but only if it was holding either.
   * `root` is the library the take-back is made in, the open one unless said: a card's Undo takes back in the library of its filing, which
   * may not be the open one (`undo`). The menu holds only the open library's filing and receipt, so another library's are read from, and
   * dropped from, `undoRecords` alone, and are not offered again when that library opens.
   */
  private forgetFiling(commit: string, root: string | undefined = this.vault?.root): void {
    if (root === undefined) return;
    const open = root === this.vault?.root;
    const saved = open ? null : this.undoRecords.get(root);
    const forgetsFiling = saved ? saved.filing === commit : this.lastFiled?.commit === commit;
    const forgetsReceipt = saved ? saved.receipt?.commit === commit : this.lastReceipt?.commit === commit;
    if (!forgetsFiling && !forgetsReceipt) return;
    if (open && forgetsFiling) this.lastFiled = null;
    if (open && forgetsReceipt) this.lastReceipt = null;
    this.undoRecords.patch(root, { ...(forgetsFiling ? { filing: null } : {}), ...(forgetsReceipt ? { receipt: null } : {}) });
    if (open) this.refreshMenu();
  }

  /** Counts today's filings in the log of the library at `root` for the menu's head (`filedToday`), and notes the day they are for. */
  private countFiled(root: string, now = new Date()): void {
    this.filed = { day: localDate(now), count: filedToday(root, now) };
  }

  /** The menu's view of the log, read again: the pages filed most recently, and how many thoughts were filed today. */
  private readLog(): void {
    const root = this.vault?.root;
    if (root) this.countFiled(root);
    else this.filed = { day: "", count: 0 };
    try {
      this.recent = root ? recentFromLog(root) : [];
    } catch (error) {
      // Best effort: the menu keeps the pages it had. A library folder that can't be read is not worth failing the take-back that asked.
      console.warn("recent pages", error);
    }
    this.askChanged(); // a take-back or a review ended: the shelves may hold fewer pages, or more
  }

  refreshMenu(): void {
    try {
      this.menuBar.update(this.menuInput());
    } catch (error) {
      console.error("menu", error);
    }
    this.refreshTray();
  }

  // ---------------------------------------------------------------- menu bar icon

  /**
   * How the controller's state reads to the menu bar's face and title (`trayView` decides what shows). The face thinks while the
   * capsule transcribes or shows a filing, a filing waits or runs, a review is queued or running, or an Ask runs: a download
   * doesn't count, the title shows how far it is. `hiddenFilingSince` is the run of the latest filing while its run is going
   * (`runs` keys each by the filing's `abort`: a missing outcome is no proof that a job is running, for a run that threw, a note
   * that was gone and a Stop while queued all leave none), has begun its seconds (it isn't `waiting`), and the capsule is hidden.
   */
  private trayInput(): TrayInput {
    const capsule = this.capsuleState.kind;
    const job = this.job;
    return {
      setupOpen: this.setup.isOpen() || this.setup.upHereOpen(),
      problem:
        capsule === "error" ||
        capsule === "model-failed" ||
        capsule === "shortcut-taken" ||
        this.libraryProblem !== null ||
        this.libraryMissing !== null ||
        this.model.kind === "error",
      recordingSince: this.recording && !this.recording.stopping ? this.recording.startedAt : null,
      busy:
        capsule === "transcribing" ||
        capsule === "filing" ||
        this.queuedToFile.size > 0 ||
        this.runs.size > 0 ||
        this.running.size > 0 ||
        this.giveUpAsk !== null,
      hiddenFilingSince: job && capsule === "hidden" && !job.waiting && this.runs.has(job.abort) ? job.startedAt : null,
      downloadPercent: this.model.kind === "downloading" ? wholePercent(this.model.receivedBytes, this.model.totalBytes) : null,
      filedUntil: this.filedUntil,
      asleep: this.asleep,
    };
  }

  /**
   * Asks for the menu bar icon to be shown as the controller's state says (`showTray`), at the end of this turn of the event loop. A
   * change of state is often several calls in a row (a run ends, then its filing is stamped filed), and the icon should show where
   * they end, not flash through the places between. Only the icon: the menu is not rebuilt (`refreshMenu` does that, and calls
   * this), so a count may be shown every second, and a face swap costs nothing more.
   */
  private refreshTray(): void {
    if (this.trayFlush || !this.menuBar) return; // one is coming already, or the menu bar isn't made yet (`start`)
    this.trayFlush = setImmediate(() => {
      this.trayFlush = null;
      this.showTray();
    });
  }

  /**
   * Shows the menu bar icon as the controller's state asks (`trayInput`, `trayView`): Zel's face, and the title beside it. It also
   * sets the one timer that shows it again when something counts down (`nextTrayWake`), and none once Avanzel is quitting. Best
   * effort: the icon is never worth an exception, in a timer least of all.
   */
  private showTray(): void {
    if (this.trayTimer) clearTimeout(this.trayTimer);
    this.trayTimer = null;
    try {
      const input = this.trayInput();
      const now = Date.now();
      this.menuBar.show(trayView(input, now));
      const delay = this.checksStopped ? null : nextTrayWake(input, now);
      if (delay !== null) {
        this.trayTimer = setTimeout(() => {
          this.trayTimer = null;
          this.showTray();
        }, delay);
      }
    } catch (error) {
      console.error("menu bar", error);
    }
  }

  /** A filing ended well: the face wears its stamp for FILED_FACE_MS, and goes back when it wears off (`showTray` sets the timer). */
  private markFiled(): void {
    this.filedUntil = Date.now() + FILED_FACE_MS;
    this.refreshTray();
  }

  /**
   * A thought of the person's is in flight: it is being recorded or made into words, its editor is open, its edit is still to be settled
   * (`editing`), or its filing (the capsule's own, whether its card shows or is hidden) shows, waits for its turn or runs. A recording of
   * setup's first thought counts, and so do notes on a call while they run. An edit is settled in the queued work that files the corrected words (`settleEdit`, `refile`), so File
   * after Edit during a review is in flight until that work's turn comes, whether its card shows or is hidden: it is in neither
   * `queuedToFile` nor `runs` meanwhile. (`job` is never a background filing's: only the capsule's own filings set it.)
   */
  private capturing(): boolean {
    const capsule = this.capsuleState.kind;
    const job = this.job;
    const filing = job !== null && (this.queuedToFile.has(job.capturePath) || this.runs.has(job.abort));
    return this.recording !== null || this.calls.running || capsule === "transcribing" || capsule === "filing" || this.inEditor !== null || this.editing.size > 0 || filing;
  }

  /**
   * An evening review has finished without throwing: at night (`sleepsAfterReview`) Zel sleeps, until the next capture or library.
   * Not while a thought is in flight (`capturing`): it began before this review ended, so it is no "next capture" to wake Zel, and
   * its filing would end on the asleep face under the person's eyes.
   */
  private fallAsleep(): void {
    if (this.capturing() || !sleepsAfterReview(reviewEndedAt(process.env))) return;
    this.asleep = true;
    this.refreshTray();
  }

  /** A capture begins, or a library opens: Zel wakes. */
  private wake(): void {
    if (!this.asleep) return;
    this.asleep = false;
    this.refreshTray();
  }

  /** The usable scheduled reviews; Settings → Reviews says what is wrong with the others. */
  private safeTasks(vault: Vault): ShadowTask[] {
    return loadTasksReport(vault).tasks;
  }

  // ---------------------------------------------------------------- capsule plumbing

  /** `capture`: the note an error card is about (`cardCapture`), which stays only as long as that card is what the capsule shows. */
  private setCapsule(state: CapsuleState, autoHideMs?: number, capture?: string): void {
    if (state.kind === "hidden" && this.callCard) state = this.callCard; // while a call runs its card is what the capsule rests on
    if (state.kind !== "editing") this.keepEdit(); // whatever replaces the editor (a recording, a typed thought, an error) keeps its edit
    const was = this.capsuleState;
    const wasEditing = was.kind === "editing";
    this.capsuleState = state;
    this.cardCapture = capture ?? null;
    this.reprint = null; // a reprint is the card of whoever puts one up (`showLastReceipt`), which sets it after this
    this.cardUnkept = null; // a card that has words without its promise sets them after (`fail`)
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    const win = this.capsule;
    win.webContents.send("capsule:state", state);
    if (state.kind === "hidden") {
      // A hidden panel can't be hovered, and no leave reaches it: the pointer that was on it (to press Hide, say) lets go of the hold
      // now, or the next card that hides itself would wait for a pointer that has gone (`scheduleHide`).
      this.keepOpen = false;
      if (this.letGoTimer) clearTimeout(this.letGoTimer);
      this.letGoTimer = null;
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
        // The editor took the keyboard (it is typed into), and `setFocusable(false)` does not take it back: a panel that stayed the key
        // window would swallow the person's next keys, and their first Space or Return would press the card's focused Hide. So the key
        // goes back to the app they were in, once, as the editor closes: not at every step of a filing.
        if (wasEditing) win.blur();
      }
    }
    if (autoHideMs) this.scheduleHide(autoHideMs);
    if (state.kind === "saved" && !state.undone) this.markFiled(); // words saved, for the evening review or as a screen comment: stamped
    this.refreshMenu();
  }

  /** The capsule page is listening: it may have missed the state sent while it loaded, and gets the commands held for it. */
  capsuleReady(): void {
    this.capsuleListening = true;
    this.capsule.webContents.send("capsule:state", this.capsuleState);
    for (const command of this.heldCommands.splice(0)) this.capsule.webContents.send("capsule:command", command);
  }

  /** A command for the capsule's recorder. Sent while its page loads, it would be lost: so it waits. */
  private capsuleCommand(command: CapsuleCommand): void {
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
   * The capsule's card of what went wrong: `problem`'s title says what happened and its body what is safe, with the command it
   * names, if it names one, which the card sets in code. Its one button does `action` and says `actionLabel` (Open Settings when it
   * names none); a card with no action has Hide alone. `capture`: the note the card is about, if it is about one, which the card
   * keeps for as long as it shows. `unkept`: for a card that promises its note's filing at a limit's reset, what it says without
   * that promise (`cardUnkept`).
   */
  private fail({ title, body, command }: Problem, action?: ErrorAction, actionLabel?: string, capture?: string, unkept?: Problem): void {
    this.setCapsule({ kind: "error", message: title, detail: body, ...(command ? { command } : {}), action, actionLabel }, undefined, capture);
    this.cardUnkept = unkept ?? null;
  }

  /**
   * `recording` went wrong: the capsule's card says so (`card`, and its button: `action` and `actionLabel`), unless it is setup's
   * first spoken thought, which the setup window says in its own words instead (`setup.lost`): the `problem`, and whether the
   * recording is `kept` in the library, which nothing else of it is.
   */
  private recordingFailed(
    recording: Recording,
    { problem, kept = false }: { problem: RecordingProblem; kept?: boolean },
    card: Problem,
    action?: ErrorAction,
    actionLabel?: string,
  ): void {
    if (!this.setup.lost(recording, { kind: "failed", problem, kept })) this.fail(card, action, actionLabel);
  }

  // ---------------------------------------------------------------- recording

  /**
   * Record a thought's own shortcut was pressed: setup's press test hears it (`setup.notePress`), then it records or stops
   * as Record a thought in the menu does. Only this is a press of the shortcut. With the Ask window the key window, and nothing
   * recording (a press stops a recording, whoever is in front) or taking the press (setup's first-thought step), it records a question
   * for that window instead (`heardQuestion`), if the shelves hold a page: with none there is nothing to ask about, and the window's own
   * line invites a thought, so the press records one. Record a thought in the menu (`toggleDictate`) never records a question.
   */
  private pressDictate(): void {
    this.setup.notePress();
    if (!this.setup.takesPress() && !this.recording && this.pressAsks()) {
      void this.startRecording("dictate", undefined, { askPage: this.askWindow!.webContents.id });
      return;
    }
    void this.toggleDictate();
  }

  /** Record a thought, from its shortcut or the menu. On setup's first-thought step, the press is setup's (`setup.press`). */
  async toggleDictate(): Promise<void> {
    if (this.setup.takesPress()) return this.setup.press();
    if (this.recording?.forCursor) return; // only the dictation's own key stops it
    if (this.recording) return this.stopRecording();
    await this.startRecording("dictate");
  }

  async toggleCapture(): Promise<void> {
    if (this.recording?.forCursor) return; // only the dictation's own key stops it
    if (this.recording) return this.stopRecording();
    if (this.calls.refuse()) return;
    if (!(await this.readyToListen())) return;
    const screen = permissionStatus("screen");
    if (screen === "denied" || screen === "restricted") return this.cantSeeScreen();
    const vault = this.requireVault();
    if (this.capsule.isVisible()) this.setCapsule({ kind: "hidden" });
    await new Promise((r) => setTimeout(r, 80)); // let the capsule leave the screen before the shot
    // Two things can go wrong, and each says so: the screen can't be captured (and its screenshot claimed and written), or it was, and
    // the recording that goes with it can't start. Either way the card says nothing was saved, so a screenshot that was claimed goes.
    let shotPath: string | null = null;
    let shot: NonNullable<Recording["shot"]>;
    try {
      // Not asked yet: this capture is what makes macOS ask. Without the grant it comes back blank.
      const [image, context] = await Promise.all([captureDisplay(), this.screenContext()]);
      if (looksBlank(image)) return this.cantSeeScreen();
      shotPath = vault.newAttachmentPath(new Date(), ".png");
      writeFileSync(shotPath, image.toPNG());
      shot = { path: shotPath, thumbnail: image.resize({ width: 208 }).toDataURL(), context };
    } catch (error) {
      if (shotPath !== null) rmSync(shotPath, { force: true });
      return this.fail(screenCaptureProblem(errorMessage(error), reasonMax(error)));
    }
    try {
      await this.startRecording("comment", shot);
    } catch (error) {
      rmSync(shot.path, { force: true });
      this.fail(commentNotStartedProblem(errorMessage(error), reasonMax(error)));
    }
  }

  /** macOS applies a Screen Recording grant only when the app starts again. */
  private cantSeeScreen(): void {
    this.fail(
      { title: "Avanzel can't see the screen yet.", body: "Allow it in System Settings, under Screen Recording, then quit and reopen Avanzel." },
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
      this.fail({ title: "Avanzel can't hear you yet.", body: "Allow it in System Settings, under Microphone." }, "open-microphone-settings", "Open System Settings");
      return false;
    }
    return true;
  }

  /** Speech can become words: the speech models are ready, or AVANZEL_FAKE_TRANSCRIPT stands in for them. */
  private hears(): boolean {
    return !!process.env.AVANZEL_FAKE_TRANSCRIPT || this.model.kind === "ready";
  }

  /**
   * Whether the open library's speech becomes words on this Mac, which the capsule and setup then say. The engine's own model
   * does, and so does the default a library whose settings can't be read would have; the command in a library's [voice]
   * settings can run anywhere, so for it the words say only that they are made.
   */
  private transcribesOnThisMac(): boolean {
    try {
      return (this.vault ? loadSettings(this.vault.root) : defaultSettings()).voice.backend !== "command";
    } catch {
      return true;
    }
  }

  /**
   * `forSetup`: setup's first spoken thought (`Setup.recordThought`), which has no file mode to switch (`toggleFileMode` tells why)
   * and is offered no Stop while its words are made (`transcribeWithStop` tells why). `askPage`: the Ask window's `webContents.id`,
   * for a question that window is to hear (`pressDictate`): it has no file mode either, and its words go to that window alone
   * (`heardQuestion`). `forCursor`: a dictation into any app (`startCursorRecording`), which has neither, and which its time limit and
   * Esc end through the dictation's session, as its key would. True once it listens.
   */
  private async startRecording(
    mode: CapsuleMode,
    shot?: Recording["shot"],
    { forSetup = false, askPage = null, forCursor = false }: { forSetup?: boolean; askPage?: number | null; forCursor?: boolean } = {},
  ): Promise<boolean> {
    if (this.calls.refuse()) {
      if (shot) rmSync(shot.path, { force: true });
      return false;
    }
    if (mode === "dictate" && !(await this.readyToListen())) return false;
    if (this.recording || this.calls.refuse()) {
      // Another tap started one, or a call, while this one waited (say, on the microphone prompt).
      if (shot) rmSync(shot.path, { force: true });
      return false;
    }
    this.clearAudioTimeout();
    const maxSeconds = this.vault ? loadSettings(this.vault.root).voice.maxRecordSeconds : 600;
    const recording: Recording = {
      mode,
      fileMode: mode === "dictate" && !forSetup && askPage === null && !forCursor ? this.store.get().fileMode : null,
      forSetup,
      forAsk: askPage !== null,
      askPage,
      forCursor,
      startedAt: Date.now(),
      shot,
      stopping: false,
      maxTimer: setTimeout(() => {
        if (this.recording !== recording) return;
        // A dictation ends through its session, which pastes nothing without the person's own second tap: its words are offered on the
        // copy card instead (`CursorDictation.timeUp`).
        if (forCursor) this.cursor.timeUp();
        else void this.stopRecording();
      }, maxSeconds * 1000),
    };
    this.recording = recording;
    this.wake(); // the next capture wakes Zel
    this.setCapsule({
      kind: "listening",
      mode,
      startedAt: recording.startedAt,
      fakeMic: !!process.env.AVANZEL_FAKE_AUDIO,
      microphoneId: this.store.get().microphoneId,
      fileMode: recording.fileMode,
      review: reviewTime(this.openReview()),
      hint: forCursor ? null : this.hintFor(mode),
      ...(shot ? { thumbnail: shot.thumbnail, context: shot.context } : {}),
    });
    this.capsuleCommand("start");
    try {
      shortcutApi().register("Escape", () => this.cancelRecording());
    } catch {
      // Esc is a convenience; the menu and the shortcut still stop the recording.
    }
    return true;
  }

  /**
   * The shortcut that finishes a recording in `mode`, for the listening card to name while the first recordings teach the keys:
   * Record a thought's, or Capture screen with a comment's for a screen comment. Null once HINT_CAPTURES recordings have been kept
   * (`captureCount`), and while that shortcut isn't registered (`shortcutProblems` names it: another app holds it, or it can't
   * work): there is no key to name then.
   */
  private hintFor(mode: CapsuleMode): string | null {
    const key = mode === "comment" ? "capture" : "dictate";
    const accelerator = this.store.get().shortcuts[key];
    return accelerator && !this.shortcutProblems[key] && this.captureCount.get() < HINT_CAPTURES ? accelerator : null;
  }

  /**
   * The capsule's file-mode switch, while a recording listens: its words are filed now, or at the evening review, the other way
   * round from what the card shows (`Recording.fileMode`). The mode starts as the setting says, and a press changes this
   * recording's alone: the setting stays as it is, and the next recording starts from it again. The stop reads the mode
   * (`afterCapture`), so the switch ends with the card that listens: a press does nothing once the recording is stopped (the card
   * says it is transcribing), nor while another card has replaced the listening one (a typed thought's, say). There is nothing to
   * switch (`fileMode` is null) for a screen comment, which is always saved, for setup's first spoken thought, which its step
   * files whatever the mode, and for a question for the Ask window, which is never filed. Only the capsule's own page is heard
   * (`sender` is the page the message came from, `event.sender`).
   */
  toggleFileMode(sender: WebContents): void {
    const recording = this.recording;
    const state = this.capsuleState;
    if (!isPageOf(sender, this.capsule) || !recording || recording.fileMode === null || state.kind !== "listening") return;
    recording.fileMode = recording.fileMode === "now" ? "evening" : "now";
    this.setCapsule({ ...state, fileMode: recording.fileMode });
  }

  async stopRecording(): Promise<void> {
    const recording = this.recording;
    if (!recording || recording.stopping) return; // a second tap while its audio is on the way
    recording.stopping = true;
    clearTimeout(recording.maxTimer);
    shortcutApi().unregister("Escape");
    const onThisMac = this.transcribesOnThisMac();
    // This card is the capsule's now: an older transcription still running no longer has it, so neither its slow state nor Stop can
    // reach this recording's card (`slowTranscription`, `stopTranscribing`).
    this.transcribing = null;
    // A screen comment keeps its screenshot's card while its words are made, as it had it while it listened.
    this.setCapsule({ kind: "transcribing", mode: recording.mode, onThisMac, ...(recording.shot ? { thumbnail: recording.shot.thumbnail, context: recording.shot.context } : {}) });
    this.transcribingCardOf = recording; // whose card it is: an older question's words, when they come, hide only their own (`heardQuestion`)
    this.setup.moveThought(recording, { kind: "transcribing", startedAt: Date.now(), onThisMac });
    this.capsuleCommand("stop");
    this.clearAudioTimeout();
    this.audioTimeout = setTimeout(() => {
      this.audioTimeout = null;
      if (this.recording !== recording) return; // only ever this recording, never a newer one
      this.abandonRecording(recording);
      // A dictation's session waits for its words: it hears none (its line is replaced by the card below at once), so the next tap works.
      if (recording.forCursor) void this.cursor.heard(NO_WORDS);
      this.recordingFailed(recording, { problem: "lost" }, recordingLost, "open-settings:voice", "Choose microphone");
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
    if (recording.forCursor) {
      this.cursor.cancel(); // its session drops it (`cancelCursorRecording`), and knows it did
      if (this.recording !== recording) return;
    }
    this.abandonRecording(recording);
    this.setCapsule({ kind: "hidden" });
    this.setup.moveThought(recording, { kind: "waiting" });
  }

  /**
   * The capsule's page couldn't start the microphone, and says why in the words the browser gave (`message`). Nothing was
   * recorded, and the card sends the person to Settings → Voice, where the microphone is chosen. For a call, the call ends
   * (`CallNotes.cancel`). The IPC channel hears only the capsule's own page (`micErrorFrom`); the e2e tests call this directly.
   */
  micError(message: string): void {
    const recording = this.recording;
    if (!recording) return void this.calls.cancel((kept) => microphoneProblem(message, kept), "open-settings:voice", "Open Settings");
    // A dictation is dropped through its session, which would otherwise go on listening for a recording that has gone.
    if (recording.forCursor) this.cursor.cancel();
    if (this.recording === recording) this.abandonRecording(recording);
    this.recordingFailed(
      recording,
      { problem: "microphone" },
      microphoneProblem(message),
      "open-settings:voice",
      "Open Settings",
    );
  }

  /** The microphone's error from the IPC channel (`micError`): only the capsule's own page ends a recording or a call. */
  micErrorFrom(sender: WebContents, message: string): void {
    if (isPageOf(sender, this.capsule)) this.micError(message);
  }

  /** Give a recording up without its audio: the capsule lets go of the microphone, and a screenshot taken for it goes. */
  private abandonRecording(recording: Recording): void {
    clearTimeout(recording.maxTimer);
    this.clearAudioTimeout();
    shortcutApi().unregister("Escape");
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
    if (recording.forAsk) return this.heardQuestion(recording, received);
    if (recording.forCursor) return this.heardForCursor(recording, received);
    const vault = this.requireVault();
    const now = new Date();
    // What a failure can say is safe: the recording, once written to the library, whether its words were made, and, for a screen
    // comment, whether its note (which holds the screenshot) was written.
    let written: string | null = null;
    let text = "";
    let captured = false;
    try {
      const samples = await this.samplesOf(received);
      const { audioPath, unkept } = this.claimRecording(vault, now);
      let engine = "";
      let heard: string | undefined; // what the speech model recognised, when the dictionary corrected it
      let seconds: number | null = null;
      if (samples.length >= MIN_SPEECH_SAMPLES) {
        if (audioPath) {
          writeWav(audioPath, samples, 16000);
          written = audioPath;
        }
        const started = performance.now();
        const stoppable = recording.mode === "dictate" && !recording.forSetup;
        const transcript = await this.transcribeWithStop(samples, stoppable ? { vault, audioPath, now, samples, stopped: false, forAsk: false } : null);
        if (!transcript) return; // Stop kept the recording in the inbox meanwhile: the words it made, or its failure, are dropped
        seconds = (performance.now() - started) / 1000;
        text = transcript.text.trim();
        engine = transcript.engine;
        heard = transcript.heard?.trim();
      }
      if (!text && audioPath) rmSync(audioPath, { force: true });

      if (recording.mode === "comment" && recording.shot) {
        (await this.librarian()).captureScreen({
          image: recording.shot.path,
          comment: text,
          ...(text ? { audio: audioPath, transcriber: engine } : {}),
          context: { ...recording.shot.context, heard: text ? heard : undefined },
        });
        captured = true;
        this.captureCount.add(); // the screenshot is kept, with or without a comment
        this.setCapsule(
          {
            kind: "saved",
            text,
            thumbnail: recording.shot.thumbnail,
            context: recording.shot.context,
            note: this.savedLine(),
            ...(text && unkept ? { detail: unkept } : {}),
          },
          5000,
        );
        return;
      }
      if (!text) {
        // Its recording went with it: nothing is kept.
        return this.recordingFailed(recording, { problem: "silence" }, NOTHING_HEARD, "open-settings:voice", "Choose microphone");
      }
      const capture = vault.newCapture(text, { source: "voice", audio: audioPath, transcriber: engine, now, context: { heard } });
      this.captureCount.add(); // its words are in the inbox: kept, whatever becomes of them next
      this.afterCapture(capture.path, text, seconds, unkept, recording);
    } catch (error) {
      console.error("recording", error);
      // The card says what is kept, and a screenshot that no note holds is not: it goes, as one of a recording given up does
      // (`abandonRecording`). The recording is the person's voice, and is kept where it was written.
      if (recording.shot && !captured) rmSync(recording.shot.path, { force: true });
      const kept = written !== null && existsSync(written) ? vault.relativePath(written) : null;
      const why = errorMessage(error);
      // A screen comment with no words is a normal one (it is saved as "No comment"), so for a comment it is always the screen capture
      // that couldn't be saved. A dictation that made no words is one whose recording couldn't be turned into words.
      const comment = recording.mode === "comment";
      this.recordingFailed(
        recording,
        { problem: text ? "unsaved" : "unheard", kept: kept !== null },
        comment || text ? unsavedProblem(why, kept, comment, reasonMax(error)) : unheardProblem(why, kept, reasonMax(error)),
      );
    }
  }

  /**
   * `recording`, a question for the Ask window (`pressDictate`), has its audio. Its words go to that window's field (`ask:heard`) and
   * nowhere in the library: no capture, no kept recording, no count of kept recordings and no filing (`afterCapture`), and no
   * notification. Under 0.3 s of samples there are no words, as for a thought, and the card says so, as it says a recording that could
   * not be turned into words, both with "Nothing was saved.". Stop on the slow transcription drops the words it makes
   * (`stopTranscribing`). They go to the Ask window of the press alone (`Recording.askPage`): once it has closed they are dropped
   * quietly, even when another Ask window has opened since, which no one has said them to. The capsule's card of the transcription goes
   * in every case where it is still up and is the question's own: a recording stopped since has the card, and keeps it.
   */
  private async heardQuestion(recording: Recording, received: Float32Array): Promise<void> {
    try {
      const samples = await this.samplesOf(received);
      let words = "";
      if (samples.length >= MIN_SPEECH_SAMPLES) {
        const transcript = await this.transcribeWithStop(samples, { vault: this.requireVault(), audioPath: null, now: new Date(), samples, stopped: false, forAsk: true });
        if (!transcript) return; // Stop dropped the question meanwhile: the words it made, or its failure, are dropped
        words = transcript.text.trim();
      }
      if (!words) return this.recordingFailed(recording, { problem: "silence" }, NOTHING_HEARD, "open-settings:voice", "Choose microphone");
      // Only the question's own card: a recording stopped since has taken the card (`transcribingCardOf`), and its slow state and Stop are its.
      if (this.capsuleState.kind === "transcribing" && this.transcribingCardOf === recording) this.setCapsule({ kind: "hidden" });
      const win = this.askWindow;
      if (win && !win.isDestroyed() && win.webContents.id === recording.askPage) win.webContents.send("ask:heard", words);
    } catch (error) {
      console.error("question", error);
      this.recordingFailed(recording, { problem: "unheard" }, unheardProblem(errorMessage(error), null, reasonMax(error)));
    }
  }

  /**
   * `recording`, a dictation into any app, has its audio. As for a question (`heardQuestion`), its words go nowhere in the library: no
   * capture, no kept recording, no count and no filing; the audio is dropped once its words are made. They go to the dictation's session
   * (`CursorDictation.heard`), which pastes them or offers them. A dictation dropped meanwhile (`cancelCursorRecording`) has moved
   * `cursorGeneration` on, and its words, or its failure, are thrown away: the session has already been told. A failure tells the
   * session there are no words, so the next tap works, then puts up the card of a recording that couldn't be turned into words.
   */
  private async heardForCursor(recording: Recording, received: Float32Array): Promise<void> {
    const generation = this.cursorGeneration;
    const dropped = () => generation !== this.cursorGeneration;
    this.cursorRecognising = true;
    let words: { text: string; heard?: string; seconds: number } = NO_WORDS;
    try {
      const samples = await this.samplesOf(received);
      if (samples.length >= MIN_SPEECH_SAMPLES) {
        const transcript = await this.transcribe(samples);
        const heard = transcript.heard?.trim();
        words = { text: transcript.text.trim(), ...(heard ? { heard } : {}), seconds: samples.length / 16000 };
      }
    } catch (error) {
      console.error("cursor dictation", error);
      if (dropped()) return;
      this.cursorRecognising = false;
      void this.cursor.heard(NO_WORDS); // says nothing was heard, which the card below replaces at once
      return this.recordingFailed(recording, { problem: "unheard" }, unheardProblem(errorMessage(error), null, reasonMax(error)));
    }
    if (dropped()) return;
    this.cursorRecognising = false;
    // Only the dictation's own card: a recording started since has the capsule.
    if (this.capsuleState.kind === "transcribing" && this.transcribingCardOf === recording) this.setCapsule({ kind: "hidden" });
    await this.cursor.heard(words);
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

  /** The samples of a recording, a thought's or a question's: the `received` ones, or, in tests, the wav that AVANZEL_FAKE_AUDIO names in their place. */
  private async samplesOf(received: Float32Array): Promise<Float32Array> {
    const fake = process.env.AVANZEL_FAKE_AUDIO;
    return fake ? this.fakeAudio(fake) : received;
  }

  private async fakeAudio(file: string): Promise<Float32Array> {
    const wav = readWav(file);
    return resampleTo16k(wav.samples, wav.sampleRate);
  }

  /** The words of `samples`, through the library's dictionary; `heard` is what was recognised when the dictionary changed it. */
  private async transcribe(samples: Float32Array): Promise<Heard> {
    const fake = process.env.AVANZEL_FAKE_TRANSCRIPT;
    if (fake !== undefined) {
      if (FAKE_TRANSCRIPT_DELAY_MS) await new Promise((resolve) => setTimeout(resolve, FAKE_TRANSCRIPT_DELAY_MS));
      return fakeTranscript(fake, loadSettings(this.requireVault().root).voice);
    }
    const transcriber = await this.transcriberFor(loadSettings(this.requireVault().root).voice);
    return transcriber.transcribe(samples, 16000);
  }

  /**
   * The words of `samples`. Once the transcription has run for TRANSCRIBE_STOP_MS its card turns slow (`slowTranscription`), and
   * Stop can keep the recording for the evening review while the words are made (`stopTranscribing`). `transcribing` says what Stop
   * needs; it is null for a recording that has no Stop: a screen comment, whose words and screenshot are saved together, and
   * setup's first spoken thought, whose window shows its own progress. The transcription itself can't be stopped (a `Transcriber`
   * takes no signal), so it runs on; once Stop has kept the recording, whatever it gives is dropped, words or failure: null.
   */
  private async transcribeWithStop(samples: Float32Array, transcribing: Transcribing | null): Promise<Heard | null> {
    if (!transcribing) return this.transcribe(samples);
    this.transcribing = transcribing;
    const slow = setTimeout(() => this.slowTranscription(transcribing), TRANSCRIBE_STOP_MS);
    try {
      const transcript = await this.transcribe(samples);
      return transcribing.stopped ? null : transcript;
    } catch (error) {
      if (!transcribing.stopped) throw error;
      console.error("stopped transcription", error); // the recording is kept, as the card said: that is all there is to tell
      return null;
    } finally {
      clearTimeout(slow);
      if (this.transcribing === transcribing) this.transcribing = null;
    }
  }

  /** `transcribing` has run for TRANSCRIBE_STOP_MS: its card turns slow, and offers Stop, if the capsule still shows it. */
  private slowTranscription(transcribing: Transcribing): void {
    const state = this.capsuleState;
    if (this.transcribing === transcribing && state.kind === "transcribing") this.setCapsule({ ...state, slow: true });
  }

  /**
   * Stop, on the card of a transcription that has run long (`slow`): the recording is kept in the inbox of the library it was made
   * in, where the engine's queue finds audio, so the evening review turns it into words and files it, and the card says it is
   * recorded (`recorded`, for 6 s, longer while hovered). The recording is moved, never copied or removed: from raw/audio/, under its
   * own name or the next free one (`keepInInbox`). It counts toward the first ten (`hintFor`). The transcription itself can't be
   * stopped, so it goes on, and what it returns is dropped, words or failure (`transcribeWithStop`): no note, no card, and the
   * recording is left where it is. When the inbox can't take the recording, none of that happens: an error card says so, the
   * recording stays where it was, and the transcription goes on as if Stop had not been pressed. Only the capsule's own page is
   * heard (`sender` is the page the message came from, `event.sender`), and only while the capsule shows that transcription's
   * slow card: a press before then, a second one, one after the transcription has ended, and one on the card of a screen comment
   * or of setup's first spoken thought (which never turn slow) do nothing. Before the recording lands, the library's git is told to
   * keep it out (`keepAudioOutOfGit`, as the library did when it opened): that takes a moment, in which the transcription may end or
   * a second press come, so the press is looked at again once it is done. A question for the Ask window (`Transcribing.forAsk`) has no
   * recording to keep: Stop drops its words, whenever they come, and hides the card, with no Recorded card and no count.
   */
  async stopTranscribing(sender: WebContents): Promise<void> {
    const transcribing = this.transcribing;
    if (!isPageOf(sender, this.capsule) || !transcribing) return;
    // `transcribing.stopped` is a belt: once Stop has kept the recording the card is `recorded`, and the check of the card turns a
    // second Stop away. It keeps a recording from being kept twice, should the card ever allow it.
    const stoppable = () => {
      const state = this.capsuleState;
      return this.transcribing === transcribing && !transcribing.stopped && state.kind === "transcribing" && !!state.slow;
    };
    if (!stoppable()) return;
    if (transcribing.forAsk) {
      // A question keeps nothing: its words are dropped when they come, and its card goes. No recording is moved, none is counted and no
      // card says it is recorded.
      transcribing.stopped = true;
      this.setCapsule({ kind: "hidden" });
      return;
    }
    await this.keepAudioOutOfGit(transcribing.vault.root);
    if (!stoppable()) return;
    try {
      this.keepInInbox(transcribing);
    } catch (error) {
      console.error("stop transcribing", error);
      // The card says where the recording is now. It is not promised to stay: the transcription goes on, and one that finds no words
      // removes the recording it was made from (`onAudio`).
      const { vault, audioPath } = transcribing;
      return this.fail(stopFailedProblem(errorMessage(error), audioPath === null ? null : vault.relativePath(audioPath), CAPSULE_LINE_MAX));
    }
    transcribing.stopped = true;
    this.captureCount.add(); // the library keeps the recording now, whatever the evening review makes of it
    this.setCapsule({ kind: "recorded", review: reviewTime(this.openReview(transcribing.vault)) }, STOPPED_SHOW_MS);
  }

  /**
   * Keeps the recording of `transcribing` in its library's inbox, as audio the evening review finds (`Vault.pending`): moved there
   * from raw/audio/ (`moveInto`: a rename, never over a file, under its own name or the next free one), or, when the library kept
   * no copy of it (`audioPath` null), written there from its samples (`writeInto`, which removes what a failed write leaves).
   * Throws when the inbox can't take it, with the recording as it was.
   */
  private keepInInbox({ vault, audioPath, now, samples }: Transcribing): void {
    if (audioPath) moveInto(vault.inbox, audioPath);
    else writeInto(vault.inbox, `${idStamp(now)}.wav`, (file) => writeWav(file, samples, 16000));
  }

  // ---------------------------------------------------------------- dictating into any app

  /** A tap of the dictation's key, from the helper: it starts a dictation, or ends the one that listens. Nothing while the setting is off. */
  pressCursorDictation(): void {
    if (this.cursorHelper) void this.cursor.tap();
  }

  /** Turns dictating into any app on or off, or chooses its key, as Settings asks; what `patch` leaves out stays as it was. */
  async setCursorDictation(patch: Partial<AppSettings["cursorDictation"]>): Promise<SettingsSnapshot> {
    return this.changeApp({ cursorDictation: { ...this.store.get().cursorDictation, ...patch } });
  }

  /** What macOS has granted for dictating into any app, for Settings: asked of the running helper, or of one that lives for the answer. */
  async cursorPermissions(): Promise<CursorPermissionState> {
    return cursorPermissionsOf(this.cursorHelper, false);
  }

  /**
   * Has macOS ask for the permissions (its prompts come up once; after a refusal only System Settings can grant), and opens System
   * Settings at the one still missing: Input Monitoring first, as without it the key is never seen.
   */
  async askCursorPermissions(): Promise<CursorPermissionState> {
    const state = await cursorPermissionsOf(this.cursorHelper, true);
    if (!state.available) return state;
    const missing = !state.inputMonitoring ? "input-monitoring" : !state.accessibility ? "accessibility" : null;
    if (missing) this.openPane(missing);
    return state;
  }

  /**
   * The newest `limit` dictations of the history, for Settings → Dictations (`pageOf`): newest first, each as the pane shows it (the words
   * cut to a preview), with how many the history holds. It needs no library: the history is the app's own.
   */
  listDictations(limit?: number): DictationList {
    return pageOf(this.dictations.list(), limit);
  }

  /** Copy, in the Dictations pane: dictation `id`'s whole words go on the clipboard. False when it has gone, or the clipboard refused. */
  async copyDictation(id: string): Promise<boolean> {
    const entry = this.dictations.list().find((each) => each.id === id);
    if (!entry) return false;
    try {
      await electronClipboard.writeText(entry.text);
      return true;
    } catch (error) {
      console.error("copy dictation", (error as NodeJS.ErrnoException).code ?? "failed"); // never the words
      return false;
    }
  }

  /**
   * Takes dictation `id` out of the history, then has `onForget` take it out of the library's day file. The one way a dictation is
   * forgotten: Delete in the pane (`deleteDictation`) and the menu's "Forget the last dictation" both come here. Rejects when the
   * history can't be rewritten, and then the dictation is still in it. Resolves to the entry (null when there was none), and whether
   * the day file was updated too (`elsewhere`).
   */
  forgetDictation(id: string): Promise<Forgotten> {
    return forgetDictation(this.dictations, id, this.onForget);
  }

  /**
   * Delete, in the Dictations pane: ok once the dictation is gone; else a calm sentence for the pane's Notice, with the dictation kept,
   * or, when it left the history but the day file couldn't be updated, where its words may still be (`DAY_FILE_NOT_UPDATED`).
   */
  deleteDictation(id: string): Promise<DeleteDictationResult> {
    return deleteDictationResult(() => this.forgetDictation(id));
  }

  /**
   * "Forget the last dictation", in the menu: the newest dictation goes. A history that can't be rewritten says so in a notification;
   * a day file that couldn't be updated is told on the capsule's card, as the person must act on it.
   */
  private async forgetLastDictation(): Promise<void> {
    const last = this.dictations.last();
    if (!last) return;
    const forgotten = await deleteDictationResult(() => this.forgetDictation(last.id));
    if (forgotten.ok) return;
    if (forgotten.title === DAY_FILE_NOT_UPDATED.title) this.fail({ title: forgotten.title, body: forgotten.message });
    else this.notify("That dictation couldn't be forgotten.", forgotten.message);
  }

  /**
   * The hook of `onForget`: the dictation leaves the day file of the library it was kept in (`forgetKept`), which may be another than
   * the one open, or one with none open; an entry that names no library is looked for in the open one. Rejects when its words may still
   * be there, naming the library's folder when it is not the open one.
   */
  private async forgetFromLibrary(entry: DictationEntry): Promise<void> {
    await forgetKept(this.vault, entry, (root) => tildePath(root, homedir()));
  }

  /**
   * The history changed, by a dictation that ended or by one forgotten: the menu is built again, with or without "Forget the last
   * dictation", and an open Settings is told, so that its Dictations pane lists the history again.
   */
  private dictationsChanged(): void {
    this.hasDictation = null;
    this.refreshMenu();
    const win = this.settingsWindow;
    if (win && !win.isDestroyed()) win.webContents.send("settings:dictations-changed");
  }

  /** Whether `sender` is the Settings window's own page: the only one the history's words are handed to. */
  isSettingsPage(sender: WebContents): boolean {
    const win = this.settingsWindow;
    return !!win && isPageOf(sender, win);
  }

  /** Opens System Settings at a privacy pane. With AVANZEL_TEST=1 it stays shut, and openedForTests says which pane it would have opened. */
  private openPane(kind: "input-monitoring" | "accessibility"): void {
    if (process.env.AVANZEL_TEST === "1") {
      this.opened.push(`System Settings → ${kind === "accessibility" ? "Accessibility" : "Input Monitoring"}`);
      return;
    }
    openPrivacyPane(kind);
  }

  /**
   * Runs the helper while the setting is on and a library is open, and has it watch the chosen key; stops it otherwise. Called at
   * launch (a library opens), whenever a library opens or closes, and when the setting changes.
   */
  private applyCursorDictation(): void {
    const { enabled, key } = this.store.get().cursorDictation;
    if (!enabled || !this.vault || this.quitting) return void this.stopCursorHelper();
    if (!this.cursorHelper) {
      this.cursorHelper = new CursorHelper({
        onTap: () => this.pressCursorDictation(),
        // Settings asks for the permissions itself (cursorPermissions), so a helper that can't watch the key is only logged here.
        onProblem: (message) => console.error("cursor helper", message),
      });
      this.cursorHelper.start(key);
    } else if (key !== this.cursorKey) {
      this.cursorHelper.setKey(key);
    }
    this.cursorKey = key;
  }

  /**
   * Stops the helper, and drops a dictation under way (nothing when there is none): one that listens would have no key to end it, and
   * one whose words are being made would paste them with the dictation turned off. Also for quitting.
   */
  async stopCursorHelper(): Promise<void> {
    const helper = this.cursorHelper;
    this.cursorHelper = null;
    this.cursorKey = null;
    this.cursor.cancel();
    await helper?.stop();
  }

  /** What a dictation's session (cursor-dictation.ts) uses of the app: the microphone, the clipboard, the helper and the capsule. */
  private cursorHost(): CursorHost {
    const helper = (): CursorHelper => {
      if (!this.cursorHelper) throw new Error("Dictating into any app is off.");
      return this.cursorHelper;
    };
    return {
      helper: { inspect: (keep) => helper().inspect(keep), sameWindow: () => helper().sameWindow(), paste: (text) => helper().paste(text) },
      clipboard: electronClipboard,
      startListening: () => this.startCursorRecording(),
      stopListening: () => this.stopCursorRecording(),
      cancelListening: () => this.cancelCursorRecording(),
      // One microphone: a thought recording or a call refuses a dictation. A thought being transcribed or filed holds no microphone.
      busy: () => (this.recording !== null && !this.recording.forCursor) || this.calls.running,
      browser: (target) => browserWindow(target.app.bundleId),
      // The open library's skip list (config.toml's [dictation]); without a library, the password managers. Settings that can't be
      // read throw, and the session then keeps nothing, as it can't tell what is to be skipped.
      skip: () => {
        const vault = this.vault;
        if (!vault) return { apps: DEFAULT_SKIP_APPS, sites: [] };
        const { skipApps, skipSites } = loadSettings(vault.root).dictation;
        return { apps: skipApps, sites: skipSites };
      },
      // The open library's day file, when its log is on. The writer keeps the library that was open when the words were kept, so one
      // opened while they are written doesn't receive them. The write is queued in the engine and never rejects (`logDictation`).
      logTo: () => {
        const vault = this.vault;
        if (!vault) return { enabled: false, write: () => undefined };
        return { enabled: loadSettings(vault.root).dictation.log, library: vault.root, write: (entry) => void logDictation(vault, entry) };
      },
      showCopyPrompt: (prompt) => {
        this.copyPromptText = prompt.text;
        this.fail(copyPromptProblem(prompt), "copy-dictation", "Copy");
        this.scheduleHide(COPY_PROMPT_MS); // after `fail`, whose `setCapsule` clears any hide that was set
      },
      say: (line) => this.sayForCursor(line),
      history: this.dictations,
      now: () => new Date(),
      newId: () => randomUUID(),
    };
  }

  /** The capsule listens for a dictation: as a thought would, without a file mode or hint. A thought already recording refuses it. */
  private async startCursorRecording(): Promise<boolean> {
    if (this.recording && !this.recording.forCursor) {
      this.sayForCursor("refused");
      return false;
    }
    return this.startRecording("dictate", undefined, { forCursor: true });
  }

  /** The dictation's second tap: its audio is asked for, and arrives at `heardForCursor`. */
  private stopCursorRecording(): void {
    if (this.recording?.forCursor) return void this.stopRecording();
    // The recording has gone already (a microphone that failed): the session would wait for words that never come.
    void this.cursor.heard(NO_WORDS);
  }

  /**
   * Drops the dictation: the recording, if it still listens or its audio is on the way, and the recognition of its words, whose result
   * is then thrown away (`heardForCursor`). When words were still to come, the session is told now that there are none, so that it
   * stops waiting for them and the next tap starts a dictation at once.
   */
  private cancelCursorRecording(): void {
    const recording = this.recording;
    let wordsToCome = this.cursorRecognising;
    if (recording?.forCursor) {
      wordsToCome ||= recording.stopping;
      this.abandonRecording(recording);
    }
    this.cursorGeneration += 1;
    this.cursorRecognising = false;
    if (wordsToCome) void this.cursor.heard(NO_WORDS);
  }

  /** The session's one-line answers: refused while something else records, nothing heard, or (Esc) the capsule goes. */
  private sayForCursor(line: "refused" | "nothing-heard" | "cancelled"): void {
    if (line === "nothing-heard") return this.fail(NOTHING_HEARD, "open-settings:voice", "Choose microphone");
    if (line === "cancelled") {
      // Only the dictation's own card: a thought that records has the capsule otherwise.
      const own = !this.recording || this.recording.forCursor;
      if (own && (this.capsuleState.kind === "listening" || this.capsuleState.kind === "transcribing")) this.setCapsule({ kind: "hidden" });
      return;
    }
    // The refusal is a bar for a moment. A thought that listens gets its card back after it, a call its own (`setCapsule`).
    const back = this.capsuleState;
    const thought = this.recording;
    this.setCapsule({ kind: "dictation-refused" });
    setTimeout(() => {
      if (this.capsuleState.kind !== "dictation-refused") return;
      const listening = back.kind === "listening" && thought !== null && this.recording === thought && !thought.stopping;
      this.setCapsule(listening ? back : { kind: "hidden" });
    }, NOTHING_TO_UNDO_MS);
  }

  // ---------------------------------------------------------------- calls

  /**
   * Notes on a call in `app`, or in everything the Mac plays (`CallNotes.start`): asked about once (CALL_CONSENT_DIALOG), then the call
   * app's sound and the microphone are taken until `stopCallNotes`. Refused while a recording runs, and while another call does.
   */
  async startCallNotes(app: CallApp | "everything"): Promise<boolean> {
    if (this.recording) return false;
    return this.calls.start(app);
  }

  /** Ends the call that runs, which becomes its capture and is filed as a thought is. Nothing while no call runs. */
  stopCallNotes(): Promise<void> {
    return this.calls.stop();
  }

  /** Makes the notes of a call whose folder (`<userData>/calls/<id>/`) was left over, as Stop would have (`CallNotes.finishCallFolder`). */
  async finishCallFolder(dir: string): Promise<void> {
    await this.calls.finishCallFolder(dir);
  }

  /** Stop, on the call's listening card. Only the capsule's own page is heard. */
  stopCall(sender: WebContents): Promise<void> {
    return isPageOf(sender, this.capsule) ? this.stopCallNotes() : Promise.resolve();
  }

  /**
   * A block of the call's microphone from the capsule page (only its own page is heard). With AVANZEL_FAKE_AUDIO the page records
   * nothing, and the fake recording stands in for the call's microphone at its end.
   */
  async onCallAudio(sender: WebContents, call: number, samples: Float32Array, last: boolean): Promise<void> {
    if (!isPageOf(sender, this.capsule)) return;
    const fake = process.env.AVANZEL_FAKE_AUDIO;
    this.calls.audio(call, fake && last ? await this.fakeAudio(fake) : samples, last);
  }

  private callHost(callsDir: string): CallHost {
    return {
      callsDir,
      audioTimeoutMs: AUDIO_TIMEOUT_MS,
      maxCallMs: MAX_CALL_MS,
      tapAvailable: () => !!process.env.AVANZEL_FAKE_CALLTAP || CallTap.available(),
      consented: () => this.store.get().callConsent,
      askConsent: async () => {
        stealFocus(); // a menu bar app isn't the frontmost app: the question would come up behind the others
        const { response } = await dialog.showMessageBox(CALL_CONSENT_DIALOG);
        if (response !== 0) return false;
        this.store.update({ callConsent: true });
        return true;
      },
      readyToListen: () => this.readyToListen(),
      newTap: (opts) => new CallTap(opts),
      transcriber: () => this.callTranscriber(),
      // The capture names the app as people know it ("Zoom", not its process "zoom.us").
      captureCall: async (call) => (await this.librarian()).captureCall(call.app ? { ...call, app: callAppLabel(call.app) } : call).path,
      listening: (startedAt) => {
        this.callCard = {
          kind: "listening",
          mode: "call",
          startedAt,
          fakeMic: !!process.env.AVANZEL_FAKE_AUDIO,
          microphoneId: this.store.get().microphoneId,
          fileMode: null, // a call is filed as the setting says: it has no switch of its own
          review: null,
          hint: null,
        };
        this.wake();
        this.setCapsule(this.callCard);
      },
      recording: () => this.recording !== null,
      microphone: (on, call) => {
        if (!on) this.callCard = null;
        this.capsuleCommand({ kind: on ? "call-start" : "call-stop", call });
      },
      refused: () => this.setCapsule({ kind: "call-running" }, NOTHING_TO_UNDO_MS),
      finishing: () => this.setCapsule({ kind: "transcribing", mode: "call", onThisMac: this.transcribesOnThisMac() }),
      filed: (capturePath, text, transcribedIn) => {
        this.captureCount.add();
        this.afterCapture(capturePath, text, transcribedIn);
      },
      failed: (problem, action, actionLabel) => this.fail(problem, action, actionLabel),
      notice: (line) => this.notify(line, ""),
      changed: () => this.refreshMenu(),
      // The notification is held by CallNotes until the call is finished or its folder is gone, so that its click stays alive.
      offerCutShort: (call, finish) => {
        const when = call.startedAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        const where = call.app ? ` in ${callAppLabel(call.app)}` : "";
        return this.notify(
          "Finish notes for a call that was cut short",
          `The call${where} from ${when} was cut short. Click to finish the notes. Your recording stays on this Mac until then.`,
          () => void finish(),
        );
      },
    };
  }

  /**
   * What the menu offers for calls (`MenuInput.callNotes`): Stop while one runs; Take notes when the Mac can tap a call, a library is
   * open, and no call starts or is being finished and no thought records; else nothing.
   */
  private callNotesOffer(): MenuInput["callNotes"] {
    const phase = this.calls.phase;
    if (phase === "running") return "running";
    const tappable = !!process.env.AVANZEL_FAKE_CALLTAP || CallTap.available();
    return tappable && this.vault && phase === "idle" && !this.recording ? "ready" : "off";
  }

  /**
   * How many calls cut short the menu offers to finish (`MenuInput.cutShortCalls`): those waiting (`CallNotes.cutShortCalls`), while a
   * library is open and no call starts, runs or is being finished and no thought records; else none, and the row is left out.
   */
  private cutShortOffer(): number {
    return this.vault && this.calls.phase === "idle" && !this.recording ? this.calls.cutShortCalls : 0;
  }

  /**
   * Take notes on a call…: a native menu under the menu bar icon offers each call app that runs (`runningCallApps`), then everything this
   * Mac plays, the only row when none runs; the one chosen starts the call (`startCallNotes`).
   */
  private async pickCall(): Promise<void> {
    const apps = await runningCallApps().catch((error: unknown) => {
      console.warn("call apps", error);
      return [];
    });
    trayChoice(this.menuBar.tray, [...apps.map((app) => callAppLabel(app.name)), "Everything this Mac plays"], (index) => {
      void this.startCallNotes(apps[index] ?? "everything");
    });
  }

  /**
   * The calls a quit or a crash left in <userData>/calls (`CallNotes.recover`), once a launch, as the first library opens: each with sound
   * in it is offered in a notification, and choosing it files its notes in the library that is open then.
   */
  private recoverCalls(): void {
    if (this.callsRecovered || !this.vault) return;
    this.callsRecovered = true;
    this.calls.recover();
  }

  /**
   * The library's transcriber for a call, or, with AVANZEL_FAKE_TRANSCRIPT, one that hears those words in each side of it. Either
   * corrects with the dictionary's heard-as entries only: a call keeps no record of what was heard (its audio goes once it is
   * written), so only the owner's own entries may change its words, never a sound-alike guess.
   */
  private async callTranscriber(): Promise<Transcriber> {
    const fake = process.env.AVANZEL_FAKE_TRANSCRIPT;
    const voice = loadSettings(this.requireVault().root).voice;
    if (fake === undefined) return this.speech.for(voice, { aliasesOnly: true });
    return fakeCallTranscriber(fake, voice);
  }

  // ---------------------------------------------------------------- filing

  /**
   * `detail`: a line the capsule shows under the words, e.g. why the recording itself wasn't kept. Words spoken in
   * `recording` that is setup's first spoken thought are setup's first (`setup.heard`), which files them now, whatever
   * the file mode. Any others are filed now or at the evening review as their recording's own file mode says (`toggleFileMode`);
   * words with no such mode (a typed thought's, or from a recording that has none to switch) as the setting says.
   */
  private afterCapture(capturePath: string, text: string, transcribedIn: number | null, detail?: string, recording?: Recording): void {
    if (recording && this.setup.heard(recording, capturePath, text, transcribedIn)) return;
    if ((recording?.fileMode ?? this.store.get().fileMode) === "evening") {
      this.setCapsule({ kind: "saved", text, note: this.savedLine(), ...(detail ? { detail } : {}) }, 4000);
      return;
    }
    const now = Date.now();
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
      startedAt: now,
      stepAt: now,
      detail,
    });
  }

  /**
   * Filing starts right away; Edit can stop it until it ends. While another run of the app's own has its queue (a filing, a
   * review, a take-back: one agent runs at a time), the card says it waits (`waiting`), as it does for the library's lock, until
   * its turn comes and `runFiling` starts the run (`startRun`): it is not working yet, and its seconds have not begun.
   */
  private beginFiling(job: FilingJob): void {
    if (this.queued > 0) job.waiting = true;
    // In the queue before the card shows: the menu is built as the card is set (`setCapsule`), and holds Undo back while a filing waits
    // (`undoableFiling`). The record itself is cleared by the run, when its turn comes (`runFiling`).
    this.queuedToFile.add(job.capturePath);
    job.queuedAlone = true;
    this.showFiling(job);
    void this.enqueue(() => this.runFiling(job));
  }

  private showFiling(job: FilingJob): void {
    this.job = job;
    job.estimate ??= this.estimateFor(job); // as its card first shows, so that it doesn't move as other filings end
    this.setCapsule(this.filingState(job, this.transcribesOnThisMac()));
  }

  /**
   * What the capsule's card says of `job`'s filing: its words, the steps the agent has taken, the seconds it has run for and
   * about how many it takes (`estimate`, fixed when the card first showed, `showFiling`), and that it is stopping once Stop was
   * pressed (`cancelling`, and no Edit then: `canEdit`). All of it is read from the job, so that a step or a wait that rebuilds
   * the state can't undo any of it. `onThisMac` is where the words were made, as the card first said (`transcribesOnThisMac`),
   * which a later state keeps rather than read the library's settings again at each step.
   */
  private filingState(job: FilingJob, onThisMac: boolean): FilingState {
    return {
      kind: "filing",
      text: job.text,
      agent: job.agent,
      transcribedIn: job.transcribedIn,
      onThisMac,
      canEdit: !job.cancelled, // `edit()` ignores a stopped job
      ...(job.detail ? { detail: job.detail } : {}),
      ...(job.waiting ? { waiting: true } : {}),
      rows: job.rows,
      startedAt: job.startedAt,
      estimate: job.estimate ?? DEFAULT_ESTIMATE_SECONDS, // set by showFiling, before any card shows
      stepAt: job.stepAt,
      ...(job.cancelled ? { cancelling: true as const } : {}), // Stop is the job's to remember: no step or wait takes it off the card
    };
  }

  /**
   * The card of `job`'s filing, if the capsule shows it, is sent what has changed since it was shown: the steps the agent has
   * taken (`filingStep`), a wait for the library that began or ended (`filingProgress`), or the start of the run (`runFiling`).
   * The card isn't shown again: the state is set and sent as it is, with no menu rebuilt, no hidden capsule brought back and no
   * hide timer started over (as `followDownload` does with the download's progress), where `setCapsule` does all three. A
   * filing whose card has gone (hidden, or replaced by a newer capture's, or by the editor) sends nothing; its steps are only
   * kept in its job, and it ends in a notification.
   */
  private refreshFiling(job: FilingJob): void {
    const state = this.capsuleState;
    if (this.job !== job || state.kind !== "filing" || this.capsule.isDestroyed()) return; // the window is gone as Avanzel quits
    this.capsuleState = this.filingState(job, state.onThisMac);
    this.capsule.webContents.send("capsule:state", this.capsuleState);
  }

  /**
   * About how many seconds a filing with `job`'s agent takes: what that agent's last filings in the open library took
   * (`estimateSeconds`), 15 until it has done three. Best effort: a run state that can't be read gives the 15.
   */
  private estimateFor(job: FilingJob): number {
    try {
      const harness = this.harnessFor(job.harness);
      return estimateSeconds(this.vault && harness ? durationsOf(this.readRunState(this.vault).durations, harness) : []);
    } catch (error) {
      console.warn("filing estimate", error);
      return estimateSeconds([]);
    }
  }

  /**
   * `job`'s filing ended well, in `seconds` from when its run had the library: they are kept with the agent that ran it (never
   * "auto", `harnessFor`), in the run state of `library` (the one the note was filed in), as the last of its filings, for the
   * estimate of the next. Best effort: a run state that can't be written (the app's data folder is read-only) loses a duration,
   * and never fails the filing. The receipt's seconds are the wall clock's, whatever they are; the ones kept are not.
   */
  private keepDuration(job: FilingJob, library: Vault | null, seconds: number): void {
    const harness = this.harnessFor(job.harness);
    if (!library || !harness) return;
    if (seconds > this.timeoutSeconds(library)) return; // no run outlasts its timeout, the engine stops it: more was a sleep
    try {
      const state = this.readRunState(library);
      this.writeRunState(library, { ...state, durations: withDuration(state.durations, harness, seconds) });
    } catch (error) {
      console.warn("filing duration", error);
    }
  }

  /**
   * What the engine says of `job`'s filing: `WAITING` while another run (a question, a review, another
   * Avanzel) has the library, then the start of its own run. Its card, or the setup window, shows the wait
   * until the run starts; the card's seconds, and those kept for the estimate, then count from that start.
   */
  private filingProgress(job: FilingJob, message: string): void {
    const waiting = message === WAITING;
    if (!!job.waiting === waiting) return;
    job.waiting = waiting;
    if (waiting) {
      this.refreshFiling(job);
      this.refreshTray(); // a hidden filing that waits again counts no seconds
    } else {
      this.startRun(job);
    }
    this.setup.waiting(job, waiting);
  }

  /**
   * `job`'s seconds start now, as its run has the library (the wait for it, in the queue or at the engine's lock, is no
   * filing's time), and its card, if it shows, is told. The wait for its turn in the queue (`beginFiling`) is over. Before its
   * first step, the agent is as quiet as it ever was.
   */
  private startRun(job: FilingJob): void {
    job.waiting = false;
    job.startedAt = Date.now();
    job.stepAt = job.startedAt;
    this.refreshFiling(job);
    this.refreshTray(); // a hidden filing counts from here
  }

  /**
   * A step the agent takes in a filing, told as it takes it (`file`'s `steps`): it joins the filing's rows, and the pages
   * written, which setup's shelf tabs count. Setup's window, if it still shows the filing, is sent them (`setup.stepped`), and
   * the capsule's card, if it does (`refreshFiling`), by `tell`, which spaces the sends out (`stepThrottle`). `root` is the
   * note's own library's, which the steps' paths are in and the pages are titled from, whichever library is open by then.
   * Narration is best effort: what goes wrong here is noted, and never fails the filing.
   */
  private filingStep(job: FilingJob, step: FilingStep, root: string, tell: StepThrottle): void {
    try {
      job.written = withWritten(job.written, step);
      job.rows = withStep(job.rows, step, (rel) => rowPage(root, rel));
      job.stepAt = Date.now();
      if (this.setup.owns(job)) this.setup.stepped(job);
      else tell();
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
    this.refreshTray(); // the face thinks, and a hidden filing's count begins: `runs` is what both read
    try {
      return await running;
    } finally {
      this.runs.delete(abort);
      this.refreshTray();
    }
  }

  private async runFiling(job: FilingJob): Promise<void> {
    this.queuedToFile.delete(job.capturePath); // its turn: should it not file the capture, a review may
    // The face thought of it while it waited. A filing that ends below, stopped or with its note gone, has no run to show that it doesn't.
    this.refreshTray();
    delete job.queuedAlone; // a Stop from here on waits for the run (`cancelFiling`)
    if (job.abort.signal.aborted) return this.leftWithoutRun(); // Edit, Cancel in setup or Stop in the capsule stopped it before its turn came
    if (!existsSync(job.capturePath)) {
      this.noteGone(job); // already filed meanwhile (e.g. by another Avanzel on this library)
      return this.leftWithoutRun();
    }
    const library = this.vault; // the note's own: another library may open while the agent runs
    if (library) job.library = library; // kept with the job: its card's Undo takes the filing back there, whichever library is open by then (`undo`)
    // Its run begins: the filing before it is not the last any more, whatever becomes of this one (it may fail, or be taken back). It is set
    // before the clearing, whose rebuild of the menu is the one that the run's start makes (the steps build none): it must already hide the
    // receipt, or the item would stand for the whole run (`filingRun`).
    this.filingRun = job;
    this.clearLastFiled();
    this.startRun(job); // its turn: the seconds count from here, not from when the queue took it in
    let outcome: FileOutcome | undefined;
    const progress = (message: string) => this.filingProgress(job, message);
    // Every filing that has a card or a window is narrated: setup's first thought tells its window, a capsule filing its card.
    // One in the background has neither. A card is sent the steps at the pace `stepThrottle` keeps.
    const tell = stepThrottle(() => this.refreshFiling(job));
    const steps = job.background || !library ? null : (step: FilingStep) => this.filingStep(job, step, library.root, tell);
    try {
      [outcome] = await this.withRun(
        async (signal) => (await this.librarian(job.harness)).file([job.capturePath], { signal, progress, ...(steps ? { steps } : {}) }),
        job.abort,
      );
    } catch (error) {
      this.filingRun = null; // before anything is shown: the card or notification that tells the failure builds the menu
      if (job.edited || job.cancelled || this.quitting) return;
      return this.filingFailed(job, error, undefined, library);
    } finally {
      this.filingRun = null; // the run is over, whichever way: the card, window or notification that tells it comes after
      tell.cancel(); // the run is over: the state that ends it is shown at once, and no step is left to tell
    }
    job.outcome = outcome;
    // Edit takes back what this run did (`refile`), and so does Cancel in setup (`cancelSetupFiling`) and Stop in the capsule
    // (`settleStop`). Except a filing that Stop or Cancel caught as it filed, with no commit to take back: it stands (`afterStop`), and
    // is shown filed, in the capsule or in setup's window.
    const stopped = job.cancelled && afterStop(outcome) === "take-back";
    if (job.edited || stopped || this.quitting) return;
    const seconds = Math.max(0, (Date.now() - job.startedAt) / 1000);
    // No outcome at all: the capture left the inbox while the run waited for the library, and another Avanzel filed it. As when
    // the note was gone before the run's turn, setup's window says so while it is open, and there is nothing else to tell: the
    // agent didn't stop without filing, and its card or notification would say that, and that the note is in the inbox.
    if (!outcome || !library) {
      this.noteGone(job); // (an outcome comes from a run made with `library`: this only narrows its type)
      // The menu is built again: with no card to show (its card was put away, or it was in the background) nothing else builds it, and it was
      // last built while the run went on, which held the last receipt back (`filingRun`).
      return this.refreshMenu();
    }
    if (!outcome.ok) return this.filingFailed(job, outcome.error || outcome.message || "The agent stopped without filing.", outcome, library);
    // The pages are the note's own library's, the one it was filed in. The menu lists the open library's recent pages, so it
    // takes them only while that library is the open one: not once it has closed, or another has opened.
    const pages = filedPages(library.root, outcome.changes);
    job.pages = pages;
    // What the person is told of this filing, kept to be told again (`showLastReceipt`). A job in the background has no words of its own
    // (`fileInBackground`): they are those of the capture the engine archived. Setup's first thought has none, as it has an Undo of its own.
    const receipt: FilingReceipt | null = job.setup
      ? null
      : {
          commit: outcome.commit,
          text: job.text || captureWords(outcome.archivedTo ?? ""),
          agent: job.agent,
          seconds,
          pages,
          noted: pages.length === 0,
          restored: outcome.restored,
          filedAt: Date.now(),
        };
    if (this.vault?.root === library.root) {
      this.recent = [...pages, ...this.recent.filter((p) => !pages.some((q) => q.path === p.path))].slice(0, 3);
      this.countFiled(library.root); // the run wrote its line in the log; the menu is built once below, as before
      // The menu's Undo takes this filing back, if the run left a commit to take back. Setup's first thought has an Undo of its own, in its window.
      if (outcome.commit && !job.setup) this.lastFiled = { commit: outcome.commit, library: library.root, job };
      if (receipt) this.lastReceipt = receipt;
    }
    // Kept with the note's own library, open or not: it is offered again whenever that library opens (`openLibrary`). A filing that ends
    // while Avanzel quits returned above, before this, and its start has cleared the record before it: a quit loses that Undo. A filing that
    // failed, was stopped or was gone returned above too, and leaves the receipt as it was.
    if (receipt) this.undoRecords.patch(library.root, outcome.commit ? { filing: outcome.commit, receipt } : { receipt });
    this.keepDuration(job, library, seconds);
    this.noteFiled((capture) => capture === job.capturePath);
    // Setup's thought is filed, which counts whether its window is still there to show it or has closed (§5.4).
    if (job.setup) this.firstRun.filed(new Date());
    this.markFiled(); // whichever card, window or notification tells it
    if (this.setup.owns(job)) {
      this.setup.filed(job, outcome, job.pages);
    } else if (this.job === job && this.capsuleState.kind === "filing") {
      this.setCapsule(
        {
          kind: "filed",
          text: job.text,
          agent: job.agent,
          seconds,
          pages: job.pages,
          canUndo: !!outcome.commit,
          // It ended well and wrote no page: the agent only logged the capture, as it does one that needs none.
          noted: job.pages.length === 0,
          // The agent changed the capture and the engine put the person's words back: the card says they are kept. Absent when it didn't.
          ...(outcome.restored ? { restored: true as const } : {}),
        },
        FILED_SHOW_MS,
      );
    } else {
      const first = job.pages[0];
      this.notify(`Filed by ${job.agent}`, first ? `${first.title} (${first.shelf})${job.pages.length > 1 ? ` and ${job.pages.length - 1} more` : ""}` : outcome.message, () => first && this.openPage(first.path));
    }
    this.refreshMenu();
    this.askChanged(); // the shelves hold its pages: an Ask window in front reads again, as the capsule never takes its key
  }

  /**
   * `job`'s filing failed. `error` is what the run threw, or for a run that came back without filing the line that says why,
   * and `outcome` is then the run's own, with the engine's classification of the failure and what the run left behind. The
   * capsule's card says what happened and what is safe, and offers the one fix (`cardFix`). That is the card of this job's
   * filing or, when a wait's or the watch's filing in the background finds the card of the note's earlier failure still up
   * (`cardCapture`), that card, replaced: left as it is, it would promise what is not so now. With no card of the note, a
   * notification says the same. Setup's window tells it in its own, with the failure and what the run left behind
   * (`setup.failed`): setup starts no wait and no watch, so it says to try again. A note gone from the inbox is no failure
   * (`noteGone`). What the words promise of a usage limit or a missing sign-in, the app has set up first (`keepPromise`): when
   * it set up nothing, they promise only the evening review (`unwatched`). `library` is the one the note was filed in, whose
   * evening review tries again: another may have opened while the agent ran, and a note of a library that isn't open is waited
   * for by nothing, and has no button that files it again, which would look for it in the open library.
   */
  private filingFailed(job: FilingJob, error: unknown, outcome?: FileOutcome, library: Vault | null = this.vault): void {
    const harness = this.failedHarness(job.harness, error);
    const failure = this.agentFailure(harness, error, outcome?.failure ?? null);
    const partial = leftBehind(outcome);
    if (this.setup.owns(job)) return this.setup.failed(job, failure, partial);
    const now = new Date();
    const options: FilingProblemOptions = {
      ...(outcome?.savedOriginal ? { where: outcome.savedOriginal } : {}),
      partial,
      eveningReview: this.eveningReviewOn(library),
      lineMax: CAPSULE_LINE_MAX, // the card is a notice in a small panel, and the notification says the same words
    };
    const unkept = unwatched(failure, now, options);
    const kept = this.keepPromise(job, failure, harness, now, unkept);
    const problem = kept === null ? unkept : filingProblem(failure, now, options);
    if ((this.job === job && this.capsuleState.kind === "filing") || this.cardCapture === job.capturePath) {
      const fix = this.cardFix(failure, harness);
      const offered = fix?.action.startsWith("refile:") && !this.inOpenInbox(job.capturePath) ? null : fix;
      this.fail(problem, offered?.action, offered?.label, job.capturePath, kept === "wait" ? unkept : undefined);
    } else {
      this.notify(problem.title, problem.body);
    }
    this.refreshMenu();
  }

  /** Whether the note at `capture` waits in the open library's inbox: only such a note is waited for, or filed again by a button. */
  private inOpenInbox(capture: string): boolean {
    return this.vault?.pending().includes(capture) ?? false;
  }

  /**
   * The harness a failed run was for, by name ("claude"): the one its error names (an agent that is gone), else `chosen`, the
   * harness the run was asked to use, or on "auto" the one selected now. Null when there is no agent to name.
   */
  private failedHarness(chosen: string, error: unknown): string | null {
    if (error instanceof NoAgentError && error.agent) return error.agent;
    return this.harnessFor(chosen);
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
    if (failed?.capturePath !== capturePath || !this.inOpenInbox(capturePath)) return this.setCapsule({ kind: "hidden" });
    const now = Date.now();
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
      startedAt: now,
      stepAt: now,
    });
  }

  /**
   * Whether the evening review of `vault` (the open library, unless given) is on: what a failed note's "the evening review will
   * try again" relies on.
   */
  private eveningReviewOn(vault: Vault | null = this.vault): boolean {
    return !!vault && this.safeTasks(vault).some((task) => task.kind === "evening-review" && task.enabled);
  }

  /**
   * What the capsule says of a thought saved for the evening review to file (`savedNote`): when the open library's review runs,
   * while it is on; only that the thought is saved, while it is off.
   */
  private savedLine(): string {
    return savedNote(this.openReview());
  }

  /**
   * The evening review of the open library (or of `vault`, a recording's own) while it is on, its schedule as main sends it
   * ("daily 21:00"): what the capsule words of it. Null while it is off.
   */
  private openReview(vault: Vault | null = this.vault): { schedule: string; enabled: boolean } | null {
    const review = vault ? this.safeTasks(vault).find((task) => task.kind === "evening-review" && task.enabled) : undefined;
    return review ? { schedule: formatSchedule(review.schedule), enabled: true } : null;
  }

  /** How long a library lets an agent run, in seconds: the open library's unless `vault` (a note's own) is given. */
  private timeoutSeconds(vault: Vault | null = this.vault): number {
    try {
      return (vault ? loadSettings(vault.root) : defaultSettings()).timeoutSeconds;
    } catch {
      return defaultSettings().timeoutSeconds;
    }
  }

  // ---------------------------------------------------------------- notes that wait for a limit or a sign-in

  /**
   * What the words of a failed filing are to promise, the app sets up first, and says what it set up: "wait", "watch", or null
   * for neither, when the words promise only the evening review (`unwatched`). A usage limit whose reset is still to come is a
   * wait for it (`addWait`), kept in the run state: the words say the note "will be filed then". A sign-in that Claude Code or
   * Codex asks for is a watch of the agent's free sign-in check (`watchSignIn`): the note "will be filed straight away", and
   * `unkept` is what its card says once the watch ends. Only a note that waits in the open library's inbox is waited for, and a
   * wait the run state can't keep (it can't be written) is none. Any other failure promises only the evening review. Neither
   * goes round without end: a reset that has passed arms no wait, a note that a wait filed and the limit stopped again waits
   * only for a later reset, and a note that the watch filed and that still can't sign in starts no new watch.
   */
  private keepPromise(job: FilingJob, failure: AgentFailure, harness: string | null, now: Date, unkept: Problem): "wait" | "watch" | null {
    if (harness === null || !this.inOpenInbox(job.capturePath)) return null;
    try {
      if (failure.kind === "limit" && failure.resetsAt !== null && failure.resetsAt > now.getTime()) {
        const until = failure.resetsAt + resetMarginMs();
        if (job.background?.by === "wait" && until <= job.background.until) return null;
        this.addWait(job.capturePath, harness, until);
        return "wait";
      }
      if (failure.kind === "signin" && failure.command !== null && job.background?.by !== "watch") {
        this.watchSignIn(harness, job.capturePath, unkept);
        return "watch";
      }
    } catch (error) {
      console.error("what a failed filing promised", error); // nothing is promised then: the evening review still has the note
    }
    return null;
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
    const now = Date.now();
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
      startedAt: now,
      stepAt: now,
      background,
    };
    this.queuedToFile.add(capturePath);
    // The menu is built as the note joins the queue: it holds back what a waiting filing hides (`undoableFiling`, `receiptShowable`), and no
    // card is set here to build it (`setCapsule`). Its run's start builds none when no filing is held (`clearLastFiled`). It sets the face too.
    this.refreshMenu();
    void this.enqueue(async () => {
      const waiting = this.vault?.pending().includes(capturePath);
      if (waiting && !this.editing.has(capturePath)) return this.runFiling(job);
      this.queuedToFile.delete(capturePath);
      this.refreshTray();
      if (!waiting) this.noteGone(job);
      this.leftWithoutRun();
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
   * A filing that waited in the queue (`queuedToFile`) is out of it with no run: it was stopped before its turn, or its note was filed
   * meanwhile, or is in the editor. While it waited the menu held Undo back (`undoableFiling`) and the last receipt (`receiptShowable`);
   * the last filing, which this one never touched, can be undone again and its receipt shown, and the menu is built again to offer them,
   * if there is any. The face is shown again by the caller.
   */
  private leftWithoutRun(): void {
    if (this.lastFiled !== null || this.lastReceipt !== null) this.refreshMenu();
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
    // A sign-in its command doesn't tell (`unknown`: the look may not ask the model, which costs the person's usage) can't be
    // seen to change, so no look will file the note: the watch ends now, and its card stops promising.
    const unreadable = check !== null && !check.ok && check.why === "unknown";
    if (!watch.notes.size || unreadable || Date.now() >= watch.endsAt || this.quitting || this.checksStopped) return this.unwatch(agent);
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
   * `agent`'s watch ends with its notes unfiled: its length is up, its look can't read the sign-in, or the library they are in
   * has closed. A card that still shows one of them said that it would be filed straight away, which nothing will do now. It
   * says what is so instead (`unwatched`), and keeps its button. Not while Avanzel is quitting, which ends every watch.
   */
  private unwatch(agent: string): void {
    const watch = this.signInWatches.get(agent);
    this.endSignInWatch(agent);
    const card = this.cardCapture;
    const state = this.capsuleState;
    const unkept = card === null ? undefined : watch?.notes.get(card);
    if (card === null || !unkept || this.quitting || this.checksStopped || state.kind !== "error" || state.message !== unkept.title) return;
    this.fail(unkept, state.action, state.actionLabel, card);
  }

  /**
   * The open library closes, or Avanzel quits: its waits' timer and the sign-in watches of its notes end (`unwatch`), and a
   * failure card of one of its notes says only what is still so (`unkeepCard`). Its waits are kept.
   */
  private dropLibraryTimers(): void {
    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.waitTimer = null;
    for (const agent of [...this.signInWatches.keys()]) this.unwatch(agent);
    this.unkeepCard();
  }

  /**
   * The library a failure card's note waits in closes, as another opens. The note's wait is that library's, and files it only
   * while that library is open: a card that said the note "will be filed then" says what it does without the promise
   * (`cardUnkept`). Its refile: button goes too, since it files a note of the open library, and would only close the card.
   * A sign-in card has been rewritten by `unwatch`, and keeps its Open Terminal. Not while Avanzel is quitting.
   */
  private unkeepCard(): void {
    const card = this.cardCapture;
    const state = this.capsuleState;
    if (card === null || this.quitting || this.checksStopped || state.kind !== "error") return;
    const unkept = this.cardUnkept;
    const refile = state.action?.startsWith("refile:") ?? false;
    if (!unkept && !refile) return;
    // No command to carry: this card either promised a filing at a limit's reset (`unkept`), or has a refile button to lose, and only a
    // sign-in names a command, whose button opens Terminal and whose words `unwatch` rewrites.
    const words: Problem = unkept ?? { title: state.message, body: state.detail ?? "" };
    this.fail(words, refile ? undefined : state.action, refile ? undefined : state.actionLabel, card);
  }

  /**
   * Stops the agent at once and shows the words; Submit or Cancel then takes back what it did
   * (`refile`). Not while quitting: the editor would close with the app, and its words with it. Nor once Stop has stopped the
   * filing (`cancelFiling`): the card is on its way to Stopped, and the editor would open on a note that is being taken back.
   */
  edit(): void {
    const job = this.job;
    if (!job || job.edited || job.cancelled || this.quitting || this.capsuleState.kind !== "filing") return;
    job.edited = true;
    job.abort.abort();
    this.editing.add(job.capturePath);
    this.inEditor = job;
    this.setCapsule({ kind: "editing", text: job.text });
  }

  /**
   * Stop, on the card of a filing: its agent is stopped at once, and once the stopped run is over (queue order) what it did is
   * taken back and the card says it is Stopped (`settleStop`), as Cancel does in setup (`cancelSetupFiling`). The note stays in
   * the inbox. Until then the card says it is stopping and offers no Edit (`cancelling`, `canEdit`, which `filingState` reads from
   * the job, so no step or wait takes them off): that can be a while, as a filing in the wait for the library can't leave it.
   * A filing whose run still waits for its turn in the app's queue, queued alone (`queuedAlone`), is Stopped at once instead: nothing
   * has touched its note, so there is nothing to take back, and its turn, when it comes, does nothing (`runFiling` finds it stopped).
   * Waiting behind every run ahead of it would leave the card stopping for as long as those take, though nothing of its own runs.
   * Only the capsule's own page is heard (`sender` is the page the message came from, `event.sender`), and only while it shows a
   * filing that neither Stop nor Edit has taken yet: a second Stop does nothing, nor does one after Edit, or once the filing is
   * filed. Not while quitting, which has stopped every run already.
   */
  cancelFiling(sender: WebContents): void {
    const job = this.job;
    if (!isPageOf(sender, this.capsule) || !job || job.cancelled || job.edited || this.quitting || this.capsuleState.kind !== "filing") return;
    job.cancelled = true;
    job.abort.abort();
    if (job.queuedAlone) {
      const review = reviewTime(this.openReview());
      this.setCapsule({ kind: "cancelled", text: job.text, agent: job.agent, partial: false, leftovers: 0, review }, STOPPED_SHOW_MS);
      return;
    }
    this.refreshFiling(job);
    void this.enqueue(() => this.settleStop(job));
  }

  /**
   * The run of `job`, which Stop stopped, is over (this was queued behind it, so `job.outcome` is what it left), and the stop
   * ends. A run that had filed with no commit to take back stands (`afterStop`): `runFiling` has shown it filed already. Anything
   * else is taken back, which puts the words in the inbox, and the capsule says Stopped: `partial` when taking it back failed
   * (what the run did stays as its own commit), and `leftovers`, how many files it changed that no commit holds. A finished
   * filing that git refuses to take back stays filed, and the card says Stop couldn't take it back (`stopRefused`), never that the
   * words are back in the inbox. A card that has gone meanwhile (hidden, or replaced by a newer capture's) is left as it is, and
   * a notification says the same when there is something to tell (`stoppedNotice`): the filing stands, or the run's edits stay.
   * `runFiling` shows no Filed card or notification once Stop was pressed, so for a filing that stands this is the only word.
   */
  private async settleStop(job: FilingJob): Promise<void> {
    if (afterStop(job.outcome) === "filed") return;
    const problem = await this.takeBack(job);
    const showing = this.job === job && this.capsuleState.kind === "filing";
    if (problem !== null && job.outcome?.ok) {
      if (showing) this.fail(stopRefused);
      else this.notify(stopRefused.title, stopRefused.body);
      return;
    }
    const partial = problem !== null;
    const leftovers = unrecordedEdits(job.outcome);
    const review = reviewTime(this.openReview());
    if (showing) {
      this.setCapsule({ kind: "cancelled", text: job.text, agent: job.agent, partial, leftovers, review }, STOPPED_SHOW_MS);
      return;
    }
    // The card has gone, which would have built the menu, and a notification builds nothing. It was last built while the stopped run went on,
    // which held the last receipt back (`filingRun`), and a take-back builds it only when git refuses (`takeBack`).
    this.refreshMenu();
    const notice = stoppedNotice(job.agent, partial, leftovers, review);
    if (notice) this.notify(notice.title, notice.body);
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
    const now = Date.now();
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
      startedAt: now,
      stepAt: now,
      correction: correction ?? job.correction,
    };
    if (this.queued > 0) next.waiting = true; // behind the stopped run, if it is not over: as `beginFiling` says
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
        this.fail(takeBackRefusedProblem(existsSync(next.capturePath), this.eveningReviewOn()));
      }
    });
  }

  /**
   * The corrected words of `job` (File after Edit) couldn't be written to the inbox yet. That isn't an agent's failure, so
   * the card is its own, with Hide alone: another try would file the misheard capture. A capsule that no longer shows `job`
   * gets a notification with the same words. `originalKept`: the note they correct is still in the inbox.
   */
  private correctedWordsNotSaved(job: FilingJob, error: unknown, originalKept: boolean): void {
    const problem = correctedWordsProblem(lastLines(errorMessage(error)), originalKept, CAPSULE_LINE_MAX);
    if (this.job === job && this.capsuleState.kind === "filing") this.fail(problem);
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
        // The edit stays in `kept`, so quitting saves it. The words are the card's, which says the same when File can't write them.
        const problem = correctedWordsProblem(lastLines(errorMessage(error)), existsSync(job.capturePath), CAPSULE_LINE_MAX);
        this.notify(problem.title, problem.body);
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
    this.forgetFiling(commit); // before the first await: the menu doesn't offer a commit that is being taken back
    let why: string | null;
    try {
      why = (await (await this.librarian()).undo([commit])) === 1 ? null : "Git refused to undo it; see the library's history.";
    } catch (error) {
      why = errorMessage(error);
    }
    if (why !== null) console.warn("take back", why);
    // The menu's view of the log is read again. A take-back that git refused leaves the filing standing, in the log, and the run that
    // Stop or Edit cut short returned before it counted it (`runFiling`).
    this.readLog();
    if (why !== null) this.refreshMenu(); // the card or notification that tells the refusal may be a notification, which builds nothing
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
   * Undo, on the capsule's filed card, in the menu or in setup: once the queue gets to it, git takes back `commit`, a filing's, which
   * puts its capture back in the inbox. Whether it did; either way the menu's recent pages are read again (those of the library that is
   * open by then). The menu stops offering `commit` as the last filing as soon as it is asked for, whoever asks: it is taken back once.
   * It takes back in the library it was asked in, through a librarian made for that library (`librarianFor`), whichever library is open
   * when the queue gets to it: the person asked to undo that filing there. That is the open library, and it throws, as `librarian()` does,
   * when none is open, unless `library` says which: the card's Undo (`undo`) asks in the library its filing was made in (`FilingJob.library`),
   * and its card may be up after another library has opened. It is taken as the Undo is asked for, before the queue.
   */
  private async revertFiling(commit: string, library: Vault = this.requireVault()): Promise<boolean> {
    this.forgetFiling(commit, library.root); // before the first await: the menu doesn't offer a commit that is being taken back
    this.reverting.add(commit); // from before it waits in the queue until it lands: a reprint's Undo of this commit does nothing meanwhile
    try {
      return (await this.enqueue(async () => (await this.librarianFor(library)).undo([commit]))) === 1;
    } finally {
      this.reverting.delete(commit);
      this.readLog();
    }
  }

  /**
   * Undo, on the capsule's filed card: git takes the filing's commit back in queue order (`revertFiling`), which puts its capture
   * back in the inbox, and the card says so, over the person's words and where they wait now (`saved` with `undone`, and the note
   * `undoneNote` words). When git refuses, or the revert fails, it says that this one can't be undone automatically (`undoRefused`).
   * It answers once for a filing (`undoing`), as setup's Undo does: a press while the first runs, or after it, does nothing. A second
   * revert of the same commit would find it taken back already, and git would refuse it, which would turn the Undone card into the
   * refusal. The commit may be being taken back by someone else (`reverting`: the menu's Undo or the shortcut, whose record was loaded
   * without this job when its library opened again while the card was up): the card asks for nothing then, and that take-back tells it
   * (`tellUndone`). It answers only while the filed card of the newest filing is up, which is the one that offers it. The revert waits
   * its turn in the queue, and a newer card may be up by the time it lands: a recording's (which goes on recording, since its recorder is
   * the page's), or a newer filing's editor, which a card put over it would close under the person's typing. So its card replaces only
   * the filed card it was pressed on, and over any other card a notification says the same. It takes the filing back in the library the
   * filing was made in (`FilingJob.library`), which may not be the open one: the card stays up across a library switch, and a filing
   * that ends after one puts up its card all the same.
   */
  async undo(): Promise<void> {
    if (this.reprint) return this.undoReprint(this.reprint);
    const job = this.job;
    const commit = job?.outcome?.commit;
    if (!job || !commit || job.undoing || this.reverting.has(commit) || this.capsuleState.kind !== "filed") return;
    job.undoing = true;
    const undone = await this.revertFiling(commit, job.library).catch((error) => {
      console.warn("undo", error); // a revert that threw is a refusal to the card: it would otherwise wait on its Undo for ever
      return false;
    });
    this.tellUndone(undone, commit);
  }

  /**
   * Undo, on a reprint of the last receipt (`showLastReceipt`). The reprint has no job to guard it with (`undoing`), and after a relaunch
   * there is none at all, so it asks what the take-back of its commit is doing:
   * - It is being taken back already (`reverting`: the menu's Undo of the same filing waits for the queue or the library): nothing is
   *   asked for, and that take-back tells this card when it lands (`tellUndone`), once. Told here too, the refusal would come first and
   *   the take-back would then land as a notification: told twice.
   * - The menu still offers it: this is the menu's Undo (`undoLastFiling`), and tells this card when it lands.
   * - Otherwise a review that wrote, or a take-back that is over, has ended the offer since the card was drawn: the card says it can't be
   *   undone, so that its busy Undo doesn't wait for ever.
   */
  private async undoReprint(reprint: FilingReceipt): Promise<void> {
    const { commit } = reprint;
    if (commit !== null && this.reverting.has(commit)) return;
    if (this.offersUndoOf(commit)) return this.undoLastFiling();
    this.fail(undoRefused);
  }

  /**
   * Undo the last filing, from the menu: the filing the menu offers (`lastFiled`, `undoableFiling`) is taken back as the card's Undo
   * does it (`revertFiling`), and the person is told once (`tellUndone`): on the filed card of that filing, if the capsule shows it,
   * else by notification. It answers only while the menu offers it, and not for a filing whose card is taking it back already
   * (`undoing`). The filing is taken before the first await, so a second press, the card's Undo and the menu all find it gone, and the
   * revert is asked for once. That is its only try: a filing that git refuses to take back stands, and is not offered again.
   */
  async undoLastFiling(): Promise<void> {
    const last = this.lastFiled;
    if (!last || !this.undoableFiling() || last.job?.undoing) return;
    if (last.job) last.job.undoing = true;
    this.forgetFiling(last.commit);
    const undone = await this.revertFiling(last.commit).catch((error) => {
      console.warn("undo", error); // a revert that threw is a refusal, as it is on the card
      return false;
    });
    this.tellUndone(undone, last.commit);
  }

  /**
   * The Undo shortcut is pressed, in any app. It does nothing in three cases:
   * - Setup's window is open: the first thought it shows has an Undo of its own on screen, and a bar over that window would contradict it.
   * - A take-back is in flight (`reverting`): it has taken the filing already, so a second press would find none to undo and put the bar
   *   over the very card the first take-back is about to turn to Undone. The first tells the person, once.
   * - An answer is being saved (`savesGoing`): a filing that ended while the save waited is not offered (`undoableFiling`), and a bar that
   *   says there is none to undo would be wrong about it. As during a review, nothing happens.
   * With a filing to undo (`undoableFiling`) it is the menu's Undo (`undoLastFiling`): one try, told once on the filed card of that filing
   * or else by a notification, even while a recording runs (`notify` makes it silent then). With none, a bar says so for
   * `NOTHING_TO_UNDO_MS`, but not while the open library's saved Undo is still being checked (`undoChecked`: a filing may be about to be
   * offered, and the menu waits for the check too), and only when the capsule is free for a reply (`capsuleFreeForReply`): not once Avanzel
   * is quitting, while a filing or a review goes on or a thought is in flight (a refile whose card is hidden too), nor over a card that is
   * not finished: a recording, an editor, a problem with its fix, a Stopped card that says edits stay, a Saved card with a line about its
   * recording. The bar replaces a finished card.
   */
  private pressUndoShortcut(): void {
    if (this.setup.isOpen() || this.reverting.size > 0 || this.savesGoing > 0) return;
    if (this.undoableFiling()) return void this.undoLastFiling();
    if (this.vault !== null && !this.undoChecked()) return;
    if (!this.capsuleFreeForReply()) return;
    this.setCapsule({ kind: "nothing-to-undo" }, NOTHING_TO_UNDO_MS);
  }

  /**
   * How an Undo of the filing of `commit` ended, told once, whoever asked for it (the filed card, a reprint of it, or the menu): it worked
   * (`undone`), or git refused it, or the revert threw. The filed card of that filing, if the capsule still shows it, turns to Undone or to
   * the refusal: the reprint when the capsule shows one and it is of this commit, else the newest filing's card when its commit is this
   * one. The card is found by its commit and not by the job that asked, so that the first take-back to land, from wherever, turns it: the
   * menu's Undo of a filing whose library opened again while its card was up has no job of that card's (`openLibrary` loads the record
   * from disk), and a card that it left alone would offer a second take-back that git refuses. A newer card the person is using (a
   * recording's, or an editor) is left as it is, and a notification says the same over it, and when the card has gone (silent while a
   * recording runs, as the shortcut's Undo may be pressed mid-dictation: `notify`). The menu is built again for what the revert left; a
   * card does that by itself (`setCapsule`), a notification not.
   */
  private tellUndone(undone: boolean, commit: string): void {
    // The filed card the capsule shows: the reprint when one does, else the newest filing's. It is this filing's when its commit is `commit`,
    // and `shown` is then its words.
    const reprint = this.reprint;
    const job = this.job;
    const card = this.capsuleState.kind !== "filed" ? null : reprint ?? (job ? { commit: job.outcome?.commit, text: job.text } : null);
    const shown = card !== null && card.commit === commit ? card.text : null;
    if (!undone) {
      if (shown !== null) this.fail(undoRefused);
      else this.notify(undoRefused.title, undoRefused.body);
    } else {
      const note = undoneNote(this.openReview());
      if (shown !== null) this.setCapsule({ kind: "saved", text: shown, note, undone: true }, 3500);
      else this.notify("Undone", note);
    }
    if (shown === null) this.refreshMenu();
  }

  /** The pages the capsule's filed card lists: the reprint's while one shows, else the newest filing's. */
  private shownPages(): FiledPage[] | undefined {
    return this.reprint ? this.reprint.pages : this.job?.pages;
  }

  openFiled(): void {
    const page = this.shownPages()?.[0];
    if (page) this.openPage(page.path);
    this.setCapsule({ kind: "hidden" });
  }

  /**
   * A page's title on the filed card is pressed: the page opens, as Open opens the first, and the card stays, for the next title.
   * Only the capsule's own page is heard (`sender` is the page the message came from, `event.sender`), and only a path (`rel`, relative
   * to the library) that is one of the pages the newest filing wrote (`job.pages`): any other path, a page of the library or a path
   * out of it, is no card's to open, and nor is a page only an older filing wrote, which a card that has been replaced may still
   * show. While a reprint shows (`showLastReceipt`) the pages are its own. Every window has the same bridge, so this is not Ask's
   * `ask:open-page`, which opens a page by name for the Ask window and for setup, and stays as it is.
   */
  openFiledPage(sender: WebContents, rel: unknown): void {
    if (!isPageOf(sender, this.capsule) || typeof rel !== "string") return;
    if (this.shownPages()?.some((page) => page.path === rel)) this.openPage(rel);
  }

  /**
   * "Show the last receipt", from the menu: the open library's last filing, filed or noted, is put up again as a reprint, in the card's
   * own time (`FILED_SHOW_MS`; the pointer holds it as it holds any card). It is the same card with the pages it wrote that are still
   * there, Open, the line that the person's words were kept, and Undo while the menu would still take that filing back; but nothing is
   * filed as it shows: its stamp is still and dated the day the thought was filed, the face doesn't wear
   * its stamp (`markFiled` is not called) and no notification is posted. A receipt lasts for days and across restarts, and the person may
   * have renamed, moved or deleted a page since: its title and Open would open nothing (`openPage`), and Open puts the card away all the
   * same. So the pages are those that are plain files in the library when the item is chosen (`pageAt`), and a card left with none has no
   * Open, as a filed card with none has none.
   *
   * It does nothing unless the item is offered (`receiptShowable`), which includes a finished card or none (`showsFinishedCard`), whoever
   * calls it, even if a menu that was open when the card changed still shows the item: over a problem with its fix, the editor or a capture,
   * a reprint would lose a problem's one fix, or the words of the editor, which `setCapsule` would keep as a new capture that isn't filed.
   */
  showLastReceipt(): void {
    const receipt = this.lastReceipt;
    const vault = this.vault;
    if (receipt === null || vault === null || !this.receiptShowable()) return;
    const pages = receipt.pages.filter((page) => pageAt(vault.root, page.path) === "page");
    this.setCapsule(
      {
        kind: "filed",
        text: receipt.text,
        agent: receipt.agent,
        seconds: receipt.seconds,
        pages,
        canUndo: this.offersUndoOf(receipt.commit),
        noted: receipt.noted,
        ...(receipt.restored ? { restored: true as const } : {}),
        reprint: { filedAt: receipt.filedAt },
      },
      FILED_SHOW_MS,
    );
    this.reprint = { ...receipt, pages }; // after `setCapsule`, which clears it for every card; Open and the titles read these pages (`shownPages`)
  }

  dismiss(): void {
    if (this.capsuleState.kind === "listening") return this.cancelRecording();
    if (this.capsuleState.kind === "editing") return this.cancelEdit();
    this.setCapsule({ kind: "hidden" });
  }

  /**
   * The pointer enters what the capsule draws (`keep`), or leaves it. A card that hides itself waits while the pointer is on it
   * (`scheduleHide`), but the hold is let go only `KEEP_OPEN_LET_GO_MS` after the pointer leaves, and a return before then cancels it:
   * crossing the gap between a card and its bar is a leave and an enter, and a card whose time is up in that moment would be put away
   * under the pointer. Whether the window passes clicks through is `setInteractive`'s, and has no such delay.
   */
  setKeepOpen(keep: boolean): void {
    if (this.letGoTimer) clearTimeout(this.letGoTimer);
    this.letGoTimer = null;
    if (keep) {
      this.keepOpen = true;
      return;
    }
    this.letGoTimer = setTimeout(() => {
      this.letGoTimer = null;
      this.keepOpen = false;
    }, KEEP_OPEN_LET_GO_MS);
  }

  setInteractive(interactive: boolean): void {
    if (this.capsuleState.kind === "editing") return;
    this.capsule.setIgnoreMouseEvents(!interactive, { forward: true });
  }

  /**
   * A button on the capsule's card is clicked (an error card's one button, or a notice's Open Settings): `action`, as the
   * page sent it, says what to do (see CardAction), and the card goes away. `refile:<agent>` files the card's note
   * (`cardCapture`) again with that agent (`fileAgainWith`): the filing the capsule shows replaces the card. A second click
   * on the button finds no note, since that filing has replaced the card, and does nothing. `type-a-thought`, the fix of a thought
   * that couldn't be saved, opens Type a thought again, with its words still in it, whichever window is in front (Type instead, which
   * stays in Ask while a press of Record a thought's shortcut there would ask (`pressAsks`), is `typeInstead`), and only while an error card is what the
   * capsule shows: a press that finds another card up, a recording say, is a stale one, and opens and hides nothing.
   *
   * Other windows send it too (the Ask window's Open Settings, setup's Open Settings), while the capsule shows something
   * that isn't a card: a recording, or a note being edited. It hides only the two cards it is the button of, an error card
   * and a taken shortcut's notice. Anything else the capsule shows is that moment's own, and is left as it is.
   */
  openSettingsFor(action: string): void {
    if (action.startsWith("refile:")) {
      const capture = this.cardCapture; // before the filing replaces the card, and the card's note with it
      if (capture !== null) this.fileAgainWith(capture, action.slice("refile:".length));
      return;
    }
    if (action === "finish-call") {
      if (this.capsuleState.kind === "error") void this.calls.finishKept(); // its card is replaced by the transcribing one
      return;
    }
    if (action === "copy-dictation") {
      // The copy prompt's Copy: the words it shows, whole, go on the clipboard again (the person may have copied something since).
      if (this.capsuleState.kind === "error" && this.copyPromptText !== null) {
        void Promise.resolve(electronClipboard.writeText(this.copyPromptText)).catch((error: unknown) => console.error("copy dictation", error));
      }
      if (this.capsuleState.kind === "error") this.setCapsule({ kind: "hidden" });
      return;
    }
    if (action === "type-a-thought") {
      if (this.capsuleState.kind === "error") {
        this.setCapsule({ kind: "hidden" });
        this.openQuick(); // the words wait in Quick, whichever window is in front: unlike Type instead, this never stays in Ask
      }
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
    const card = this.capsuleState.kind;
    if (card === "error" || card === "shortcut-taken") this.setCapsule({ kind: "hidden" });
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
   * safe. The first quit's choice wins: asked again while that quit waits for the filing to stop, it does nothing, so Avanzel
   * opens once; and asked while a plain Quit waits, it does nothing either, so Avanzel doesn't come back after the person
   * chose to quit. With AVANZEL_TEST=1 nothing quits or relaunches, and relaunchedForTests counts the relaunches that would begin.
   */
  relaunch(): void {
    if (this.relaunching || this.quitting) return;
    this.relaunching = true;
    if (process.env.AVANZEL_TEST === "1") {
      this.relaunched += 1;
      return;
    }
    app.relaunch();
    app.quit();
  }

  // ---------------------------------------------------------------- quick type & ask

  openQuick(): void {
    // Type a thought would take the focus from the app a dictation is meant for, and its words would then be offered, not pasted.
    if (this.recording?.forCursor) return;
    if (!this.vault) return this.showHome();
    if (!this.quickWindow || this.quickWindow.isDestroyed()) {
      const created = createQuickWindow();
      created.on("blur", () => created.hide());
      this.quickWindow = created;
    }
    const win = this.quickWindow;
    placeQuick(win);
    bringForward(win);
  }

  closeQuick(): void {
    this.quickWindow?.hide();
  }

  /**
   * Type instead, on the capsule's card while Avanzel can't listen yet (the speech model is on its way, or its download failed): the
   * capsule goes and Quick opens. Not while a press of Record a thought's shortcut now would ask (`pressAsks`; the capsule is a panel that
   * never takes the key, so Ask is still the key window when the button is pressed): the field to type the question in is already in
   * front of the person, with what they typed in it, and the capsule only goes. With no page the press recorded a thought, and Quick is
   * where a thought is typed. It goes by the window and its shelves as the button is pressed, not by the press that brought the card.
   */
  typeInstead(): void {
    this.setCapsule({ kind: "hidden" });
    if (!this.pressAsks()) this.openQuick();
  }

  async submitQuick(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.closeQuick();
    let capture: Capture;
    try {
      capture = this.requireVault().newCapture(trimmed, { source: "text", now: new Date() });
    } catch (error) {
      // The words stay in Type a thought for another try, which the card's one fix opens (`openSettingsFor`).
      this.fail(thoughtNotSavedProblem(errorMessage(error), reasonMax(error)), "type-a-thought", "Type a thought");
      throw error;
    }
    this.wake();
    this.afterCapture(capture.path, trimmed, null);
  }

  openAsk(): void {
    if (!this.vault) return this.showHome();
    if (!this.askWindow || this.askWindow.isDestroyed()) {
      this.askWindow = createAskWindow();
      this.askWindow.once("ready-to-show", () => showWhenReady(this.askWindow));
      // The saves its turns can take back (`savedAnswers`) are theirs while it is open. Closing it ends that: a window that opens
      // after it is handed none of them, and the library's history keeps the commits.
      this.askWindow.once("closed", () => this.savedAnswers.clear());
    }
    bringForward(this.askWindow);
  }

  closeAsk(): void {
    if (this.askWindow && !this.askWindow.isDestroyed()) this.askWindow.close();
  }

  /** Whether the Ask window is the key window: it exists, isn't destroyed, and has the keyboard. */
  private askHasFocus(): boolean {
    return !!this.askWindow && !this.askWindow.isDestroyed() && this.askWindow.isFocused();
  }

  /**
   * Whether a press of Record a thought's shortcut now asks a question (`pressDictate`): the Ask window is the key window, and the
   * shelves hold a page to ask about. With none, the window's own line invites a thought, and the press records one. So does a press
   * when the shelves can't be counted (a library folder that can't be listed): it runs in the global shortcut's callback, where a throw
   * would bring up Electron's error box and the press would do nothing.
   */
  private pressAsks(): boolean {
    if (!this.askHasFocus()) return false;
    try {
      return this.libraryPages() > 0;
    } catch (error) {
      console.warn("ask: the shelves couldn't be counted, so the press doesn't ask", error);
      return false;
    }
  }

  /**
   * Record a thought's shortcut, which says a question in the Ask window and which its hint names (while the shelves hold a page: the
   * window draws no hint over its empty line). Null while that shortcut isn't registered (`shortcutProblems` names it: another app holds
   * it, or it can't work), as there is then no key to name.
   */
  askShortcut(): string | null {
    const { dictate } = this.store.get().shortcuts;
    return dictate && !this.shortcutProblems.dictate ? dictate : null;
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

  /**
   * The questions Ask suggests before the first one: one about each of the pages filed last, newest first (`recent`, at most three,
   * from filings only, so a page saved from Ask is never one). None while the six shelves hold no pages, as Ask then invites a first
   * thought: `recent` takes a page from any folder but the library's own (inbox, raw, reviews, tasks), which `libraryPages` does not
   * count, so a filing outside the shelves would otherwise sit under "Your shelves are empty…". `pages`: the shelves' count, when it is
   * already known (`askSnapshot`), so that they are counted once.
   */
  askSuggestions(pages = this.libraryPages()): string[] {
    return pages === 0 ? [] : suggestQuestions(this.recent);
  }

  /**
   * What the Ask window draws around its field, read at one moment: the shelves are counted once (`libraryPages` looks at every file of
   * the library), and the suggestions, the line under the field and the hint are drawn from that one count and the shortcut, which
   * the window draws together.
   */
  askSnapshot(): AskSnapshot {
    const pages = this.libraryPages();
    return { pages, suggestions: this.askSuggestions(pages), shortcut: this.askShortcut() };
  }

  /**
   * The shelves may have changed (a filing ended, a filing or a review was taken back, another library opened): the Ask window is told
   * to read again what it draws around its field (`askSnapshot`). It reads when it has the focus, but the capsule that files a thought
   * never takes the key from it, so with Ask in front no focus comes, and its line, hint and suggestions would stay as its last read
   * left them while each press of the shortcut is routed by a fresh count (`pressAsks`).
   */
  private askChanged(): void {
    const win = this.askWindow;
    if (win && !win.isDestroyed()) win.webContents.send("ask:changed");
  }

  /**
   * What the Ask window `win` (the one that asked, even once another one opens) hears of its question or save. The engine's messages go
   * to it as they are, except its waiting one, which names no run: in the window's words it names none either, for what holds the
   * library may be a filing, a review, or a stopped question letting go.
   */
  private askProgress(win: BrowserWindow | null): (message: string) => void {
    return (message) => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send("ask:progress", message === WAITING ? "Waiting for Avanzel to finish with your library…" : message);
    };
  }

  /**
   * Runs `run`, a question or a save, as what the Ask window is doing: `abort` is what closing that window, or Stop in it, gives up
   * (`giveUpAsk`): its agent run stops, and the library is free for a filing waiting on it. One is run at a time, so Stop gives up the
   * newest one. `progress` tells the window what the run is doing (`askProgress`). The face thinks meanwhile.
   */
  private async inAskSlot<T>(run: (abort: AbortController, progress: (message: string) => void) => Promise<T>): Promise<T> {
    const win = this.askWindow; // the window that asked, even once another one opens
    const abort = new AbortController();
    const giveUp = () => abort.abort();
    this.giveUpAsk = giveUp;
    this.refreshTray(); // the face thinks while a question is answered
    if (win?.isDestroyed()) giveUp();
    else win?.once("closed", giveUp);
    try {
      return await run(abort, this.askProgress(win));
    } finally {
      if (win && !win.isDestroyed()) win.removeListener("closed", giveUp);
      if (this.giveUpAsk === giveUp) {
        this.giveUpAsk = null;
        this.refreshTray();
      }
    }
  }

  async ask(question: string): Promise<AskResult> {
    const library = this.vault?.root ?? null; // the library the question is asked in, which Save hands back
    return this.inAskSlot(async (abort, progress) => {
      const { ok, ran, text, agent, seconds, changedFiles, failure } = await this.answerQuestion(question, abort, progress);
      // A run that failed says whose it was; a message thrown before any run comes back as it is. An answer comes with its
      // lines and the pages its links name; anything else has none. Either says how many files the run changed in the library,
      // and a question that failed says why (`failure`) when an agent can be told of it.
      return {
        ok,
        answer: ran && !ok ? `${agent} couldn't answer.\n${text}` : text,
        agent,
        seconds,
        ...(ok ? answeredFrom(library, text) : { paragraphs: [], sources: [] }),
        changedFiles,
        failure,
        library,
      };
    });
  }

  /**
   * Stop, in the Ask window: the question being answered, or the answer being saved, is given up, as closing the window gives it up.
   * Only that window's own page can: `sender` is the page the message came from (`event.sender`), and any other window's gives up nothing.
   */
  cancelAsk(sender: WebContents): void {
    if (isPageOf(sender, this.askWindow)) this.giveUpAsk?.();
  }

  /**
   * Saves `answer`, the one the Ask window showed for `question`, as a page of the library it came from (`library`: AskResult.library):
   * the agent writes it, and the engine commits it. Only that window's own page can: `sender` is the page the message came from
   * (`event.sender`), and any other window's is refused with an error and runs nothing. Nor does it run once another library is open:
   * the answer would be filed, with links that name the first library's pages, in one it didn't come from (`ANOTHER_LIBRARY`).
   *
   * It runs where a question does (`inAskSlot`) and waits for the library as a question does. Stop gives it up; so does closing the
   * window, or quitting, and nobody is told then. What a run left is kept as its own commit by the engine (`partial`).
   *
   * The menu's Undo the last filing stays away while the save waits or runs (`savesGoing`): the save commits after a filing that ends
   * meanwhile, which can then no longer be taken back. A save that commits nothing leaves the filing's Undo, offered again when the save
   * ends (the save's start clears nothing: a save that wrote nothing has not touched the filing); one that commits drops its record
   * (`clearLastFiled`).
   *
   * It ends `saved` when the run wrote a page, even if Stop landed as it ended, with the save's own commit, which takes it back
   * (`undoSave`) while the window that saved is open (`savedAnswers`); else `stopped` when Stop, or the window's closing, gave it up; else
   * `unsaved`: the run ended well and wrote no page (no `failure`), it failed, or it couldn't start (`partial` is then null).
   */
  async saveAnswer(sender: WebContents, question: string, answer: string, library: string | null): Promise<SaveResult> {
    if (!isPageOf(sender, this.askWindow)) throw new Error("Only the Ask window saves an answer.");
    const win = this.askWindow; // the window that saved, even once another one opens
    const agent = this.agentName();
    const harness = this.selectedHarness(); // the agent the save goes to, named before it runs
    if (library !== (this.vault?.root ?? null)) return { kind: "unsaved", agent, failure: avanzelFailure(ANOTHER_LIBRARY), partial: null };
    this.savesGoing++;
    try {
      this.refreshMenu(); // the tray holds the menu as last built, and a save clears nothing as it begins: build it again without Undo the last filing (`undoableFiling`)
      return await this.inAskSlot(async (abort, progress): Promise<SaveResult> => {
        try {
          const vault = this.requireVault();
          const outcome = await this.withRun(async (signal) => (await this.librarianFor(vault)).ask(question, { save: true, answer, signal, progress }), abort);
          const { result, changes } = outcome;
          if (outcome.commit) this.clearLastFiled(vault.root); // it comes after any filing that ended while the save waited
          // The save's own page: a run can make others too (`savedPage`).
          const pages = result.ok ? filedPages(vault.root, changes) : [];
          const page = savedPage(pages, askLinks(vault.root));
          if (page) {
            if (outcome.commit && win !== null && !win.isDestroyed()) this.savedAnswers.set(outcome.commit, vault); // its window can take it back, while it is open
            return { kind: "saved", page, commit: outcome.commit };
          }
          const partial = leftBehind(outcome);
          if (abort.signal.aborted) return { kind: "stopped", agent, partial };
          if (result.ok) return { kind: "unsaved", agent, failure: null, partial };
          return { kind: "unsaved", agent, failure: this.agentFailure(harness, lastLines(result.stderr || result.output), classifyFailure(result)), partial };
        } catch (error) {
          const failure = error instanceof NoAgentError ? this.agentFailure(this.failedHarness("auto", error), error) : avanzelFailure(errorMessage(error));
          return { kind: "unsaved", agent, failure, partial: null };
        }
      });
    } finally {
      this.savesGoing--;
      this.refreshMenu();
    }
  }

  /**
   * Undo, on a turn of the Ask window whose answer was saved as a page: git takes the save's commit back (`revertFiling`), once the queue
   * gets to it, in the library the save was made in (`savedAnswers`), whichever library is open by then. Whether it did. Only that
   * window's own page can, and only for a commit this window was handed (`saveAnswer`): the page can't name one of its own. The commit
   * goes from `savedAnswers` as it is asked for, before the first await, so it has one try: git may refuse it (usually a later change touched
   * the same lines), and a second Undo of it, here or from the page of a window that opens later, finds none. It posts no notification and
   * puts up no card on the capsule: the turn that asked tells the person. A revert that threw is a refusal, as it is on the filed card (`undo`).
   * Closing the window does not cancel an Undo that is already asked for: it has no abort, so one queued behind a long filing still takes
   * the save back after its window closed, and the turn that would tell it is gone, so nobody is told. The person asked for it, and the
   * library's history keeps the revert.
   */
  async undoSave(sender: WebContents, commit: string): Promise<boolean> {
    const library = this.savedAnswers.get(commit);
    if (!isPageOf(sender, this.askWindow) || library === undefined) return false;
    this.savedAnswers.delete(commit);
    return this.revertFiling(commit, library).catch((error) => {
      console.warn("undo save", error); // a revert that threw is a refusal to the turn: it would otherwise wait on its Undo for ever
      return false;
    });
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

  /**
   * Opens the page at `rel`, a library path: in Obsidian when the library is a vault of its own, else in the app the Mac opens it with.
   * Every way to a page comes here: Open and a title on the filed card, the filed notification, the menu's recent pages, Ask's links and
   * a review's notification. Only a plain file in the library, reached through no link, is opened (`pageAt`): a link opens as whatever
   * it points at, by that file's own type, and an agent with a shell could point one at a script it wrote. A link opens nothing, and a
   * notification says so (`linkedPageNotice`), since the press that asked for it saw nothing happen (Open puts its card away). Nothing
   * that isn't there, or isn't a file, is opened either; that is only logged.
   */
  openPage(rel: string): void {
    const vault = this.vault;
    if (!vault) return;
    const at = pageAt(vault.root, rel);
    if (at !== "page") {
      console.warn(`open page: ${rel} ${at === "link" ? "goes through a link" : "is no file in the library"}, so nothing was opened`);
      if (at === "link") {
        const notice = linkedPageNotice(rel);
        this.notify(notice.title, notice.body);
      }
      return;
    }
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

  /**
   * A notification, with macOS's sound. It is without it, whoever posts it, while a recording runs: the recorder keeps no echo cancellation
   * (recorder.ts), so macOS's sound would be heard in the person's words. That rule lives here and nowhere else, so that no call site has to
   * remember it: a filing that ends in the background mid-dictation, a failure, the evening review's end and its Undo, and the Undo pressed
   * from the shortcut are all quiet then. `notified` keeps `silent` only on a silent one, so the tests' `{ title, body }` assertions stand
   * for the others.
   */
  private notify(title: string, body: string, onClick?: () => void): Notification | undefined {
    if (this.quitting) return undefined;
    const quiet = this.recording !== null || this.calls.running;
    if (process.env.AVANZEL_TEST === "1") {
      // The tests read `notified`, not the screen: no banner and no sound reach this Mac's Notification Centre.
      this.notified.push({ title, body, ...(quiet ? { silent: true as const } : {}) });
      this.notifiedClicks.push(onClick);
      return undefined;
    }
    if (!Notification.isSupported()) return undefined;
    const note = new Notification({ title, body, silent: quiet });
    if (onClick) note.on("click", onClick);
    note.show();
    return note; // whoever needs its click later holds it: a notification no one holds can be collected, and its click with it
  }

  // ---------------------------------------------------------------- settings

  /** With a `pane`, a new window opens on it and an open one moves to it; without, a new one opens on General and an open one stays put. */
  showSettings(pane?: SettingsPane): void {
    if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
      this.settingsWindow = createSettingsWindow(pane);
      this.settingsWindow.once("ready-to-show", () => showWhenReady(this.settingsWindow));
      // Back from System Settings, say, where the person may have allowed the microphone or Screen Recording: Privacy follows
      // it, as setup reads the sign-ins again when it has the focus (`rereadSignIns`). That is a read of what is on this
      // Mac, and starts no agent check, which could cost quota. Or back from Terminal, where they may have installed Apple's
      // Command Line Tools: while this Mac had no usable git, it is looked for afresh (the engine keeps its answer for the
      // process), as setup's window does (`rereadGit`), so General's line and the next filing's commit follow.
      this.settingsWindow.on("focus", () => {
        try {
          if (!git.gitUsable()) git.resetGitUsable();
          this.refreshSettings();
        } catch (error) {
          console.error("settings", error); // an event handler that throws would bring up Electron's error box
        }
      });
    } else if (pane) {
      this.settingsWindow.webContents.send("settings:show-pane", pane);
    }
    bringForward(this.settingsWindow);
  }

  /**
   * Choose…, in Settings: a native menu of the page's `options` pops up over the Settings window, at `at`. Resolves with
   * the value picked; null when the menu closes without one, and without an open Settings window or a request that can
   * be read. Only the Settings window's own page is answered: `sender` is the page the message came from (`event.sender`),
   * and a menu is not popped up over Settings for any other window's.
   */
  pickFromSettings(sender: WebContents, options: unknown, at: unknown): Promise<string | null> {
    const win = this.settingsWindow;
    const request = pickRequest(options, at);
    if (!win || !isPageOf(sender, win) || !request) return Promise.resolve(null);
    return popupChoice(win, request.options, request.at);
  }

  /** Settings' Show in Finder: the library's folder opens in Finder. Nothing without a library. */
  showLibraryInFinder(): void {
    const vault = this.vault;
    if (vault) void shell.openPath(vault.root);
  }

  /**
   * Settings' Set up Avanzel… and Set up a new library, offered while there is no library: setup, where a library is made,
   * opens or comes forward, and Settings closes. Nothing while a library is open and still there; one that went while Avanzel
   * ran doesn't count. When the remembered library is gone, setup starts over at ~/Avanzel, the usual place, not at the place
   * that went: that is for choosing again, which is what Choose a folder… is for.
   */
  openSetupFromSettings(): void {
    if (this.vault?.exists()) return;
    const gone = this.libraryMissing !== null || this.vault !== null; // missing at launch, or gone while Avanzel ran
    this.setup.show(gone ? defaultLibraryPath(homedir()) : undefined);
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
    // What turns speech into words: the library's settings, else the defaults. A backend the engine doesn't know can't be used
    // either way (the model status says so), and reads as the one it would have been.
    const { backend, model } = (settings ?? defaultSettings()).voice;
    return {
      app: this.store.get(),
      library: vault
        ? {
            path: vault.root,
            label: tildePath(vault.root, home),
            exists,
            isGit: existsSync(path.join(vault.root, ".git")),
            // Whether this Mac can run git, found out without running it: where it can't (Apple's stub), nothing commits, however
            // much history the folder has.
            gitUsable: git.gitUsable(),
            autoCommit: settings?.autoCommit ?? true,
            inbox: exists ? vault.pending().length : 0,
            shelves: exists ? vault.shelfCounts() : {},
            harness: settings?.harness ?? "auto",
            models: settings?.models ?? {},
            timeoutSeconds: settings?.timeoutSeconds ?? 900,
            dictionary: settings?.voice.dictionary ?? [],
            ...dictationInfo(settings),
          }
        : kept
          ? {
              path: kept,
              label: tildePath(kept, home),
              exists: false,
              isGit: false,
              gitUsable: git.gitUsable(),
              autoCommit: true,
              inbox: 0,
              shelves: {},
              harness: "auto",
              models: {},
              timeoutSeconds: 900,
              dictionary: [],
              ...dictationInfo(null),
            }
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
      voice: { backend: backend === "command" ? "command" : "onnx-asr", model },
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
    if (JSON.stringify(before.cursorDictation) !== JSON.stringify(after.cursorDictation)) this.applyCursorDictation();
    this.broadcast();
    return this.snapshot();
  }

  async setLibrarySettings(patch: LibraryPatch): Promise<SettingsSnapshot> {
    const vault = this.requireVault();
    await this.enqueue(async () => {
      saveSettings(vault.root, patchedSettings(loadSettings(vault.root), patch));
    });
    this.broadcast();
    return this.snapshot();
  }

  async chooseLibrary(): Promise<SettingsSnapshot> {
    const parent = this.settingsWindow && !this.settingsWindow.isDestroyed() ? this.settingsWindow : undefined;
    const result = parent ? await dialog.showOpenDialog(parent, LIBRARY_PICKER) : await dialog.showOpenDialog(LIBRARY_PICKER);
    const chosen = result.filePaths[0];
    if (result.canceled || !chosen) return this.snapshot();
    // The home folder, a system folder or a disk's root is no place for a library, whatever is there already: refused before
    // anything is asked or made, with why, and the library stays as it was.
    const broad = tooBroad(chosen, homedir());
    if (broad) throw new AvanzelError(tooBroadLine(tildePath(chosen, homedir()), broad));
    if (!new Vault(chosen).exists()) {
      const entries = readdirSync(chosen).filter((name) => name !== ".DS_Store");
      if (entries.length) {
        const confirm = await dialog.showMessageBox({
          type: "question",
          buttons: ["Use This Folder", "Cancel"],
          defaultId: 1,
          cancelId: 1,
          message: `Turn “${path.basename(chosen)}” into your Avanzel library?`,
          // Only what the app does: on a Mac without a usable git it makes no history, and says so.
          detail: git.gitUsable()
            ? "It already has files. Avanzel will add its shelves, an AGENTS.md for your agent, and git history that includes the existing files."
            : `It already has files. Avanzel will add its shelves and an AGENTS.md for your agent. ${NO_GIT_LINE}`,
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
   * Otherwise setup while there is no library, unless one failed to open (`libraryProblem`) or is remembered and gone
   * (`libraryMissing`): Settings says which, and fixes it. With a library, Settings.
   */
  showHome(): void {
    if (this.setup.isOpen() || (!this.vault && this.libraryProblem === null && this.libraryMissing === null)) return this.setup.show();
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
      refreshTray: () => this.refreshTray(),
      downloadModel: () => this.downloadModel(),
      checkAgents: () => this.checkAgents(),
      runAgentCheck: (name, harness, prompt, again) => this.runAgentCheck(name, harness, prompt, again),
      rereadSignIns: () => this.rereadSignIns(),
      useLibrary: (target, fromSetup) => this.useLibrary(target, fromSetup),
      setLibrarySettings: (patch) => this.setLibrarySettings(patch),
      changeApp: (patch, picked) => this.changeApp(patch, picked),
      useShortcut: (key, accelerator) => this.useShortcut(key, accelerator),
      startRecording: async (mode, shot) => void (await this.startRecording(mode, shot, { forSetup: true })), // only setup's first spoken thought
      hideCapsule: () => this.setCapsule({ kind: "hidden" }),
      openPrivacy: (kind) => this.openPrivacy(kind),
      relaunch: () => this.relaunch(),
      toggleDictate: () => this.toggleDictate(),
      openQuick: () => this.openQuick(),
      enqueue: (work) => this.enqueue(work),
      file: (job) => void this.enqueue(() => this.runFiling(job)),
      takeBack: (job) => this.takeBack(job),
      revert: (commit) => this.revertFiling(commit),
      answer: (question, abort, progress) => this.answerQuestion(question, abort, progress),
      newCapture: (text, options) => {
        const capture = this.requireVault().newCapture(text, options);
        this.wake(); // a thought typed in setup is a capture too
        return capture;
      },
      firstRun: this.firstRun,
      queuedToFile: this.queuedToFile,
      noticed: this.noticed,
      opened: this.opened,
      copied: this.copied,
      spawned: this.spawned,
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
   * The scratch folder the checks ran in goes too, and so does the menu bar's timer.
   */
  stopAgentChecks(): void {
    this.checksStopped = true;
    if (this.trayTimer) clearTimeout(this.trayTimer); // the menu bar's count stops where it is, and `showTray` sets no timer again
    this.trayTimer = null;
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
    let shownPercent = wholePercent(0, bytes); // what the menu bar's title reads now: it is shown again only when the whole percent changes
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
          const percent = wholePercent(progress.receivedBytes, progress.totalBytes);
          if (percent !== shownPercent) {
            shownPercent = percent;
            this.refreshTray();
          }
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
    else if (model.kind === "error") this.fail(voiceSettingsProblem(model.message), "open-settings:voice", "Open Settings"); // fixed in the config file, which Voice names
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
    if (this.filed.day !== localDate(now)) this.countFiled(vault.root, now); // a new day: the head counts it from the log
    this.rereadVoiceSettings();
    this.refreshMenu();
  }

  /**
   * Voice settings Avanzel can't use are mended by hand in the config file, and nothing watches it. They are read again every minute
   * (`tick`) and when the person chooses the menu's item about them, as the dictation shortcut reads them at each press
   * (`readyToListen`): one read of one small file, and only while they are in error. The face and the menu follow what is found, so
   * a mended file takes the problem out of both.
   */
  private rereadVoiceSettings(): void {
    const model = this.model;
    if (model.kind !== "error" || model.cause !== "settings") return;
    const fresh = this.modelStatus();
    if (fresh.kind === "error" && fresh.message === model.message) return; // the same trouble: nothing to tell anyone
    this.model = fresh;
    this.broadcast();
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

  /**
   * Asks whether to run the review `taskId` now, before a person's press runs it (the menu's item, Settings' Run now): an agent run may
   * count toward their plan's usage limit. `parent`, Settings' window, makes the question a sheet on it. True for Run Now, unless the library changed
   * while the question was open: Run Now was for the review of the library it named, and `runTask` would run the one of the same name
   * in the other. False, with nothing asked, where `runTask` would do nothing: there is no library, no such review, or it runs already
   * (its item stays in the menu while it does). True, with nothing asked, for a review that runs no agent: `executeTask` only says a
   * custom review was skipped. `runTask` itself never asks: a review that comes due (`tick`) is on the schedule the person set.
   */
  async confirmRun(taskId: string, parent?: BrowserWindow): Promise<boolean> {
    const vault = this.vault;
    if (!vault || this.running.has(taskId)) return false;
    const task = this.safeTasks(vault).find((t) => t.id === taskId);
    if (!task) return false;
    // A question about the plan's usage limit would say the opposite of what happens to a review that runs no agent.
    if (task.kind !== "evening-review" && task.kind !== "review") return true;
    // The agent is named when one can be (as the notification that ends the run names it); where none can, the question says no more.
    const named = this.selectedHarness(task.agent);
    const options = {
      type: "question" as const,
      buttons: ["Run Now", "Cancel"], // title case, as a native alert's buttons are (like "Use This Folder")
      defaultId: 0,
      cancelId: 1,
      message: `Run “${task.name}” now?`,
      detail: `It runs${named ? ` with ${harnessName(named)}` : ""} on your plan, so it may count toward your usage limit.`,
    };
    // A menu bar app isn't the frontmost app when its menu is used: without this the question would come up behind the others.
    stealFocus();
    const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    return response === 0 && this.vault?.root === vault.root;
  }

  /** Settings' Run now: the question comes up as a sheet on Settings (`confirmRun`), and the review runs on Run Now. Cancel changes nothing. */
  async runTaskFromSettings(id: string): Promise<SettingsSnapshot> {
    const win = this.settingsWindow;
    const asked = await this.confirmRun(id, win && !win.isDestroyed() ? win : undefined);
    return asked ? this.runTask(id) : this.snapshot();
  }

  /** Run a shadow task now: by hand (the menu, Run now, once `confirmRun` has been answered), or because it is due (`tick`). */
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
      this.reviewing.delete(id);
      this.readLog();
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

  /**
   * The `leave` an evening review runs with (`eveningReview`), which counts its captures for the menu: "2 of 5" beside the review, in
   * place of "Running…" (`reviewing`).
   * - A capture counts when the engine picks it. The engine asks `leave` as it takes each capture up, and a `false` answer is the pick
   *   (`FileOptions.leave`): once for each capture, before its first report. The reports can't count it by themselves: a recording is
   *   reported twice (transcribed, then filed under a name of its words' own), one with no words once, and one the engine can't adopt
   *   not at all.
   * - The total is what waits in the inbox as the review begins, less what it leaves alone (`leftAlone`, which notes in `left` what it
   *   did). The engine reads the inbox again after each capture and files what arrived meanwhile, so the total rises to meet the count:
   *   the menu never reads "3 of 2".
   * - The menu is built once for each capture, never for each report or step.
   */
  private countReview(id: string, left: Set<string>): (capturePath: string) => boolean {
    const wouldLeave = this.leftAlone(new Set()); // only asked: the review's own `left` is for what the review did leave
    const total = this.requireVault().pending().filter((capturePath) => !wouldLeave(capturePath)).length;
    const leave = this.leftAlone(left);
    let done = 0;
    return (capturePath) => {
      const theirs = leave(capturePath);
      if (!theirs) {
        done += 1;
        this.reviewing.set(id, reviewProgress(done, total));
        this.refreshMenu();
      }
      return theirs;
    };
  }

  private async executeTask(task: ShadowTask): Promise<void> {
    const agent = this.agentName(task.agent);
    try {
      // The weekly review appends to the log and commits as it runs: the filing before it is not the last any more, and a revert of it
      // would meet the review's later commit and be refused. The evening review writes to the library only if it files something, so it
      // ends the offer as it ends (below). A custom review is skipped below and changes nothing, so the last filing stands.
      if (task.kind === "review") this.clearLastFiled();
      if (task.kind === "evening-review") {
        const left = new Set<string>();
        // An evening review with nothing to file commits nothing and writes no line in the log, so git would still take the last filing
        // back: the menu offers it again once the review is over, until the next filing (spec §6.3). One that filed something has
        // committed after that filing, and one that threw may have filed some of the inbox first: either ends the offer. While the
        // review waits and runs, the item is hidden all the same (`running`, `undoableFiling`).
        // The library the review runs in, which `librarian()` reads as the run begins: another may open while it runs, and what the review
        // leaves to undo is kept with this one (`undoRecords`). A missing library throws to the `catch` below, as `librarian()` would.
        const library = this.requireVault();
        let filedNothing = false;
        let ranToItsEnd = false;
        try {
          const result = await this.withRun(async (signal) => {
            const librarian = await this.librarian(task.agent);
            // The count's total is read here, as the review begins.
            return librarian.eveningReview({ instructions: task.instructions, signal, leave: this.countReview(task.id, left) });
          });
          ranToItsEnd = true;
          filedNothing = !result.outcomes.length;
          this.fallAsleep(); // it ran to its end, whatever it found to file
          if (filedNothing) {
            this.notify(task.name, nothingFiled(left.size));
            return;
          }
          const filedIds = new Set(result.outcomes.filter((o) => o.ok).map((o) => o.captureId));
          this.noteFiled((capture) => filedIds.has(path.basename(capture, path.extname(capture)))); // as a filing does (`runFiling`)
          this.undoRecords.patch(library.root, { evening: result.commits });
          if (this.vault?.root === library.root) this.lastEveningCommits = result.commits; // by folder: a library opened again is the same one
          const failed = result.outcomes.filter((o) => !o.ok);
          const filed = result.outcomes.length - failed.length;
          const digest = result.digestPath;
          this.notify(
            `${task.name}: ${filed} ${filed === 1 ? "thought" : "thoughts"} filed`,
            failed.length ? notFiled(failed, filed) : `${agent} sorted today's inbox. Click to read the summary.`,
            digest ? () => this.openPage(path.relative(this.requireVault().root, digest)) : undefined,
          );
        } finally {
          if (!filedNothing) this.clearLastFiled(library.root);
          // A review that threw (its agent gone when it came to the next note, say) may have filed some of the inbox first, and committed after
          // the review before it: a revert of that one would meet the newer lines and end partial. Its record ends here too, since it outlives
          // the app run (`undoRecords`). The throw itself is told below.
          if (!ranToItsEnd) this.clearLastEvening(library.root);
        }
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

  /**
   * Undo the last evening review, from the menu: the commits it made (`lastEveningCommits`) are taken back once the queue gets to them.
   * It answers only once the saved Undo is checked (`undoChecked`) and not while Avanzel quits, as the filing's does (`undoableFiling`):
   * a quit leaves the record where it is. The commits are taken before the first await, here and in `undoRecords`, and the menu is built
   * again at once, as `forgetFiling` does for the filing: its item doesn't stand while the take-back waits in the queue (behind a filing
   * or a review that can be a while), when a press of it would do nothing. So it is asked for once, and that is its only try. It takes
   * back in the library it was asked in, through a librarian made for that library
   * (`librarianFor`), whichever library is open when the queue gets to it: the person asked to undo that review there. A take-back that
   * throws (git can't run) is told as a refusal (`undoRefused`), as a filing's is: the menu doesn't wait for this, so nothing is left
   * unhandled.
   */
  async undoEveningReview(): Promise<void> {
    const library = this.vault;
    const commits = this.lastEveningCommits;
    if (library === null || !commits.length || !this.undoChecked() || this.quitting) return;
    this.lastEveningCommits = [];
    this.undoRecords.patch(library.root, { evening: [] });
    this.refreshMenu(); // the item goes now, not when the take-back lands
    const undone = await this.enqueue(async () => (await this.librarianFor(library)).undo(commits)).catch((error: unknown) => {
      console.warn("undo evening review", error); // a take-back that threw is a refusal, as it is for a filing
      return null;
    });
    this.readLog();
    if (undone === null) this.notify(undoRefused.title, undoRefused.body);
    else this.notify("Evening review undone", undone === commits.length ? "Everything it filed is back in the inbox." : `${undone} of ${commits.length} changes were undone; see the library's history.`);
    this.refreshMenu();
  }

  // ---------------------------------------------------------------- test hooks

  capsuleStateForTests(): CapsuleState {
    return this.capsuleState;
  }

  async idleForTests(): Promise<void> {
    await this.queue;
  }

  /** Whether no dictation into another app is under way: the last one's words have been pasted and kept (or not kept) by now. */
  cursorIdleForTests(): boolean {
    return this.cursor.idle();
  }

  pageTitleForTests(rel: string): string {
    return this.vault ? pageInfo(this.vault.root, rel).title : "";
  }

  nativeImageForTests(): typeof nativeImage {
    return nativeImage;
  }

  notificationsForTests(): { title: string; body: string; silent?: true }[] {
    return this.notified;
  }

  /** Clicks the newest notification titled `title`, as the person would in Notification Centre. False with none, or none clickable. */
  clickNotificationForTests(title: string): boolean {
    const index = this.notified.map((note) => note.title).lastIndexOf(title);
    const click = this.notifiedClicks[index];
    click?.();
    return click !== undefined;
  }

  draftForTests(): string | null {
    return this.inEditor?.draft ?? null;
  }

  menuForTests(): MenuItemModel[] {
    return buildMenuModel(this.menuInput(), new Date());
  }

  /**
   * What the menu bar was last given (`MenuBar.show`), the title macOS holds for the icon and the words its tooltip was given (the
   * tooltip has no getter, so `MenuBar` keeps them): for the e2e tests.
   */
  trayForTests(): TrayView & { nativeTitle: string; tooltip: string } {
    return { ...this.menuBar.shown, nativeTitle: this.menuBar.tray.getTitle(), tooltip: this.menuBar.tooltip };
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
  pressShortcutForTests(key: keyof Shortcuts | "Escape"): boolean {
    const press = fakeShortcuts.get(key === "Escape" ? key : this.store.get().shortcuts[key]);
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

  /** How many relaunches Quit and reopen began; the app relaunches nothing with AVANZEL_TEST=1, which only counts. */
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

  /** What Install git would have run, oldest first ("xcode-select --install"); recorded only with AVANZEL_TEST=1, which runs nothing. */
  spawnedForTests(): string[] {
    return this.spawned;
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
