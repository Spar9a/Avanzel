// What setup (setup.ts) and the controller share: a recording, a filing and its corrected words, the agents' names,
// the library's folder picker, and how an error reads.
import type { OpenDialogOptions } from "electron";
import type { FileOutcome } from "@avanzel/engine";
import type { CapsuleMode, FiledPage, NarrationRow, ScreenContext } from "../shared/ipc.ts";

/** The folder picker for the library, in Settings (Change… and Choose a folder…) and in setup (Change…). */
export const LIBRARY_PICKER: OpenDialogOptions = { title: "Choose your library folder", properties: ["openDirectory", "createDirectory"] };
const HARNESS_NAMES: Record<string, string> = {
  claude: "Claude Code", codex: "Codex", opencode: "OpenCode", "cursor-agent": "Cursor Agent", gemini: "Gemini CLI",
};
export const harnessName = (name: string) => HARNESS_NAMES[name] ?? name;

export interface Recording {
  mode: CapsuleMode;
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
   * The harness the job files with, by name ("claude"): the one the library's choice selected when the job was made, so a
   * failure names that agent and its fix files the note with it again. "auto" while none could be selected: none is
   * installed, or the library's settings can't be read; the run then reads the library's choice itself.
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
  /** Its run waits for the library (another run has it); the filing card says so until the run starts. */
  waiting?: boolean;
  outcome?: FileOutcome;
  pages?: FiledPage[];
  /**
   * What the agent has done so far, a row for each step it takes (`withStep`), oldest first. Only setup's first thought
   * is narrated (`filingStep`); any other filing's stay empty.
   */
  rows: NarrationRow[];
  /**
   * The Markdown pages the agent has written so far, new or updated, each once, as library paths (`withWritten`); the
   * shelf tabs count them. Unlike `rows`, it is not cut to the newest fifty, so a long filing's count doesn't fall as its
   * early rows go. Like the rows, it is kept for setup's first thought only.
   */
  written: string[];
  /**
   * Setup's first thought (`takeThought`): it reports to the setup window while the window shows it (its session's
   * `job`), and once the window has closed, by notification, as any filing whose card isn't showing does.
   */
  setup?: boolean;
  /** Cancel, in setup, stopped the run: what it did is taken back (`cancelSetupFiling`), not shown. */
  cancelled?: boolean;
}

/** Words filed after Edit, on their way to the inbox: only in memory until the refile's `recapture` writes them. */
export interface Correction {
  words: string;
  /** The job they correct: its capture's recording, transcriber and creation time go with them (`recaptureOptions`). */
  of: FilingJob;
}

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
export const lastLines = (text: string, n = 3) => text.trim().split("\n").filter(Boolean).slice(-n).join("\n");
