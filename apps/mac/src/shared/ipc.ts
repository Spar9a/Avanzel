// The contract between the main process and the renderers (capsule, settings, quick-type, ask, setup).
import type { CursorPermissionState } from "../main/cursor-helper.ts";
import type { CursorKey } from "../main/tap-detector.ts";
import type { AgentFailure, PartialEdits, TooBroad } from "./problems.ts";

export type { CursorKey } from "../main/tap-detector.ts";
export type { CursorPermissionState } from "../main/cursor-helper.ts";

/** A permission that dictating into any app needs, as System Settings names its place. */
export type CursorPermission = "input-monitoring" | "accessibility";

export interface FiledPage {
  title: string;
  /** First folder of the page path, e.g. "goals". */
  shelf: string;
  /** Library-relative path, e.g. "goals/run-a-marathon.md". */
  path: string;
  /**
   * The filing that wrote the page made it (true), or changed a page the library had (false). Only a filing's own pages say
   * so (`filedPages`); a page looked up on its own (an answer's, a step's, one the menu lists from the log) leaves it unset,
   * and setup and Ask have no use for it. The capsule reads a page without it as updated.
   */
  created?: boolean;
}

export interface ScreenContext {
  app?: string;
  title?: string;
  url?: string;
}

/** What the capsule listens to: a thought, a screen comment, or a call (its microphone side; the controller's `calls`). */
export type CapsuleMode = "dictate" | "comment" | "call";

/** The panes of the Settings window, in the order of its toolbar. "tasks" is the scheduled reviews' pane, named Reviews. */
export const SETTINGS_PANES = ["general", "voice", "shortcuts", "dictations", "agents", "tasks", "privacy"] as const;
export type SettingsPane = (typeof SETTINGS_PANES)[number];
export const isSettingsPane = (value: unknown): value is SettingsPane => SETTINGS_PANES.some((pane) => pane === value);

/**
 * One dictation at the cursor, as the Dictation pane shows it. The words are cut to a preview (`previewOf`): the whole text stays in
 * main, and Copy asks for it by `id`. The pane writes the time out itself, from `at`.
 */
export interface DictationRow {
  id: string;
  /** When it was said, ISO with the local offset. */
  at: string;
  preview: string;
  /** The app that had the cursor; empty when it was never known. */
  app: string;
  title: string | null;
  site: string | null;
  /** False when the words were only copied for the person to paste. */
  inserted: boolean;
}

/**
 * What Delete answers. A failure carries what is safe and the one fix, in plain words, for the Notice's body, and its own title when
 * the pane's "That dictation couldn't be deleted." would be wrong (`DAY_FILE_NOT_UPDATED`: it left the history all the same).
 */
export type DeleteDictationResult = { ok: true } | { ok: false; message: string; title?: string };

/**
 * A forgotten dictation left the history, but the library's day file of dictations (`raw/dictations/`) couldn't be updated: what
 * happened, what remains, and the one fix. `library` names the folder of the library the dictation was kept in, when that is not the
 * one open (null: the open one). Told by the Dictation pane after a Delete and by the capsule after the menu's "Forget the last
 * dictation".
 */
export function dayFileNotUpdated(library: string | null): { title: string; body: string } {
  return {
    title: "That dictation may still be in the library.",
    body:
      library === null
        ? "The words are deleted from the history, but the day file in the library couldn't be updated. They may still be in " +
          "raw/dictations. Open that day's file in the library and remove them."
        : `The words are deleted from the history, but the day file in the library at ${library} couldn't be updated. They may still ` +
          "be in raw/dictations there. Open that day's file in that library and remove them.",
  };
}

/** `dayFileNotUpdated` for the open library. */
export const DAY_FILE_NOT_UPDATED = dayFileNotUpdated(null);

/** The Notice or notification for a Copy the clipboard refused: what happened, what is safe, and the one fix. Settings' pane and the menu both tell it. */
export const DICTATION_NOT_COPIED = "Those words couldn't be copied.";
export const DICTATION_NOT_COPIED_BODY = "They are still in the history. Try copying them again.";

/**
 * What the pane says under "That dictation couldn't be deleted.": what is safe, and the one fix. Main sends it as a failed Delete's
 * message, and the pane tells it itself when the call can't be made at all, so it is defined once, here. The system's own words are
 * not told: they name files and say nothing a person could act on.
 */
export const DELETE_FAILED_BODY = "It is still in the history. Try deleting it again.";

/** How many dictations the pane lists at first, and how many more each "Show more" adds: the history has no limit of its own. */
export const DICTATION_PAGE = 100;

/** The newest dictations as the pane lists them, and how many the history holds in all (so the pane can say how many are not shown). */
export interface DictationList {
  rows: DictationRow[];
  total: number;
}

/** The steps of the setup window, in order. */
export const SETUP_STEPS = ["hello", "found", "microphone", "think", "filing", "ask", "screen", "done"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export const isSetupStep = (value: unknown): value is SetupStep => SETUP_STEPS.some((step) => step === value);

/** What is at the library's place now. */
export type LibraryFolder = "missing" | "empty" | "has-files" | "library";

/**
 * What the one button of the capsule's problem card does: opens a pane of System Settings, or Avanzel's Settings on the pane
 * that fixes the problem; opens Terminal, where an agent signs in; opens Type a thought, where the words of a thought that couldn't
 * be saved still are (`type-a-thought`); or (`refile:<agent>`, the agent's harness name) files the note the card is about again
 * with that agent; or (`finish-call`) makes the notes of the call whose notes weren't made, from what it kept (`CallNotes.finishKept`);
 * or (`copy-dictation`) copies the words of a dictation that couldn't go in at the cursor, the ones its card shows; or
 * (`open-automation-settings`) opens System Settings at Automation, where Avanzel is allowed to ask a browser which page it shows.
 */
export type CardAction =
  | "open-microphone-settings"
  | "open-screen-settings"
  | "open-automation-settings"
  | `open-settings:${SettingsPane}`
  | "open-terminal"
  | "type-a-thought"
  | "finish-call"
  | "copy-dictation"
  | `refile:${string}`;

/**
 * A dictation into another app, on its capsule. `app`: what has focus, which the words would go to, shown where Zel is for a recording that
 * goes to the library. Absent until it has been looked at, null when it couldn't be told. `icon`: the app's icon, as a PNG's data URL.
 */
export interface DictationState {
  app?: { name: string; icon?: string } | null;
}

/**
 * What main tells the capsule page's microphone: a recording's start, stop (its samples go back by `sendAudio`) and cancel; and a call's
 * start and stop, between which its blocks go back by `sendCallAudio` with the call's id (`call`).
 */
export type CapsuleCommand =
  | "start"
  | "stop"
  | "cancel"
  | "pause"
  | "resume"
  | { kind: "call-start" | "call-stop"; call: number }
  /** The voice trigger listens (`on`), with the chosen microphone, or stops: what it hears is sent in short spans (`sendTriggerAudio`). */
  | { kind: "trigger"; on: boolean; microphoneId: string | null };

export type CapsuleState =
  | { kind: "hidden" }
  | {
      kind: "listening";
      mode: CapsuleMode;
      /** Date.now() when it began, moved on by each pause's length, so that now less it is how long it has listened. */
      startedAt: number;
      /** The files and screenshots added to it so far (Add), each with when it was added: they go with its note. */
      attached?: AttachedItem[];
      /** What Add is getting ready now, while it is: the list shows a screenshot on its way, the menu its video starting. */
      adding?: AddingKind;
      /** Date.now() when it was paused, while it is: the microphone keeps nothing, and the time stands still. */
      pausedAt?: number;
      fakeMic: boolean;
      microphoneId: string | null;
      /** A screen comment's screenshot, small: the card above the bar shows it. */
      thumbnail?: string;
      /** What that screenshot is of, as the saved card tells it too: the front app's name is the label of the card above the bar. */
      context?: ScreenContext;
      /** When its words are filed, now or at the evening review; null where there is nothing to switch (the controller's `toggleFileMode`). */
      fileMode: FileMode | null;
      /**
       * When the open library's evening review files a capture saved for it, worded as for `cancelled`'s `review` (`reviewTime`): "at
       * 21:00", "on Sundays at 18:00"; "" when its schedule can't be read; null while the review is off. Read when the recording
       * starts. The file-mode button names it (`fileModeLabel`), so that it promises no review that won't come.
       */
      review: string | null;
      /**
       * The shortcut that finishes this recording, for the card to name while the first recordings teach the keys: Record a
       * thought's, or Capture screen's for a screen comment. Set until the controller's `HINT_CAPTURES` recordings
       * have been kept, and while that shortcut is registered; null otherwise.
       */
      hint: string | null;
      /** The page sends main its microphone as it hears it (`sendLiveAudio`), for the words as they are said and to look at what has focus. */
      live?: true;
      /** The words so far, while they are said (`LiveWords`): a preview, kept nowhere. Absent until there are some, and where they may not show. */
      words?: string;
      /** Set only for a dictation into another app (the controller's `startCursorRecording`). */
      dictation?: DictationState;
    }
  /**
   * `onThisMac`: the library's speech-to-text runs on this Mac, which the card then says; a command can run anywhere. `slow`: it has run
   * past the controller's TRANSCRIBE_STOP_MS, so the card offers Stop (the controller's `stopTranscribing` tells the rest). Absent
   * before then, and always for a screen comment and for setup's first spoken thought, which have no Stop. `thumbnail` and `context`:
   * a screen comment's screenshot and what it is of, as it had them while it listened, so that the card above the bar stays while the
   * words are made and the saved card that follows does not come after a gap.
   */
  | { kind: "transcribing"; mode: CapsuleMode; onThisMac: boolean; slow?: true; thumbnail?: string; context?: ScreenContext; words?: string; dictation?: DictationState }
  | {
      kind: "filing";
      text: string;
      agent: string;
      /** How long its words took to make, in seconds; null for a note that was typed. */
      transcribedIn: number | null;
      /** As for "transcribing": where the words were made, which the card says only when it is on this Mac. */
      onThisMac: boolean;
      /** Whether the card offers Edit: not once Stop was pressed (`cancelling`). */
      canEdit: boolean;
      detail?: string;
      /**
       * Not running yet, because it waits: for its turn in the app's own queue (another run of Avanzel's own has it: a filing, a
       * review, a take-back), or for the library (another run has it: a question, a review, another Avanzel). The card says so
       * and counts no seconds until the run starts.
       */
      waiting?: boolean;
      /**
       * What the agent has done so far in this filing, oldest first and the newest fifty at most (`withStep`); the card's
       * newest line is the last row. Empty until its first step. A row belongs to the filing that took the step: a newer
       * capture's card never carries an older filing's.
       */
      rows: NarrationRow[];
      /**
       * Date.now() when the run had the library: the card counts its seconds from it. It moves forward when the filing's turn
       * in the queue comes, and again when a wait for the library ends, so those waits are in no filing's seconds.
       */
      startedAt: number;
      /** About how many seconds a filing with this agent takes, from its last ones (`estimateSeconds`); 15 until it has done three. */
      estimate: number;
      /** Date.now() when the filing last took a step, or when its run began before the first: the card says the agent is still working once this is old. */
      stepAt: number;
      /** Stop was pressed and the stop is not over; absent otherwise. The controller's `cancelFiling` tells the rest. */
      cancelling?: true;
    }
  | { kind: "editing"; text: string }
  | {
      kind: "filed";
      /** The note's words, which the card shows stamped. */
      text: string;
      agent: string;
      /** How long the run took, from when it had the library. */
      seconds: number;
      /** The pages the filing wrote, new ones first; the card lists three of them. Each opens through `capsule.openPage`. */
      pages: FiledPage[];
      canUndo: boolean;
      /** The agent filed nothing: it ended well and wrote no page, only a line in the log. */
      noted: boolean;
      /** The engine put the person's words back after the agent changed them (`FileOutcome.restored`): the card says so in its head. Absent otherwise. */
      restored?: true;
      /**
       * "Show the last receipt" put this card up again (`Controller.showLastReceipt`): its stamp is still and dated `filedAt`, and it makes
       * no sound. Absent on the card a filing puts up.
       */
      reprint?: { filedAt: number };
    }
  /** Stop ended a filing, and its note is in the inbox. The controller's `cancelFiling` tells the rest. */
  | {
      kind: "cancelled";
      /** The note's words. */
      text: string;
      /** Whose run was stopped: the copy names it when its partial edits stay. */
      agent: string;
      /** What the stopped run did stays, as its own commit, because taking it back failed. */
      partial: boolean;
      /**
       * How many files the stopped run changed that nothing recorded, in a library without git or with automatic commits off:
       * there is no commit to take them back from, so they stay as they are. 0 when it changed nothing, and when it was taken back.
       */
      leftovers: number;
      /**
       * When the evening review files the note, as the open library's review runs (`reviewTime`): "at 21:00", "on Sundays at
       * 18:00"; "" when its schedule can't be read, so that the sentence names no time; null while the review is off.
       */
      review: string | null;
    }
  /** Stop ended a transcription, and its recording waits in the inbox. The controller's `stopTranscribing` tells the rest. */
  | {
      kind: "recorded";
      /** When the evening review turns the recording into words and files it, worded as for `cancelled`'s `review`. */
      review: string | null;
    }
  /**
   * Words saved to the inbox, for the evening review or a screen comment (`thumbnail` and `context` are the screenshot's); `note`
   * says where they are. `undone`: Undo took a filing back, and these are its words, in the inbox again; the card then says so, and
   * its `note` says when the evening review files them (`undoneNote`).
   */
  | { kind: "saved"; text: string; thumbnail?: string; context?: ScreenContext; note: string; detail?: string; undone?: true }
  /**
   * A problem, told as the windows tell theirs (shared/problems.ts): `message` says what happened and `detail` what is safe, a line
   * of it for each "\n". `command`: the part of `detail` the person types in Terminal, which follows "Run " there and which the card
   * sets in code; absent for a problem that names none. `action`: what the card's one button does (see CardAction), and
   * `actionLabel` what it says; "Open Settings" when it names none. A card with no `action` offers Hide alone.
   */
  | { kind: "error"; message: string; detail?: string; command?: string; action?: CardAction; actionLabel?: string }
  /** The shortcut, while the speech models download: how far along they are, and typing instead. */
  | {
      kind: "preparing";
      receivedBytes: number;
      /** 0 while the size isn't known. */
      totalBytes: number;
    }
  /**
   * The shortcut, after the speech models' download failed: typing instead, or Try again. `reason` names the file and why,
   * without the URL it came from; `resumable` says part of the download was kept, so Try again continues where it
   * stopped (otherwise it downloads the file again).
   */
  | { kind: "model-failed"; reason: string; resumable: boolean }
  /**
   * At launch or when a library is set up, once per shortcut, and as the shortcuts change while it shows: another app
   * holds `key`'s shortcut, `accelerator`.
   */
  | {
      kind: "shortcut-taken";
      key: keyof Shortcuts;
      accelerator: string;
      /** The app that probably holds it: a running app whose default shortcut it is. */
      holder: string | null;
      /** Free shortcuts to use instead, best first; with none, the notice offers Settings. */
      alternatives: string[];
    }
  /** A free shortcut picked on that notice works: `key` now uses `accelerator`. It hides by itself. */
  | { kind: "shortcut-picked"; key: keyof Shortcuts; accelerator: string }
  /** The Undo shortcut was pressed with no filing to take back: a bar says so. It hides by itself. */
  | { kind: "nothing-to-undo" }
  /** A thought, a screen comment or a question was asked for while notes on a call run: a bar says so. It hides by itself. */
  | { kind: "call-running" }
  /** A dictation into any app was asked for while a thought records or notes on a call run: a bar says so. It hides by itself. */
  | { kind: "dictation-refused" };

/**
 * The capsule's cards the panel shows instead, in its Processing tab: a filing, and what came of it (filed, stopped, or a problem). The
 * capsule keeps the state, which the panel draws, and shows nothing for them: its page lets the capsule go as for "hidden".
 */
export const CAPSULE_IN_PANEL: ReadonlySet<CapsuleState["kind"]> = new Set(["transcribing", "filing", "filed", "cancelled", "error"]);

export interface Shortcuts {
  dictate: string;
  capture: string;
  type: string;
  ask: string;
  /** Takes the last filing back from any app (the menu's Undo the last filing). */
  undo: string;
  /** Takes notes on a call: the panel's list of calls opens, or, while one runs, the notes stop. */
  call: string;
  /** Captures a part of the screen, picked with macOS's crosshair, with a comment (Capture the screen's Pick a part). */
  region: string;
  /** Takes a screenshot of a part of the screen, picked with macOS's crosshair, as a thought of its own (Take a screenshot's A part). */
  shot: string;
  /** Takes a screenshot of the whole screen as a thought of its own (Take a screenshot's The whole screen). */
  shotScreen: string;
  /** Takes a screenshot of a part, marked in place first, as a thought of its own (Take a screenshot's With marks). */
  shotMarks: string;
}

export type FileMode = "now" | "evening";

export interface AppSettings {
  version: 1;
  libraryPath: string | null;
  shortcuts: Shortcuts;
  fileMode: FileMode;
  microphoneId: string | null;
  launchAtLogin: boolean;
  /** The person has agreed, once, to Avanzel hearing a call app's sound for call notes. */
  callConsent: boolean;
  /** Dictating into any app: a tap of `key` starts and ends a dictation whose words go in at the cursor. Off until the person turns it on. */
  cursorDictation: { enabled: boolean; key: CursorKey };
  /**
   * A thought started by voice, as Siri is: while `enabled`, the microphone stays open and saying `word` starts recording a thought, as
   * Record a thought's shortcut does, and saying `stopWord` while it records stops it, as Stop does (the word is cut from its text).
   * Off until the person turns it on.
   */
  voiceTrigger: { enabled: boolean; word: string; stopWord: string };
}

export type PermissionStatus = "granted" | "denied" | "not-determined" | "restricted" | "unknown";

/** What the check of an agent found (Settings → Agents), or that it is running. */
export type AgentStatus =
  | { kind: "checking" }
  | { kind: "signed-in"; seconds: number }
  | { kind: "replied"; seconds: number }
  | {
      kind: "signed-out";
      /** The line of the agent's reply that asked to sign in; empty when its own sign-in command said so. */
      detail: string;
    }
  | { kind: "timeout" }
  | {
      kind: "failed";
      /** The line of the agent's output that says why (the engine's errorLine), or why it couldn't start. */
      detail: string;
    };

/** Whether a check found that its agent works: it is signed in, or it replied. Setup files only with one that does. */
export const agentWorks = (status: AgentStatus | null | undefined): boolean => status?.kind === "signed-in" || status?.kind === "replied";

/** What a check found that keeps an agent from filing until the person acts: it isn't signed in, didn't reply in time, or failed. */
export type AgentProblem = Extract<AgentStatus, { kind: "signed-out" | "timeout" | "failed" }>;

/** Whether `status` is such a problem, rather than an agent that works, one being checked, or one not checked yet. */
export const isAgentProblem = (status: AgentStatus | null | undefined): status is AgentProblem =>
  status?.kind === "signed-out" || status?.kind === "timeout" || status?.kind === "failed";

export interface HarnessInfo {
  name: string;
  available: boolean;
  experimental: boolean;
  /** Its check reads its own sign-in command, which asks the model nothing; the others' check is a prompt. */
  freeCheck: boolean;
  /** Its last check in this app run, or null while it hasn't been checked. */
  status: AgentStatus | null;
}

export type ModelStatus =
  | { kind: "ready"; dir: string }
  | {
      kind: "missing";
      /** What downloading the missing speech models fetches; files in a Hugging Face cache aren't fetched again. */
      bytes: number;
    }
  | { kind: "downloading"; receivedBytes: number; totalBytes: number }
  | {
      kind: "error";
      /** download: the download failed, and trying again may work. settings: the library's [voice] settings can't be used, so nothing downloads. */
      cause: "download" | "settings";
      /** download: the file and why it failed, without the URL it came from. settings: what is wrong with the settings. */
      message: string;
      /** download: part of the file was kept, so Try again continues where it stopped. settings: false, since nothing downloads. */
      resumable: boolean;
    };

export interface TaskInfo {
  id: string;
  name: string;
  schedule: string;
  kind: string;
  agent: string;
  enabled: boolean;
  instructions: string;
  lastRun: string | null;
  nextRun: string | null;
  running: boolean;
}

/** A file in tasks/ that can't be used as a shadow task, and why. */
export interface TaskFileProblem {
  /** Library-relative, e.g. "tasks/standup.md". */
  file: string;
  message: string;
}

export interface LibraryInfo {
  path: string;
  /** The path with the home folder as "~" (tildePath). */
  label: string;
  exists: boolean;
  /** The library has a .git folder: it has git history, which this Mac may or may not be able to add to (`gitUsable`). */
  isGit: boolean;
  /**
   * This Mac can run git (the engine's gitUsable): false without Apple's Command Line Tools, where /usr/bin/git is only a stub
   * that opens Apple's install dialog. A library with a .git folder then keeps its history, but nothing commits, so nothing
   * can be undone.
   */
  gitUsable: boolean;
  /** config.toml's auto_commit: with it off, no change is a commit, even in a library with git. True when the settings can't be read. */
  autoCommit: boolean;
  inbox: number;
  shelves: Record<string, number>;
  harness: string;
  models: Record<string, string>;
  timeoutSeconds: number;
  /** config.toml's `[voice] dictionary`: the owner's lines, "Term" or "Term = heard as, other", as saved (cleaned). */
  dictionary: string[];
  /** config.toml's `[dictation] log`: each dictation is also kept in the library's day file, `raw/dictations/YYYY-MM-DD.md`. */
  dictationLog: boolean;
  /** `[dictation] skip_apps`: bundle ids whose dictations are pasted but kept nowhere. */
  dictationSkipApps: string[];
  /** `[dictation] skip_sites`: websites (hosts) whose dictations are pasted but kept nowhere. */
  dictationSkipSites: string[];
}

/** What Settings changes in the library's config.toml (`setLibrary`); a key left out keeps its value. */
export interface LibraryPatch {
  harness?: string;
  models?: Record<string, string>;
  timeoutSeconds?: number;
  /** The Dictionary field's lines as typed: main stores them cleaned (`cleanDictionary`). */
  dictionary?: string[];
  dictationLog?: boolean;
  /** The skip-list fields' lines as typed: main stores them cleaned (`cleanSkipList`). */
  dictationSkipApps?: string[];
  dictationSkipSites?: string[];
}

/** Everything the settings window shows, in one snapshot. */
export interface SettingsSnapshot {
  app: AppSettings;
  library: LibraryInfo | null;
  /** Why the library at `app.libraryPath` couldn't be opened, if it couldn't. */
  libraryProblem: string | null;
  harnesses: HarnessInfo[];
  selectedHarness: string | null;
  model: ModelStatus;
  /**
   * What turns speech into words, from the library's [voice] settings (the defaults while there is none, or its settings can't
   * be read): the engine's backend name, "onnx-asr" or "command", and the model it names. The speech row says which languages
   * it hears from these. A backend the engine doesn't know reads "onnx-asr": its Notice says the settings can't be used.
   */
  voice: { backend: "onnx-asr" | "command"; model: string };
  permissions: { microphone: PermissionStatus; screen: PermissionStatus };
  tasks: TaskInfo[];
  taskProblems: TaskFileProblem[];
  shortcutProblems: Partial<Record<keyof Shortcuts, string>>;
  /** For each shortcut another app holds, the free ones to use instead, best first (empty when none of them is free). */
  shortcutAlternatives: Partial<Record<keyof Shortcuts, string[]>>;
  obsidian: boolean;
  /** Open in Obsidian works: Obsidian is installed, and the library has .obsidian/ (obsidianUrl). */
  opensInObsidian: boolean;
}

/** One choice of a native pop-up menu, as Settings' pop-up buttons offer it. */
export interface PickOption { label: string; value: string; checked: boolean }

/**
 * How to install an agent, when this Mac has none: each vendor's own command for macOS, as its install docs give it
 * (Claude Code's setup page, and OpenAI's Codex CLI page and README; checked on 21 October 2026). Found shows them, and
 * its Copy names one by its key, so the text that reaches the clipboard is always one of these.
 */
export const AGENT_INSTALLS = {
  claude: { label: "Claude Code", command: "curl -fsSL https://claude.ai/install.sh | bash" },
  codex: { label: "Codex", command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh" },
} as const;

/** An agent Found says how to install: a key of AGENT_INSTALLS. */
export type AgentInstall = keyof typeof AGENT_INSTALLS;

/** An installed agent, as setup lists it under "Who should do the filing?". */
export interface SetupAgent {
  /** The harness name: "claude". */
  name: string;
  /** "Claude Code" (harnessName). */
  label: string;
  /** Its check reads its own sign-in; the others are asked one short question when picked. */
  freeCheck: boolean;
  /** What its check found in this app run; null while it hasn't been checked. */
  status: AgentStatus | null;
}

/** How the press of Record a thought's shortcut went on the first-thought step. */
export interface SetupPress {
  /** Registering it failed: another app holds it. */
  taken: boolean;
  /** A press arrived since the step asked for one: the shortcut works. */
  heard: boolean;
  /** The person reached for it (its first modifier went down in the window), and no press followed within the wait (3 s). */
  silent: boolean;
  /** The running app whose default shortcut it is, if one is running. */
  holder: string | null;
  /** Free shortcuts to use instead, best first: filled when taken or silent. */
  alternatives: string[];
}

/**
 * What went wrong with the first spoken thought's recording, which setup says in its own words: the recording never
 * reached Avanzel ("lost"), the microphone didn't start, no words were heard in it ("silence"), its words couldn't be
 * made ("unheard"), or they were made but couldn't be saved ("unsaved").
 */
export type RecordingProblem = "lost" | "microphone" | "silence" | "unheard" | "unsaved";

/**
 * The first spoken thought, from the press to its words, on the first-thought step. The capsule records it; once the
 * words exist, a thought moves on to its filing (`filing`), and only a mic check stays here.
 */
export type SetupThought =
  /** Nothing is under way: the step asks for a press. */
  | { kind: "waiting" }
  /** macOS hasn't asked about the microphone yet: the primer says it will, and Continue has it ask. */
  | { kind: "primer" }
  /** The microphone is turned down (or restricted): the step says where to allow it. */
  | { kind: "denied" }
  /** The capsule records it; `startedAt` is the recording's Date.now(). */
  | { kind: "listening"; startedAt: number }
  /**
   * The recording has stopped, and its words are being made; `startedAt` is the stop's Date.now(). `onThisMac`: the library's
   * speech-to-text runs on this Mac, which the step then says; the command in a library's settings can run anywhere.
   */
  | { kind: "transcribing"; startedAt: number; onThisMac: boolean }
  /** Its words are a mic check ("Testing, testing"), kept in the inbox until File it anyway or Try again. */
  | { kind: "test"; words: string }
  /**
   * The recording or its transcription went wrong (`problem`). `kept`: its recording is kept in the library, under
   * raw/audio/; nothing else of it is.
   */
  | { kind: "failed"; problem: RecordingProblem; kept: boolean };

/**
 * The line a setup filing fails with when its note left the inbox before its agent could start, as when another Avanzel
 * filed it meanwhile: the words aren't in the inbox then, and filing that note again can't work.
 */
export const NOTE_GONE = "The note isn't in the inbox any more.";

/**
 * What main refuses a review's save with when it lists no review of that id, the list its snapshot's `tasks` come from:
 * the review's file has gone (or, rarely, was changed by hand into one that can't be used). Settings tells that refusal
 * from the others by it.
 */
export function noSuchReview(id: string): string {
  return `No scheduled review called ${id}.`;
}

/**
 * One thing the agent did while it filed the first thought, as a row of the Filing step: it read a page, searched the
 * library, wrote a new page or an old one again, or removed one. A row names a page of the library, never the capture, a
 * path under inbox/ or raw/, or a dot path.
 */
export interface NarrationRow {
  kind: "read" | "search" | "new" | "updated" | "removed";
  /** The library path; null for a search. */
  path: string | null;
  /**
   * pageInfo's title; for a file that isn't Markdown, its file name with the extension; for "removed", the file name
   * without .md; "" for a search.
   */
  title: string;
  /** The first folder of a path inside a folder; "" for a root file or a search. */
  shelf: string;
}

/** The first thought's filing, in the setup window. */
export type SetupFiling =
  | {
      kind: "running";
      words: string;
      agent: string;
      /** Date.now() at the start: when the filing began, or when its wait for the library ended. */
      startedAt: number;
      /** Another run has the library. */
      waiting: boolean;
      /** Cancel was pressed; it is stopping. */
      cancelling: boolean;
      /** What the agent has done so far, oldest first and the newest fifty at most (`withStep`). */
      rows: NarrationRow[];
      /**
       * Every Markdown path it has written so far, new or updated, each once, as library paths (`withWritten`); the
       * shelf tabs count those on a shelf. Not cut to fifty as the rows are, so a tab's count doesn't fall in a long
       * filing.
       */
      written: string[];
    }
  | {
      kind: "filed";
      words: string;
      agent: string;
      seconds: number;
      /** New pages first. */
      pages: FiledPage[];
      /** How many of pages are new. */
      created: number;
      /** The filing is its own commit. */
      canUndo: boolean;
      /** Undo was pressed, and the filing is being taken back. */
      undoing: boolean;
      /** Git refused to take the filing back: a later change touched what it wrote. */
      undoRefused: boolean;
    }
  /** Undo took the filing back: its pages are gone, and its words are in the inbox again. */
  | { kind: "undone"; words: string }
  | {
      kind: "cancelled";
      words: string;
      /** Whose run was stopped: the copy names it when its partial edits stay. */
      agent: string;
      /** What the stopped run did stays, as its own commit, because taking it back failed. */
      partial: boolean;
      /**
       * How many files the stopped run changed that nothing recorded, in a library without git or with automatic commits off:
       * there is no commit to take them back from, so they stay as they are. 0 when it changed nothing, and when it was
       * taken back.
       */
      leftovers: number;
    }
  | {
      kind: "failed";
      words: string;
      agent: string;
      /** errorLine of the failure, or NOTE_GONE. */
      line: string;
      /**
       * Why it failed, which the window tells in the capsule's words (`filingProblem`, with "try again" where the capsule
       * promises a wait). Null for NOTE_GONE: the note left the inbox before any run, so no agent failed.
       */
      failure: AgentFailure | null;
      /** What the failed run left behind in the library; null for NOTE_GONE. */
      partial: PartialEdits;
    };

/** A question on the Ask step, from the moment it is asked. */
export type SetupAnswer =
  /** The library's agent is answering it; `startedAt` is Date.now() when it began, or when its wait for the library ended. */
  | {
      kind: "asking";
      question: string;
      startedAt: number;
      /** Another run (the filing in progress, say) has the library. */
      waiting: boolean;
    }
  /** The answer's lines (answerSources), and the pages its [[links]] name that are in the library. */
  | { kind: "answered"; question: string; paragraphs: string[]; sources: FiledPage[] }
  /**
   * The question failed. `failure` says why, which the step tells as the Ask window does (`askProblem`); null when no agent
   * failed because the question never reached one (no library, settings that can't be read), when `line` (errorLine) says why.
   * `changedFiles`: how many files the run left changed in the library; 0 when nothing ran.
   */
  | { kind: "failed"; question: string; agent: string; line: string; failure: AgentFailure | null; changedFiles: number };

/** Everything the setup window shows, in one snapshot (setup:changed). Later tasks add fields. */
export interface SetupSnapshot {
  /** Where Looks good makes or uses the library: the stored libraryPath, else ~/Avanzel, until Change… picks another. */
  libraryPath: string;
  /** libraryPath with the home folder as "~". */
  libraryLabel: string;
  folder: LibraryFolder;
  /**
   * Why libraryPath is too broad to be a library (setup-model's tooBroad), or null when it isn't: one of the system's own
   * folders such as /Applications (`system`), or the home folder, a folder macOS makes in it such as Documents, or a disk's
   * root (`broad`). Found says why (tooBroadLine), and nothing is made there.
   */
  tooBroad: TooBroad | null;
  /**
   * This Mac can run git (the engine's gitUsable): false without Apple's Command Line Tools, where /usr/bin/git is only a
   * stub that opens Apple's install dialog. Found then says changes can't be undone, and offers Install git. Setup looks
   * again each time its window gets the focus, so it notices the install.
   */
  gitUsable: boolean;
  /** A library is open. */
  libraryReady: boolean;
  model: ModelStatus;
  /** Record a thought's shortcut, "Alt+Space". */
  shortcut: string;
  /**
   * Type a thought's shortcut, "Alt+Shift+Space", which the last step teaches while Avanzel can't hear yet; null when it
   * didn't register (another app holds it, say), when the step points to the menu bar's Type a thought… instead.
   */
  typeShortcut: string | null;
  /**
   * Set me up found no agent installed on this Mac, and setup looks for one until it comes: Found says how to install
   * one. False before Set me up, and once one is installed.
   */
  noAgent: boolean;
  /**
   * The agents installed when Set me up was pressed, in the harness table's order; none before. With none installed
   * then, the ones installed since, once setup notices the first.
   */
  agents: SetupAgent[];
  /**
   * The agent that will file: the person's pick, else the library's own when the folder is one and its agent works,
   * else the best one known to work (bestAgent); null while there is none.
   */
  agent: string | null;
  /** Why Looks good couldn't make or use the library at libraryPath; null until a try fails, and again once one works or Change… picks a folder. */
  makeProblem: string | null;
  /**
   * The first-thought step's test of `shortcut`: whether another app holds it, or else whether a press arrived. It starts
   * over each time the step is entered and each time the shortcut changes there.
   */
  press: SetupPress;
  /** The first thought's filing, from the moment the thought is handed over; null before. */
  filing: SetupFiling | null;
  /** Why a typed thought wasn't taken (a capture that couldn't be written); null once one is. */
  typeProblem: string | null;
  /** The first spoken thought on the first-thought step; waiting until a press, and again once its words are handed over. */
  thought: SetupThought;
  /** Setup can turn speech into words: the speech models are ready, or AVANZEL_FAKE_TRANSCRIPT stands in for them. */
  hears: boolean;
  /** A page opens in Obsidian: it is installed, and the library is a vault of its (obsidianUrl). */
  opensInObsidian: boolean;
  /**
   * The question the Ask step suggests about the first filing's pages (suggestQuestion), while they stand: null before
   * the filing is filed, once an undo of it has begun, and when it wrote no page.
   */
  suggestion: string | null;
  /** The question on the Ask step and how it went; null until one is asked, and again after Skip. */
  answer: SetupAnswer | null;
  /** Avanzel opens when the person logs in (AppSettings.launchAtLogin): the last step turns it on the first time it shows. */
  launchAtLogin: boolean;
  /** The library's evening review, the shadow task whose kind is "evening-review"; null without a library, or one that has none. */
  eveningReview: TaskInfo | null;
  /**
   * Where macOS stands on the two permissions, read afresh each time the window has the focus again (as from System
   * Settings). The microphone and screen steps show only while theirs isn't "granted".
   */
  permissions: { microphone: PermissionStatus; screen: PermissionStatus };
  /**
   * Open System Settings was used on the screen step. macOS applies a Screen Recording grant only when Avanzel starts
   * again, so Start using Avanzel reopens Avanzel once; the last step says so.
   */
  screenOpened: boolean;
}

/** What Zel's bubble says, once setup has ended in the menu bar. */
export interface UpHereSnapshot {
  /** Record a thought's shortcut, "Alt+Space". */
  shortcut: string;
  /** Type a thought's shortcut, "Alt+Shift+Space"; null when it didn't register, when the bubble points to the menu instead. */
  typeShortcut: string | null;
  /** Avanzel can turn speech into words: until it can, the bubble offers typing instead of talking. */
  hears: boolean;
  /** The speech model, which says why Avanzel can't hear yet: still on its way, or its download failed. */
  model: ModelStatus;
}

/**
 * What the Ask window draws around its field, read in one go (`ask.get`) so that it draws what was read at one moment: one drawn
 * means all three were read.
 */
export interface AskSnapshot {
  /** How many pages the six shelves hold, as Settings' library line counts them (a folder of the owner's own doesn't count): 0 tells the window to invite a first thought rather than a question. */
  pages: number;
  /** The questions to suggest before the first one, as sentences: one about each of the pages filed last, newest first, at most three (none while `pages` is 0). */
  suggestions: string[];
  /**
   * Record a thought's shortcut as an accelerator ("Alt+Space"), which says a question in this window; null while it isn't registered, as
   * there is then no key to name. The window names it only while `pages` isn't 0: with no page there is nothing to ask about, and the
   * press records a thought.
   */
  shortcut: string | null;
}

export interface AskResult {
  ok: boolean;
  /**
   * ok: the agent's reply. Otherwise what failed: "{agent} couldn't answer.\n{its last lines}" for a run that failed, or
   * the message alone when nothing ran (no library, a question the engine refuses).
   */
  answer: string;
  agent: string;
  seconds: number;
  /** ok: the reply's lines, as answerSources reads them; [] otherwise. */
  paragraphs: string[];
  /** ok: the pages its [[links]] name that are in the library; [] otherwise. */
  sources: FiledPage[];
  /**
   * How many files the run left changed in the library: created, changed or deleted. An agent asked read-only leaves none,
   * but one that doesn't keep to it may. 0 when nothing ran.
   */
  changedFiles: number;
  /**
   * Why it failed, as the window tells it (`askProblem`): null for an answer, and for a question that never reached an agent
   * (no library, settings that can't be read, a question the engine refuses), when `answer` says why. A library whose agent
   * isn't installed is told by its failure (`gone`, or `missing` when none is).
   */
  failure: AgentFailure | null;
  /**
   * The root of the library the question was asked in, read as it began; null when none was open. The window hands it back with Save
   * (`ask.save`), so an answer is saved only in the library it came from, whichever is open by then.
   */
  library: string | null;
}

/** How a save of an answer as a page ended (`ask.save`). */
export type SaveResult =
  /** The agent wrote the page. `commit` is the save's own, which takes it back: null without git, or with automatic commits off. */
  | { kind: "saved"; page: FiledPage; commit: string | null }
  /**
   * Nothing was saved. `failure` says why, as the window tells it (`saveProblem`); null for a run that ended well and wrote no page.
   * `partial` is what the run left in the library.
   */
  | { kind: "unsaved"; agent: string; failure: AgentFailure | null; partial: PartialEdits }
  /** Stop, or closing the window, gave the save up. `partial` is what the run left in the library. */
  | { kind: "stopped"; agent: string; partial: PartialEdits };

/** Preload bridge exposed as `window.avanzel`. */
export interface AvanzelBridge {
  capsule: {
    onState(callback: (state: CapsuleState) => void): () => void;
    /** Listening now: send the current state again (one sent while the page loaded is lost). */
    ready(): void;
    /** The recording's Add menu: macOS's open panel, and the files picked go with the recording's note. */
    addFiles(): void;
    /**
     * The recording's Add menu: a screenshot goes with the recording's note, of the screen as it is (without the capsule), or with
     * `area`, of a part of it the person picks with macOS's crosshair.
     */
    addScreenshot(area?: boolean): void;
    /** The recording's Add menu: a video of a part of the screen, picked and stopped in macOS's capture toolbar, goes with the note. */
    addVideo(): void;
    /** The recording's Add menu: a part of the screen, picked, taken as a picture and marked in place, goes with the note. */
    addMarked(): void;
    /** Files dropped on the recording's bar: they go with its note. */
    attachToRecording(files: File[]): void;
    /**
     * Where the recording's bar is, in the capsule's points, while it takes dropped files; null when it takes none. The capsule lets the
     * pointer through where nothing is drawn, and a drag brings it no enter: main watches the pointer itself, and the window takes it
     * over this place, so a file dragged there lands on the bar.
     */
    setDropZone(zone: { x: number; y: number; width: number; height: number } | null): void;
    /** One of the recording's added files, by its place in the list, taken off it (its copy goes from the library). */
    removeAttachment(index: number): void;
    onCommand(callback: (command: CapsuleCommand) => void): () => void;
    sendAudio(samples: Float32Array): Promise<void>;
    /** What a dictation's microphone has heard since the last block, about every second while it listens: for its words as they are said. */
    sendLiveAudio(samples: Float32Array): void;
    /**
     * A block of the microphone of the call `call` (the id its call-start command gave), about every 5 s while the call runs; `last` once
     * its microphone has stopped.
     */
    sendCallAudio(call: number, samples: Float32Array, last: boolean): Promise<void>;
    /** A span of speech the voice trigger heard: main makes it into words and listens for the trigger word in them. */
    sendTriggerAudio(samples: Float32Array): Promise<void>;
    /** Stop, on the listening card of a call: the call ends and becomes its notes. */
    stopCall(): void;
    reportMicError(message: string): void;
    setInteractive(interactive: boolean): void;
    edit(): void;
    /** The editor's text, on every change: kept if Avanzel quits or a recording starts before File or Cancel. */
    editDraft(text: string): void;
    submitEdit(text: string): void;
    cancelEdit(): void;
    /** Stop, on the card of a filing. The controller's `cancelFiling` tells what it does and when it is heard. */
    cancelFiling(): void;
    /** The file-mode switch, while a recording listens. The controller's `toggleFileMode` tells what it does and when it is heard. */
    toggleFileMode(): void;
    /** The microphone's level now, 0 to 1, while a recording listens: passed on to the menu bar panel for its wave. */
    level(level: number): void;
    /** The bar's Stop: the recording ends and is kept, as its shortcut ends it. */
    stop(): void;
    /** The bar's Cancel: the recording is given up, as Esc gives it up. */
    cancel(): void;
    /** The bar's Pause and Resume. */
    pause(): void;
    /** Stop, on the card of a transcription that has run long (`slow`). The controller's `stopTranscribing` tells what it does. */
    stopTranscribing(): void;
    undo(): void;
    open(): void;
    /**
     * A page's title on the filed card: that page opens, as Open opens the first, and the card stays. `path` is library-relative, and
     * only a page the newest filing wrote is opened (the controller's `openFiledPage`), only for the capsule's own page: sent from
     * any other window, or for any other path, it opens nothing. Ask's `openPage` opens a page by name for the Ask window and setup.
     */
    openPage(path: string): void;
    dismiss(): void;
    keepOpen(keep: boolean): void;
    /**
     * An error card's one button, or a notice's Open Settings (see CardAction). The Ask window's Open Settings uses it too,
     * with "open-settings:agents", when the library's agent isn't installed, and setup's does, with "open-settings:general".
     * The card it was pressed on goes (an error card, or a taken shortcut's notice); whatever else the capsule shows, a
     * recording or a note being edited, stays as it is.
     */
    openSettingsFor(action: string): void;
    /** Try again, after the speech models' download failed: it starts over, and the capsule shows its progress. */
    retryDownload(): void;
    /**
     * Type instead, while Avanzel can't listen yet: the capsule hides and Quick opens, unless the Ask window is the key window with a page
     * on a shelf (the controller's `pressAsks`): its field is in front already, and only the capsule goes.
     */
    typeInstead(): void;
    /** Use, on the notice of a taken shortcut: `accelerator` becomes `key`'s shortcut. */
    useShortcut(key: keyof Shortcuts, accelerator: string): void;
  };
  settings: {
    get(): Promise<SettingsSnapshot>;
    onChanged(callback: (snapshot: SettingsSnapshot) => void): () => void;
    /** Settings is open and something else (an error card's Open Settings) asks for another pane. */
    onShowPane(callback: (pane: SettingsPane) => void): () => void;
    setApp(patch: Partial<AppSettings>): Promise<SettingsSnapshot>;
    /** Shortcuts records a new one: Avanzel's own let go meanwhile, so the keys reach the page; registered again when it ends. */
    recordingShortcut(recording: boolean): void;
    /** Turns dictating into any app on or off, or chooses its key; what isn't in `patch` stays. The helper starts, stops or watches the new key at once. */
    setCursorDictation(patch: Partial<AppSettings["cursorDictation"]>): Promise<SettingsSnapshot>;
    /**
     * What macOS has granted for dictating into any app, and whether this Mac can do it at all. It answers while the setting is off
     * too, and leaves nothing running.
     */
    cursorPermissions(): Promise<CursorPermissionState>;
    /**
     * Has macOS ask for both permissions, and opens System Settings at `permission` if it is missing; with none named, at the one still
     * missing (Input Monitoring first, as the key can't be seen without it). Resolves with what was granted at the time it asked.
     */
    askCursorPermissions(permission?: CursorPermission): Promise<CursorPermissionState>;
    /**
     * The newest `limit` dictations at the cursor (DICTATION_PAGE when it is not a whole number above 0), newest first, each as the
     * Dictation pane shows it, with the total the history holds. Needs no library.
     */
    listDictations(limit?: number): Promise<DictationList>;
    /** Dictation `id`'s whole words go on the clipboard. False when there is no such dictation or the clipboard refused. */
    copyDictation(id: string): Promise<boolean>;
    /** Forgets dictation `id`. A history that can't be rewritten keeps it, and says so in plain words. */
    deleteDictation(id: string): Promise<DeleteDictationResult>;
    /** The history changed (a dictation finished, or one was forgotten, here or from the menu): the pane lists it again. */
    onDictationsChanged(callback: () => void): () => void;
    setLibrary(patch: LibraryPatch): Promise<SettingsSnapshot>;
    chooseLibrary(): Promise<SettingsSnapshot>;
    downloadModel(): Promise<SettingsSnapshot>;
    saveTask(task: Pick<TaskInfo, "id" | "name" | "schedule" | "agent" | "enabled" | "instructions">): Promise<SettingsSnapshot>;
    runTask(id: string): Promise<SettingsSnapshot>;
    /**
     * Starts the free checks of installed agents not checked yet in this app run, which never ask the model; their
     * results arrive through onChanged.
     */
    checkAgents(): Promise<SettingsSnapshot>;
    /** Checks agent `name` again, its prompt included; the result arrives through onChanged. */
    checkAgent(name: string): Promise<SettingsSnapshot>;
    openLibrary(): void;
    /** Show in Finder: the library's folder opens in Finder. */
    showLibrary(): void;
    /** Set up Avanzel…: setup opens or comes forward, and Settings closes. */
    openSetup(): void;
    openPrivacy(pane: "microphone" | "screen"): void;
    /**
     * Quit and reopen, on Privacy's screen row: macOS applies a Screen Recording grant only when Avanzel starts again. Avanzel
     * quits as it does anywhere, stopping a filing under way first (its note stays in the inbox), and opens again.
     */
    relaunch(): void;
    requestPermission(kind: "microphone" | "screen"): Promise<SettingsSnapshot>;
    /** A pop-up button: a native menu of `options` pops up at `at` (window points; null: at the pointer). Resolves with the
        value picked, or null when the menu closes without one. Only the Settings window's own page is answered: sent from any
        other window, it resolves null and shows no menu. */
    pick(options: readonly PickOption[], at: { x: number; y: number } | null): Promise<string | null>;
    /** What the pane in view needs, in px: the window takes that height, within the screen, at once. Only the Settings window's own page is heard. */
    fit(height: number): void;
    /** The colour the page is drawn on, as the page computes it ("rgb(35, 34, 40)"): the window fills with it where the page hasn't drawn yet. Only the Settings window's own page is heard. */
    surface(color: string): void;
  };
  quick: {
    submit(text: string): Promise<void>;
    close(): void;
  };
  ask: {
    ask(question: string): Promise<AskResult>;
    /**
     * Saves `answer`, the one the person was shown to `question`, as a page of the library it came from (`library`, as
     * AskResult gave it): the agent writes the page and the app commits it. It saves nothing in another library than the open one;
     * the result says so. Only the Ask window's own page may save: sent from any other window, it rejects and runs nothing.
     */
    save(question: string, answer: string, library: string | null): Promise<SaveResult>;
    /**
     * Undo, on the turn whose answer `save` saved as a page: git takes the save's commit (`SaveResult.commit`) back, in the library it was
     * saved in, whichever is open by then. Whether it did. False when git refuses (usually a later change touched the same lines) or the
     * revert fails, and for a commit this window wasn't handed or has tried already: each has one try, and the window's closing ends the
     * right to ask for one (the library's history keeps the saves), not an Undo already asked for, which main goes on with. It tells no
     * one: the turn that asked does. Only the Ask window's own page may; sent from any other window, it resolves false and takes nothing
     * back.
     */
    undoSave(commit: string): Promise<boolean>;
    /** What the question or save in progress is doing now, e.g. waiting for a filing to finish, then looking through the library. */
    onProgress(callback: (message: string) => void): () => void;
    /**
     * Stop, while a question is answered or an answer is saved: it is given up as closing the window gives it up. Its agent
     * stops, and the library is free for a filing waiting on it; what ask() or save() then sends back is the cancelled run's.
     * Only the Ask window's own page is heard: sent from any other window, it gives up nothing.
     */
    cancel(): void;
    openPage(name: string): void;
    close(): void;
    /**
     * What the window draws around its field: the shelves' page count, the questions to suggest and the shortcut that says a question, read
     * at one moment (the shelves are counted once). Read when the window opens, whenever it has the focus, and whenever main says the
     * shelves may have changed (`onChanged`).
     */
    get(): Promise<AskSnapshot>;
    /**
     * The shelves may have changed (a filing ended, a filing or a review was taken back, another library opened): read again (`get`). The
     * capsule that files a thought never takes the key, so with this window in front no focus comes to say so.
     */
    onChanged(callback: () => void): () => void;
    /**
     * The words of a question said with Record a thought's shortcut while this window was the key window (they come after a second
     * press, once they are made), for the field: after what is typed there. Only the window the question was said in hears them: one
     * opened since hears none, and a question said to a window that has closed comes to no one.
     */
    onHeard(callback: (words: string) => void): () => void;
  };
  setup: {
    get(): Promise<SetupSnapshot>;
    onChanged(callback: (snapshot: SetupSnapshot) => void): () => void;
    /** The window shows `step` now; the controller hangs what each step starts on it. */
    enter(step: SetupStep): Promise<SetupSnapshot>;
    /**
     * Use {agent}, on Found: installed agent `name` files from now on; setup:changed follows. One that nothing has said
     * yet works (no sign-in command, or one that couldn't be read) is asked its one short question; its result follows too.
     */
    chooseAgent(name: string): Promise<SetupSnapshot>;
    /**
     * Looks good, or Use this folder, on Found: the library at libraryPath is made, or the folder there used, with the
     * chosen agent. It resolves once that is done; a problem comes back as makeProblem.
     */
    createLibrary(): Promise<SetupSnapshot>;
    /** Change…, on Found: the folder picker, whose choice becomes libraryPath. Nothing is made yet. */
    chooseFolder(): Promise<SetupSnapshot>;
    /**
     * Open Terminal, on a signed-out agent's Notice (setup's, and the Ask window's, which has no channel of its own):
     * Terminal opens, for the person to sign the agent in.
     */
    openTerminal(): void;
    /** Copy, beside an install command on Found: the command that installs `agent` goes to the clipboard. */
    copy(agent: AgentInstall): void;
    /**
     * Install git, on Found while this Mac has no usable git (SetupSnapshot.gitUsable): macOS opens Apple's dialog to install
     * the Command Line Tools (`xcode-select --install`). Setup notices once the window has the focus again.
     */
    installGit(): void;
    /**
     * Use {shortcut}, on the first-thought step's Notice of a taken or silent shortcut: `accelerator`, one of those it
     * offers, becomes Record a thought's shortcut, and the step listens for a press of it afresh; setup:changed follows.
     */
    useShortcut(accelerator: string): Promise<SetupSnapshot>;
    /**
     * Record a thought's first modifier (⌥ for ⌥Space) went down on the first-thought step, outside the box for a typed
     * thought: the person reaches for the shortcut, and the step waits for its press (3 s); setup:changed follows.
     */
    reachForShortcut(): void;
    /**
     * File it, on the first-thought step's typing rows: `words` become a note in the inbox, which setup files while the
     * window shows it; setup:changed follows. Words it can't write come back as typeProblem, and no words do nothing:
     * nothing is thrown.
     */
    typeThought(words: string): Promise<SetupSnapshot>;
    /** Cancel, while the first thought is filed: its agent stops, and what it did is taken back. */
    cancelFiling(): void;
    /** File it again, or Try again, once a filing has stopped short or been undone: the same note is filed in a new run. */
    fileAgain(): void;
    /** Undo, or ⌘Z, once the first thought is filed: the filing is taken back, and its words return to the inbox. */
    undo(): void;
    /** Continue, on the microphone's primer: macOS asks, and a grant starts the recording; setup:changed follows. */
    allowMicrophone(): void;
    /**
     * Continue, on the microphone step: macOS asks, if it hasn't. It resolves with the microphone's status once macOS has
     * answered (or has nothing to ask: a microphone turned down stays so), and setup:changed follows.
     */
    askForMicrophone(): Promise<PermissionStatus>;
    /**
     * Open System Settings, on the screen step: Screen Recording opens, after one capture that makes macOS list Avanzel
     * there. The grant applies when Avanzel starts again, which Start using Avanzel does once; setup:changed follows.
     */
    openScreenSettings(): void;
    /**
     * Try again, on a mic check's answer or a recording problem's Notice: a mic check's note and its recording leave the
     * library, and the step asks for the thought afresh; setup:changed follows.
     */
    tryAgain(): void;
    /** File it anyway, on a mic check's answer: its note is filed as the first thought; setup:changed follows. */
    fileAnyway(): void;
    /**
     * The suggestion, or Return in Ask your library, on the Ask step: the library's agent answers `question`, read-only,
     * one question at a time. setup:changed follows as it goes; it resolves once the answer, or the failure, is in.
     */
    ask(question: string): Promise<SetupSnapshot>;
    /** Skip, on the Ask step: the question being answered is given up, and the answer cleared. */
    skipAsk(): void;
    /**
     * Start using Avanzel, on the last step: setup ends, and its window flies into the menu bar icon and closes. Zel's
     * bubble then says Avanzel waits up there (upHere). Under Reduce Motion the window just closes. With the icon hidden
     * it just closes too, and no bubble opens.
     */
    finish(): void;
  };
  /** Zel's bubble under the menu bar icon, once setup has ended there: "I'm up here." */
  upHere: {
    get(): Promise<UpHereSnapshot>;
    /** Try it now: the bubble goes, and Record a thought starts, as its shortcut would start it. */
    tryIt(): void;
    /** Type a thought, while Avanzel can't hear yet: the bubble goes, and Quick opens for the thought. */
    typeIt(): void;
    /** Not now, or Esc: the bubble goes, and nothing brings it back. */
    close(): void;
  };
  /** The panel under the menu bar icon: Capture, Library and Settings (Settings' own calls are `settings`). */
  /** The window that picks a part of the screen and records it (`createAreaWindow`). */
  area: {
    /** What it records: the screen's capture source, its scale (pixels a point), and the longest a video may run. */
    get(): Promise<AreaSetup>;
    /** Picked: the window stops taking the pointer but over its Stop (`setInteractive`). */
    setInteractive(interactive: boolean): void;
    /** The video, as recorded, or the marked picture (`image/png`): it goes with the recording. */
    done(video: ArrayBuffer, mime: string): Promise<void>;
    /** Esc, or a picking given up: nothing is kept. */
    cancel(): void;
  };
  panel: {
    get(): Promise<PanelSnapshot>;
    onChanged(callback: (snapshot: PanelSnapshot) => void): () => void;
    /** The library's pages, newest change first (PANEL_PAGES at most). Empty without a library. */
    pages(): Promise<PanelPage[]>;
    /** Something the menu could do (`PanelAction`): the panel hides first when it starts something elsewhere. */
    act(action: string): void;
    /** The panel came up: on `tab` when something asked for one (Settings from an error card), else where it was. */
    onShown(callback: (tab: PanelTab | null) => void): () => void;
    /** Esc: the panel hides. */
    hide(): void;
    /** The microphone's level, 0 to 1, as the capsule hears it, while a recording listens and the panel is up. */
    onLevel(callback: (level: number) => void): () => void;
    /** Type a thought, in Capture: the words are saved as Quick saves them. Rejects when they couldn't be, and the field keeps them. */
    type(text: string): Promise<void>;
    /** Take notes on a call…, in Capture: the call apps running now, by name; `act("call-notes:<index>")` or `"call-notes:everything"` picks. */
    callApps(): Promise<string[]>;
    /** A preview of a file of raw/attachments (a picture, a video's frame), as a data URL; null when there is none. */
    thumbnail(rel: string): Promise<string | null>;
    /** The trigger word said into the voice trigger's microphone: its words, as speech-to-text writes them; null when none were heard. */
    hearTriggerWord(samples: Float32Array): Promise<string | null>;
    /** The panel's microphone is open for a trigger or stop word (true) or has closed: meanwhile the voice trigger starts and stops nothing. */
    hearingTriggerWord(on: boolean): void;
    /** Copy as a prompt: the page, as a prompt for an agent, goes on the clipboard. False when it couldn't. */
    copyPrompt(rel: string): Promise<boolean>;
    /** Main asks Capture to open Take notes on a call…'s list (the call was asked for from somewhere else). */
    onPickCall(callback: () => void): () => void;
    /** Ask your library, in Library: answered as the Ask window's questions are. */
    ask(question: string): Promise<AskResult>;
    /** What the question being answered is doing now. */
    onAskProgress(callback: (message: string) => void): () => void;
    /** Stop: the question being answered is given up. */
    cancelAsk(): void;
    /** Main asks Library to open the page at this library-relative path (back from Continue by voice). */
    onOpenPage(callback: (rel: string) => void): () => void;
    /** Files dropped on a page in Library: copied into the library and filed into that page at once (`act("attach:<page>")` picks them). */
    attachToPage(rel: string, files: File[]): void;
    /** Files dropped on the recording, or picked for it: they go with its note when it is saved. */
    attachToRecording(files: File[]): void;
    /** One of the recording's added files, by its place in the list, taken off it (its copy goes from the library). */
    removeAttachment(index: number): void;
  };
}

/** The menu bar panel's places, in the order of its tabs. */
export const PANEL_TABS = ["capture", "processing", "library", "settings"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

/** How many pages the panel's Library lists at most. */
export const PANEL_PAGES = 300;

/** A page of the library as the panel's Library lists it, read from its front matter and its text. */
export interface PanelPage {
  /** Library-relative, e.g. "problems/fix-light.md". */
  path: string;
  title: string;
  /** The shelf it is on: the front matter's, else its folder's; null for neither. */
  shelf: string | null;
  status: string | null;
  tags: string[];
  /** YYYY-MM-DD from the front matter, else the file's own dates. */
  created: string | null;
  updated: string | null;
  /** The page's first paragraph, with links as plain words. */
  summary: string;
  /** Its `##` sections, each with its lines (list items without their marks), for the open row. */
  sections: { heading: string; lines: string[] }[];
  /** The files of the library's raw/attachments it names (videos, screenshots, files added to it) that are there, in its order. */
  attachments: string[];
  /**
   * The names those files had when they were added, as the page writes them beside their paths ("raw/attachments/….mov (Screen
   * Recording 2026-11-07 at 10.54.48.mov)"): its text may name a file by them alone, and the panel links those words too.
   */
  attachmentNames: { name: string; path: string }[];
}

/** A scheduled review as the panel shows it, with how its last run ended. */
export interface PanelReview {
  id: string;
  name: string;
  /** "evening-review", "review" or "custom". */
  kind: string;
  enabled: boolean;
  /** ISO: its next run, while it is on. */
  next: string | null;
  /** ISO: when it last began. */
  lastRun: string | null;
  running: boolean;
  /** "Filing 2 of 5", while an evening review runs. */
  progress: string | null;
  /** How its last run in this app run ended, as its notification said it. */
  outcome: { at: string; title: string; body: string } | null;
}

/** Everything the panel shows but the pages and Settings, in one snapshot (panel:changed). */
export interface PanelSnapshot {
  libraryReady: boolean;
  /** Why there is no library, when there is none: what the menu's head says. */
  libraryProblem: string | null;
  inbox: number;
  filedToday: number;
  /** The menu's head: "1 thought filed today. Evening review at 21:00." (`statusLine`). */
  headline: string;
  /** Why speech can't be turned into words, and where the fix is, as the menu says it; null when nothing is wrong. */
  speechProblem: { title: string; line: string } | null;
  /** Take notes on a call: "ready" offers it, "running" offers to stop, "off" is a Mac or a library that can't. */
  callNotesOffer: "off" | "ready" | "running";
  /** Calls whose notes were cut short and can be finished. */
  cutShortCalls: number;
  /** The history of dictations holds one, which Forget the last dictation forgets. */
  forgettableDictation: boolean;
  /** The pages' list changed since this number was last seen: read `pages()` again. */
  pagesVersion: number;
  shortcuts: Shortcuts;
  unregisteredShortcuts: (keyof Shortcuts)[];
  recording: boolean;
  /**
   * The recording that listens now, as the capsule shows it: what kind, when it began (Date.now()), and its file mode and review as
   * the capsule's switch has them (null where there is none to switch). Null while nothing listens. `ownKey`: a dictation into
   * another app, which only its own key ends, so the panel offers no Stop for it.
   */
  listening: {
    mode: "dictate" | "comment" | "call";
    startedAt: number;
    pausedAt: number | null;
    fileMode: FileMode | null;
    review: string | null;
    ownKey: boolean;
    /** The files and screenshots added to it so far (Add), each with when it was added: they go with its note. */
    attached: AttachedItem[];
    /** What Add is getting ready now, or null. */
    adding: AddingKind | null;
  } | null;
  callNotes: boolean;
  /** Start a thought by voice: whether it is on, and its word (`AppSettings.voiceTrigger`). Capture's foot turns it on and names it. */
  voiceTrigger: AppSettings["voiceTrigger"];
  /**
   * The thoughts being filed, oldest first: the first that isn't waiting is at work, and Capture shows it as the capsule's filing card;
   * the rest wait their turn, and Capture lists them under it as the queue.
   */
  filings: PanelFiling[];
  /** A recording whose words are being made now, before they are filed: Processing says so, with Stop once it takes long. */
  transcribing: Extract<CapsuleState, { kind: "transcribing" }> | null;
  /** When `result`'s card goes by itself (Date.now() ms), or null while it stays until it is put away (a problem). */
  resultHidesAt: number | null;
  /** What came of the last filing, while its card stands: filed, stopped, or a problem. Processing shows it until it is put away. */
  result: Extract<CapsuleState, { kind: "filed" | "cancelled" | "error" }> | null;
  reviews: PanelReview[];
  undoableFiling: boolean;
  showableReceipt: boolean;
  undoableReview: boolean;
  opensInObsidian: boolean;
}

/** A file or screenshot added to a recording, as its Add list shows it: its name and when it was added (Date.now()). */
export interface AttachedItem {
  name: string;
  at: number;
}

/** A thought being filed, as Capture shows it. */
export interface PanelFiling {
  /** Its capture's path: the same for the whole filing. */
  id: string;
  /** As the capsule's card has it: its words, agent, steps, seconds and estimate. */
  state: Extract<CapsuleState, { kind: "filing" }>;
  /** Its card in the capsule is up, so Edit and Stop reach it from Capture too. */
  shown: boolean;
}

/** What the recording's Add is getting ready now: a screenshot being taken, or the picker opening for a video or a marked screenshot. */
export type AddingKind = "screenshot" | "video" | "marks";

/** What the area window records: the display's capture source (`chromeMediaSourceId`), its pixels a point, and its time limit. */
export interface AreaSetup {
  sourceId: string;
  scale: number;
  maxSeconds: number;
  /** video: the part is recorded until Stop. marks: the part is taken as a picture and marked (`MarkUp`) before it is added. */
  mode: "video" | "marks";
}
