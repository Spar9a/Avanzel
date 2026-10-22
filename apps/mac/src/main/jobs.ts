// What setup (setup.ts) and the controller share: a recording, a filing and its corrected words, the agents' names,
// the library's folder picker, and how an error reads.
import type { OpenDialogOptions } from "electron";
import type { FileOutcome } from "@avanzel/engine";
import type { CapsuleMode, FiledPage, ScreenContext } from "../shared/ipc.ts";

/** The folder picker for the library, in Settings (Choose existing…) and in setup (Change…). */
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
