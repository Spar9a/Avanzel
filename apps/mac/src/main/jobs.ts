// What setup (setup.ts) and the controller share: a recording, a filing and its corrected words, how a question ended, the
// agents' names, the library's folder picker, and how an error reads.
import type { OpenDialogOptions } from "electron";
import type { FileOutcome, Vault } from "@avanzel/engine";
import type { CapsuleMode, FileMode, FiledPage, NarrationRow, ScreenContext } from "../shared/ipc.ts";
import type { AgentFailure } from "../shared/problems.ts";

/** The folder picker for the library, in Settings (Change… and Choose a folder…) and in setup (Change…). */
export const LIBRARY_PICKER: OpenDialogOptions = { title: "Choose your library folder", properties: ["openDirectory", "createDirectory"] };
const HARNESS_NAMES: Record<string, string> = {
  claude: "Claude Code", codex: "Codex", opencode: "OpenCode", "cursor-agent": "Cursor Agent", gemini: "Gemini CLI",
};
export const harnessName = (name: string) => HARNESS_NAMES[name] ?? name;

export interface Recording {
  mode: CapsuleMode;
  /** The file mode the capsule's switch changes, null where it has none; the controller's `toggleFileMode` tells the rest. */
  fileMode: FileMode | null;
  /**
   * Setup's first spoken thought (`startRecording`'s `forSetup`): its window shows its progress, so the capsule offers it no Stop
   * (`transcribeWithStop`).
   */
  forSetup: boolean;
  /**
   * A question for the Ask window (`pressDictate` while Ask is the key window): its words go to Ask's field (`heardQuestion`) and nowhere in
   * the library, and it has no file mode.
   */
  forAsk: boolean;
  /**
   * The Ask window's `webContents.id` at the press, for a question; null otherwise. The words go to that window alone: if it has closed by
   * then, they are dropped quietly, even when another Ask window has opened since.
   */
  askPage: number | null;
  startedAt: number;
  shot?: { path: string; thumbnail: string; context: ScreenContext };
  maxTimer: NodeJS.Timeout;
  /** Asked to stop (the shortcut, the menu or the time limit); its audio is on the way. */
  stopping: boolean;
}

export interface FilingJob {
  capturePath: string;
  text: string;
  transcribedIn: number | null;
  agent: string;
  /**
   * The harness the job files with, by name ("claude"): the one the library's choice selected when the job was made, or the
   * one a failure card's button picked (`fileAgainWith`), so a failure names that agent and its fix files the note with it
   * again. "auto" while none could be selected: none is installed, or the library's settings can't be read; the run then
   * reads the library's choice itself.
   */
  harness: string;
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
  /**
   * Its run waits: for its turn in the app's queue (another run of Avanzel's own has it: `beginFiling`), or for the library (another
   * run has it, which the engine tells: `filingProgress`). The filing card says so until the run starts (`startRun`).
   */
  waiting?: boolean;
  /**
   * Filed in the background, with no card (`fileInBackground`): by the wait for a usage limit's reset, which was due at `until`
   * (epoch ms), or by the watch of a missing sign-in. What goes wrong with such a filing is checked against this, so that a
   * note can't be filed again by itself without end (`keepPromise`).
   */
  background?: { by: "wait"; until: number } | { by: "watch" };
  outcome?: FileOutcome;
  /**
   * The library its run filed in, set as the run begins (`runFiling`): another may be open by the time the filing's card is up, or Undo is
   * pressed on it, and an Undo takes the filing back in the library it was made in (`undo`). Unset until the run begins.
   */
  library?: Vault;
  pages?: FiledPage[];
  /**
   * What the agent has done so far, a row for each step it takes (`withStep`), oldest first. Every filing that has a card or
   * a window is narrated (`filingStep`): setup's first thought tells its window, and a capsule filing its card. One in the
   * background (`background`) has neither, and its rows stay empty. They belong to this job: a newer job starts with none.
   */
  rows: NarrationRow[];
  /**
   * The Markdown pages the agent has written so far, new or updated, each once, as library paths (`withWritten`); the
   * shelf tabs count them. Unlike `rows`, it is not cut to the newest fifty, so a long filing's count doesn't fall as its
   * early rows go. Only setup's tabs use it.
   */
  written: string[];
  /**
   * Date.now() when the job's seconds start: when the job was made, then when its run has the library (it moves to its turn in
   * the queue, `runFiling`, and again to the end of a wait for the library, `filingProgress`). The card counts its seconds
   * from here, and the seconds kept to estimate later filings (`RunState.durations`) run from here to the outcome.
   */
  startedAt: number;
  /** Date.now() when the agent last took a step, or `startedAt` before its first: how long the card has been quiet. */
  stepAt: number;
  /**
   * About how many seconds a filing with this job's agent takes (`estimateSeconds`), fixed when its card first shows
   * (`showFiling`) so that it doesn't change under the person's eyes as another filing ends. Unset until then.
   */
  estimate?: number;
  /**
   * Setup's first thought (`takeThought`): it reports to the setup window while the window shows it (its session's
   * `job`), and once the window has closed, by notification, as any filing whose card isn't showing does.
   */
  setup?: boolean;
  /** Cancel, in setup, or Stop, in the capsule, stopped the run (`cancelSetupFiling`, `cancelFiling`, which tell the rest). */
  cancelled?: boolean;
  /**
   * Its run waits for its turn in the app's queue, queued alone (`beginFiling`), so nothing touches its note until the turn comes
   * (`runFiling`, which clears this). A Stop meanwhile settles at once (`cancelFiling`): there is nothing to take back, and nothing to
   * wait for. A refiled job is never queued alone: the take-back of the run it replaces, and its corrected words, come first (`refile`).
   */
  queuedAlone?: true;
  /** Undo, in the capsule, has been asked to take the filing back, and answers once (`undo`): a press after the first does nothing. */
  undoing?: true;
}

/** How a question ended (`answerQuestion`), for the Ask window and for setup's Ask step. */
export interface Answered {
  ok: boolean;
  /**
   * The agent's run came to its end: true for an answer, whose `text` is the agent's reply, and for a run that failed, whose
   * `text` is the agent's last lines; false when something threw instead (no library, a question the engine refuses), whose
   * `text` is the error's message.
   */
  ran: boolean;
  text: string;
  agent: string;
  seconds: number;
  /** How many files the run left changed in the library: created, modified or deleted. 0 when nothing ran. */
  changedFiles: number;
  /**
   * Why it failed. Null for an answer, and for a question that never reached an agent: whatever threw, except an agent that
   * isn't there, which is `gone` (the library's own) or `missing` (none installed).
   */
  failure: AgentFailure | null;
}

/** Words filed after Edit, on their way to the inbox: only in memory until the refile's `recapture` writes them. */
export interface Correction {
  words: string;
  /** The job they correct: its capture's recording, transcriber and creation time go with them (`recaptureOptions`). */
  of: FilingJob;
}

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
export const lastLines = (text: string, n = 3) => text.trim().split("\n").filter(Boolean).slice(-n).join("\n");
