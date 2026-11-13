// The orchestration layer: hand one capture at a time to the harness and enforce the filing contract.
//
// The agent does the thinking (which shelf, which pages, which links). Avanzel guarantees the
// bookkeeping no matter how the agent behaves: the owner's words are restored if touched, a run that
// filed nothing leaves the capture in the inbox, the log gets its line, the capture is archived under
// a name that never overwrites another, the library's rules, settings and shadow tasks are put back,
// and every filing is its own git commit, so it can be undone.

import { copyFileSync, existsSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AvanzelError, type Transcriber } from "../types.ts";
import { Changes, diff, snapshot, type Snapshot } from "./changes.ts";
import type { ToolStep } from "./claude-stream.ts";
import { loadSettings, saveSettings, type Settings } from "./config.ts";
import { localDate } from "./dates.ts";
import type { HostedProvider } from "./hosted-model.ts";
import { flowItems, frontmatterFields, splitFrontmatter } from "./frontmatter.ts";
import * as gitops from "./git.ts";
import { protectedState, undoProtected } from "./guard.ts";
import {
  NoAgentError,
  agentName,
  classifyFailure,
  errorLine,
  runHeadless,
  selectHarness,
  type Harness,
  type RunFailure,
  type RunResult,
} from "./harness.ts";
import { createInside, lstatOrNull, realFoldersTo, removeInside, replaceInside, writeInside } from "./inside.ts";
import { parseDictionary } from "./dictionary.ts";
import { askPrompt, filePrompt, reviewPrompt, type ShelfNote } from "./prompts.ts";
import {
  BUILT_IN_DEFINITIONS,
  BUILT_IN_SHELVES,
  MAX_OWN_SHELVES,
  MAX_SHELF_NAME,
  agentMadeFolders,
  checkedSuggestion,
  cleanDefinition,
  folderProblem,
  nameBreaksRules,
  parseSuggestion,
  sameShelf,
  shelfTextLength,
  withIndexHeading,
  withIndexHeadingRenamed,
  withIndexLineMoved,
  withoutEmptyIndexHeading,
  writeShelfSection,
  type OwnShelf,
  type PendingShelf,
  type ShelfSuggestion,
} from "./shelves.ts";
import { insideLibrary, stepPath, type FilingStep } from "./steps.ts";
import { AUDIO_EXTS, IMAGE_EXTS, SPECIAL_DIRS, TEXT_EXTS, type Capture, type Vault } from "./vault.ts";
import { watchWrites } from "./watch.ts";

const SOURCES = ["inbox/", "raw/"];
/** What `progress` hears when a run has to wait for the library lock. */
export const WAITING = "Waiting for another Avanzel run on this library…";
/**
 * What an ask's `progress` hears, after `WAITING`, once the lock is its own and the agent is about to look:
 * the words the Ask window shows for a question that never had to wait.
 */
const LOOKING = "Looking through your library…";

export interface FileOutcome {
  captureId: string;
  ok: boolean;
  changes: Changes;
  /** The agent's reply. */
  message: string;
  archivedTo: string | null;
  error: string;
  /** The agent had changed the capture; the owner's words were put back. */
  restored: boolean;
  /**
   * The agent had changed the capture and its words could not be put back (inbox/ is a symlink):
   * where they are kept instead, library-relative (null when that was not needed, or not possible).
   */
  savedOriginal: string | null;
  /**
   * What the guard put back after the run (`undoProtected`): protected paths the agent changed (the library's
   * rules, settings and tasks) and links it left in Avanzel's own paths (inbox/, raw/, reviews/, log.md), with
   * any link that could not be checked or put back.
   */
  guarded: string[];
  /**
   * The writes Claude Code was refused during the run, as library paths (a path outside the library stays as the agent
   * gave it). Only Claude Code reports these; the run of any other agent gives [].
   */
  refused: string[];
  /**
   * The run's commit, for Undo: the filing, or what a failed, timed-out or cancelled run left
   * behind. Null without git, with auto_commit off, or when a failed run changed nothing.
   */
  commit: string | null;
  /**
   * Why an agent's run did not file the capture (a usage limit, a missing sign-in, a timeout, or another failure), read
   * from what the agent printed (`classifyFailure`). A run that exited 0 and still wasn't filed (the inbox is a symlink,
   * nothing was written, the archive is blocked) is `other`, in Avanzel's own words and never the agent's reply. Null
   * when the capture was filed, and when something else failed it (an unreadable capture, a recording that could not be
   * transcribed): then only `error` says why.
   */
  failure: RunFailure | null;
  /**
   * A shelf this filing suggests, for the owner to make or turn down: one the agent asked for in the last line of its reply, or a
   * folder it made on its own (`agentMade`). Null when the filing failed, the agent asked for none, or the suggestion broke a rule
   * (see `checkedSuggestion`): a dropped suggestion changes nothing about the filing.
   */
  suggestion: ShelfSuggestion | null;
}

export interface AgentOutcome {
  result: RunResult;
  changes: Changes;
  report: string | null;
  guarded: string[];
  /**
   * The run's commit: a saved answer's or a review's, or the leftovers of a save or a review that didn't end well.
   * Null for a read-only ask, without git, with auto_commit off, or when the run changed nothing.
   */
  commit: string | null;
}

export interface EveningReviewResult {
  outcomes: FileOutcome[];
  /**
   * `reviews/YYYY-MM-DD-evening.md`, or null when the inbox was empty or the digest could not be
   * written safely (reviews/ is a symlink).
   */
  digestPath: string | null;
  /** Every commit the review made, oldest first (for Undo all). */
  commits: string[];
}

export interface ScreenCapture {
  /** A screenshot: already claimed in `raw/attachments/` (see `Vault.newAttachmentPath`), or copied in. */
  image: string;
  /** The owner's comment, typed or transcribed. */
  comment?: string | null;
  /** The recording of a spoken comment (claimed in `raw/audio/`, or copied in). */
  audio?: string | null;
  /** The speech-to-text engine that transcribed the comment. */
  transcriber?: string | null;
  /**
   * Where it was taken; `heard` is what the speech model recognised of the comment, when the dictionary corrected it; `continues`, the
   * library-relative page it was taken to add to.
   */
  context?: { app?: string; title?: string; url?: string; heard?: string; continues?: string };
}

export interface CallCapture {
  /** The call as it was said (see `callTranscript`). */
  transcript: string;
  /** The app the call was in ("Zoom"); left out for everything the Mac plays. */
  app?: string;
  title?: string;
  startedAt: Date;
  /** How long the call ran. */
  seconds: number;
}

export interface FileOptions {
  progress?: (message: string) => void;
  /** The owner's standing instructions for this run (a shadow task's body). */
  instructions?: string | null;
  signal?: AbortSignal;
  /**
   * Captures to leave in the inbox, unreported (say, ones the owner is editing); asked as each next capture is picked. A `false` answer
   * is the pick: the capture is worked on from there, and `leave` is not asked of it again. So a caller hears one `false` for each
   * capture the run works on, before that capture's first `progress`. A recording is one pick, though its words are filed under a name
   * of their own, and a capture that can't be adopted is a pick that reports nothing.
   */
  leave?: (capturePath: string) => boolean;
  /**
   * Told each step the agent takes while it files a capture, as it takes it: what Claude Code reads, searches and writes
   * (from its own tool calls), and what any other agent writes (seen in the folder). Paths are library paths, and never
   * the capture, anything under inbox/ or raw/, or a dot path. Narration is best effort: it never fails a filing.
   */
  steps?: (step: FilingStep) => void;
  /** The shelves the librarian suggested that the owner has not answered yet: the prompt lists them, and a suggestion that is the same shelf joins one. */
  pendingShelves?: readonly PendingShelf[];
}

export interface LibrarianOptions {
  harnessName?: string | null;
  /** Only `captureAudio` (and filing recordings dropped into the inbox) needs one. */
  transcriber?: Transcriber | null;
  clock?: () => Date;
  /** The app's own key for the library's private model, read when a run starts; null when it keeps none. */
  privateKey?: () => string | null;
  /** The hosted model's server, for a private model whose source is "hosted". */
  hosted?: HostedProvider | null;
}

/** What one agent run is asked to do. */
interface RunSpec {
  write: boolean;
  images?: readonly string[];
  signal?: AbortSignal | undefined;
}

/** A run whose caller will diff the library against `before`, and may be told each step as it is taken. */
interface WithBefore {
  before: Snapshot;
  steps?: ((step: FilingStep) => void) | undefined;
}

/** What a shelf operation did: its commit (null with no git or auto-commit off) and the pages (library-relative, as they were) moved or kept. */
export interface ShelfResult {
  commit: string | null;
  moved: string[];
  notMoved: string[];
}

/** What one agent run gives: its result, and what the guard put back after it. */
interface Ran {
  result: RunResult;
  guarded: string[];
}

function quiet(): void {}

export class Librarian {
  readonly vault: Vault;
  #settings: Settings;
  readonly harnessName: string | null;
  readonly clock: () => Date;
  readonly #transcriber: Transcriber | null;
  readonly #privateKey: () => string | null;
  readonly #hosted: HostedProvider | null;
  #harness: Harness | null = null;

  constructor(
    vault: Vault,
    settings: Settings,
    { harnessName = null, transcriber = null, clock = () => new Date(), privateKey = () => null, hosted = null }: LibrarianOptions = {},
  ) {
    this.#privateKey = privateKey;
    this.#hosted = hosted;
    this.vault = vault;
    this.#settings = settings;
    this.harnessName = harnessName;
    this.clock = clock;
    this.#transcriber = transcriber;
  }

  /** The settings this librarian works with. The shelf operations refresh its shelves and declined shelves after they save. */
  get settings(): Settings {
    return this.#settings;
  }

  /** The agent CLI doing the work, picked on first use. */
  get harness(): Harness {
    this.#harness ??= selectHarness(this.settings, this.harnessName);
    return this.#harness;
  }

  // --- capture ------------------------------------------------------------------------------

  captureText(text: string, source = "text"): Capture {
    return this.vault.newCapture(text, { source, now: this.clock() });
  }

  /**
   * Transcribe locally, keep the recording under raw/audio, and write the capture. Null when no
   * speech was recognised (the recording is still kept).
   */
  async captureAudio(audio: string, { source, keepOriginal = true }: { source: string; keepOriginal?: boolean }): Promise<Capture | null> {
    if (!this.#transcriber) throw new AvanzelError(`Cannot transcribe ${basename(audio)}: no speech-to-text engine is set up.`);
    const now = this.clock();
    const transcript = await this.#transcriber.transcribe(audio);
    const stored = this.#keepUnder("audio", audio, keepOriginal, (suffix) => this.vault.newAudioPath(now, suffix || ".wav"));
    if (!transcript.text.trim()) return null;
    const heard = transcript.heard?.trim(); // what was recognised, when the dictionary corrected it
    return this.vault.newCapture(transcript.text, { source, audio: stored, transcriber: transcript.engine, now, context: { heard } });
  }

  /** A screenshot with the owner's comment. It waits in the inbox for the evening review. */
  captureScreen({ image, comment = null, audio = null, transcriber = null, context = {} }: ScreenCapture): Capture {
    if (!isFile(image)) throw new AvanzelError(`No such screenshot: ${image}`);
    if (!IMAGE_EXTS.has(extname(image).toLowerCase())) throw new AvanzelError(`Not an image: ${image}`);
    const now = this.clock();
    const stored = this.#keepUnder("attachments", image, true, (suffix) => this.vault.newAttachmentPath(now, suffix));
    const recording = audio
      ? this.#keepUnder("audio", audio, true, (suffix) => this.vault.newAudioPath(now, suffix || ".wav"))
      : null;
    return this.vault.newCapture(comment ?? "", {
      source: "screen",
      context: { app: context.app, title: context.title, url: context.url, heard: context.heard },
      attachments: [stored],
      audio: recording,
      transcriber,
      now,
    });
  }

  /** A finished call, as its transcript. It waits in the inbox for the evening review. */
  captureCall({ transcript, app, title, startedAt, seconds }: CallCapture): Capture {
    return this.vault.newCapture(transcript, {
      source: "call",
      context: { app, title, seconds: Math.round(seconds) },
      now: startedAt,
    });
  }

  // --- file ---------------------------------------------------------------------------------

  /**
   * File captures one per agent run, oldest first. Without `only`, the inbox is re-read after every
   * capture, so anything captured meanwhile is filed too. When the agent isn't there (a `NoAgentError`, from the first
   * capture or a later one), nothing more is tried and the promise rejects with it; the captures stay in the inbox.
   */
  async file(only?: readonly string[] | null, options: FileOptions = {}): Promise<FileOutcome[]> {
    return this.vault.withLock(() => this.#fileQueue(only ?? null, options), () => (options.progress ?? quiet)(WAITING));
  }

  /**
   * The evening review: file every capture in the inbox (one run each, with the owner's standing
   * instructions), then write `reviews/YYYY-MM-DD-evening.md` saying what went where.
   */
  async eveningReview(options: FileOptions = {}): Promise<EveningReviewResult> {
    return this.vault.withLock(async () => {
      const outcomes = await this.#fileQueue(null, options);
      if (!outcomes.length) return { outcomes, digestPath: null, commits: [] };
      const now = this.clock();
      await this.#commitOwnerChanges(`evening review ${localDate(now)}`);
      const commits = outcomes.flatMap((outcome) => (outcome.commit ? [outcome.commit] : []));
      const digestPath = this.#newReportPath(`${localDate(now)}-evening`);
      if (!createInside(this.vault.root, this.vault.relativePath(digestPath), digest(outcomes, now))) {
        return { outcomes, digestPath: null, commits }; // reviews/ is a symlink: no digest, rather than one written elsewhere
      }
      this.vault.appendLog("review", `[[${stem(digestPath)}]]`, now);
      const digestCommit = await this.#commit(`avanzel: evening review ${localDate(now)}`);
      return { outcomes, digestPath, commits: digestCommit ? [...commits, digestCommit] : commits };
    }, () => (options.progress ?? quiet)(WAITING));
  }

  /**
   * Undo these commits (a filing, or everything an evening review did), newest first; returns how
   * many were undone. The owner's words are never undone: a filed capture goes back to the inbox,
   * and captures or screenshots that were waiting stay where they are.
   */
  async undo(commits: readonly string[]): Promise<number> {
    const root = this.vault.root;
    return this.vault.withLock(async () => {
      let undone = 0;
      for (const sha of [...commits].reverse()) {
        const subject = (await gitops.subject(root, sha)) ?? sha;
        const message = `avanzel: undo ${subject.replace(/^avanzel: /, "")}`;
        if ((await gitops.revertKeeping(root, sha, message, (rel) => this.#keptOnUndo(rel))) !== null) undone += 1;
      }
      // An undone shelf operation changed the saved shelves; a config that can't be read is reported where settings are read.
      try {
        const saved = loadSettings(root);
        this.#settings = { ...this.#settings, shelves: saved.shelves, declinedShelves: saved.declinedShelves };
      } catch {
        /* keep what this librarian had */
      }
      this.vault.ensureFolders();
      return undone;
    });
  }

  // --- shelves ------------------------------------------------------------------------------

  /**
   * Make a shelf of the owner's own: its folder (one that is already there is adopted as it is), its entry in config.toml and
   * `AGENTS.md`, its heading in `index.md`, and `pages` moved into it (`ShelfResult.notMoved` names the ones that could not).
   * All of it is one commit, which `undo` takes back.
   */
  async makeShelf(shelf: OwnShelf, pages: readonly string[] = []): Promise<ShelfResult> {
    const root = this.vault.root;
    return this.#shelfOperation(`make shelf ${shelf.folder}`, (current) => {
      const folder = shelf.folder;
      const name = checkedName(shelf.name);
      const definition = checkedDefinition(shelf.definition);
      const clash = current.shelves.find((other) => sameShelf(other.folder, folder) || sameShelf(other.name, name));
      if (clash) throw new AvanzelError(`A shelf called ${clash.name} already exists. Choose another name.`);
      refuseBuiltInName(name);
      if (current.shelves.length >= MAX_OWN_SHELVES) {
        throw new AvanzelError(`You have ${MAX_OWN_SHELVES} shelves of your own, and that is the most. Remove one you don't use, then try again.`);
      }
      const problem = folderProblem(folder, current.shelves.map((other) => other.folder));
      if (problem) throw new AvanzelError(problem);
      const there = lstatOrNull(join(root, folder));
      if (there && !there.isDirectory()) {
        throw new AvanzelError(`A file or link called ${folder} is already in the library, so no shelf was made. Choose another folder name.`);
      }
      const next = { ...current, shelves: [...current.shelves, { folder, name, definition }] };
      return {
        next,
        apply: () => {
          realFoldersTo(root, `${folder}/page`, true);
          this.#editIndex((index) => withIndexHeading(index, name));
          const moved: string[] = [];
          const notMoved: string[] = [];
          for (const rel of new Set(pages)) (this.#movePage(rel, folder, name) ? moved : notMoved).push(rel);
          this.vault.appendLog("shelf", moved.length ? `${folder} → ${moved.map(wikilink).join(", ")}` : folder, this.clock());
          return { moved, notMoved };
        },
      };
    });
  }

  /** Change the name or the definition of one of the owner's shelves (its folder stays); the index heading follows a new name. */
  async editShelf(folder: string, change: { name?: string; definition?: string }): Promise<ShelfResult> {
    return this.#shelfOperation(`edit shelf ${folder}`, (current) => {
      const shelf = ownShelf(current, folder);
      const name = change.name === undefined ? shelf.name : checkedName(change.name);
      const definition = change.definition === undefined ? shelf.definition : checkedDefinition(change.definition);
      const clash = current.shelves.find((other) => other !== shelf && sameShelf(other.name, name));
      if (clash) throw new AvanzelError(`A shelf called ${clash.name} already exists. Choose another name.`);
      if (name !== shelf.name) refuseBuiltInName(name);
      const next = { ...current, shelves: current.shelves.map((other) => (other === shelf ? { folder, name, definition } : other)) };
      return {
        next,
        apply: () => {
          if (name !== shelf.name) this.#editIndex((index) => withIndexHeadingRenamed(index, shelf.name, name));
          return { moved: [], notMoved: [] };
        },
      };
    });
  }

  /**
   * Remove one of the owner's shelves that holds no pages: its entry, its empty index heading and its row in `AGENTS.md`, and its
   * folder (unless something that isn't a page is in it, which stays).
   */
  async removeShelf(folder: string): Promise<ShelfResult> {
    const root = this.vault.root;
    return this.#shelfOperation(`remove shelf ${folder}`, (current) => {
      const shelf = ownShelf(current, folder);
      if ((this.vault.shelfCounts()[folder] ?? 0) > 0) {
        throw new AvanzelError(`The ${shelf.name} shelf still has pages, so it was kept. Move or remove its pages first.`);
      }
      const next = { ...current, shelves: current.shelves.filter((other) => other !== shelf) };
      return {
        next,
        apply: () => {
          if (lstatOrNull(join(root, folder))?.isDirectory() && isEmptyFolder(join(root, folder))) removeInside(root, folder);
          this.#editIndex((index) => withoutEmptyIndexHeading(index, shelf.name));
          return { moved: [], notMoved: [] };
        },
      };
    });
  }

  /**
   * Turn down a shelf the librarian suggested: remember its folder so it is not suggested again, move the pages the agent made
   * there (`agentMadePages`) to `topics/`, and remove the folder when nothing is left in it.
   */
  async declineShelf(folder: string, agentMadePages: readonly string[] = []): Promise<ShelfResult> {
    const root = this.vault.root;
    return this.#shelfOperation(`decline shelf ${folder}`, (current) => {
      if (
        folder === "" ||
        folder === "." ||
        folder === ".." ||
        /[/\\]/.test(folder) ||
        folder.startsWith(".") ||
        BUILT_IN_SHELVES.includes(folder) ||
        SPECIAL_DIRS.includes(folder) ||
        current.shelves.some((shelf) => shelf.folder === folder)
      ) {
        throw new AvanzelError(`${folder} is not a suggested shelf, so nothing was turned down. Choose a suggestion.`);
      }
      const declinedShelves = current.declinedShelves.includes(folder) ? current.declinedShelves : [...current.declinedShelves, folder];
      return {
        next: { ...current, declinedShelves },
        apply: () => {
          const moved: string[] = [];
          const notMoved: string[] = [];
          for (const rel of new Set(agentMadePages)) {
            (rel.startsWith(`${folder}/`) && this.#movePage(rel, "topics", "Topics") ? moved : notMoved).push(rel);
          }
          if (lstatOrNull(join(root, folder))?.isDirectory() && isEmptyFolder(join(root, folder))) removeInside(root, folder);
          return { moved, notMoved };
        },
      };
    });
  }

  /**
   * One shelf operation, as the other runs that change the library are: under the lock, after the owner's own changes are
   * committed, and as one commit. `plan` reads the settings as they are on disk now, refuses what it must (before anything
   * changes), and says what the settings become and how to carry out the rest. The saved shelves are then also this librarian's.
   */
  async #shelfOperation(
    what: string,
    plan: (current: Settings) => { next: Settings; apply: () => Pick<ShelfResult, "moved" | "notMoved"> },
  ): Promise<ShelfResult> {
    const root = this.vault.root;
    return this.vault.withLock(async () => {
      const current = loadSettings(root);
      const { next, apply } = plan(current);
      await this.#commitOwnerChanges(what);
      saveSettings(root, next);
      this.#settings = { ...this.#settings, shelves: next.shelves, declinedShelves: next.declinedShelves };
      if (JSON.stringify(next.shelves) !== JSON.stringify(current.shelves)) writeShelfSection(root, next.shelves);
      const { moved, notMoved } = apply();
      const commit = await this.#commit(`avanzel: ${what}`);
      return { commit, moved, notMoved };
    });
  }

  /**
   * Move the page `rel` (library-relative) into `folder`: set its `shelf:` to the folder and its `index.md` line under the
   * heading `heading`. False, with the page where it was, when it isn't a page of a shelf, a link, or something is in its way.
   */
  #movePage(rel: string, folder: string, heading: string): boolean {
    const root = this.vault.root;
    const parts = rel.split("/");
    if (!isShelfPage(rel) || rel.includes("\\") || parts.some((part) => part === "" || part.startsWith("."))) return false;
    if (!lstatOrNull(join(root, rel))?.isFile() || !realFoldersTo(root, rel, false)) return false;
    const target = `${folder}/${basename(rel)}`;
    if (lstatOrNull(join(root, target)) || !realFoldersTo(root, target, true)) return false;
    renameSync(join(root, rel), join(root, target));
    replaceInside(root, target, withShelfField(readFileSync(join(root, target), "utf8"), folder));
    this.#editIndex((index) => withIndexLineMoved(index, stem(rel), heading));
    return true;
  }

  /** Rewrite `index.md` as `change` says (not at all when it changes nothing). */
  #editIndex(change: (index: string) => string): void {
    const path = this.vault.indexPath;
    const index = lstatOrNull(path)?.isFile() ? readFileSync(path, "utf8") : "";
    const edited = change(index);
    if (edited !== index) replaceInside(this.vault.root, "index.md", edited);
  }

  async #fileQueue(
    only: readonly string[] | null,
    { progress = quiet, instructions = null, signal, leave = () => false, steps, pendingShelves = [] }: FileOptions,
  ): Promise<FileOutcome[]> {
    const outcomes: FileOutcome[] = [];
    // The suggestions this run makes are pending for the captures after them.
    const pending: PendingShelf[] = [...pendingShelves];
    const attempted = new Set<string>();
    while (!signal?.aborted) {
      const queue = only ?? this.vault.pending();
      let path = queue.find((candidate) => !attempted.has(candidate) && isFile(candidate) && !leave(candidate));
      if (path === undefined) break;
      attempted.add(path);
      // Whatever goes wrong with one capture (an AvanzelError, or say EACCES from git or the disk)
      // becomes its error outcome, so its message reaches the digest; the rest go on.
      if (AUDIO_EXTS.has(extname(path).toLowerCase())) {
        progress(`Transcribing ${basename(path)} locally…`);
        let capture: Capture | null;
        try {
          capture = await this.captureAudio(path, { source: "audio", keepOriginal: false });
        } catch (error) {
          outcomes.push(outcome(stem(path), { error: errorMessage(error) }));
          continue;
        }
        if (!capture) {
          outcomes.push(outcome(stem(path), { ok: true, message: "No speech recognized; the recording was kept in raw/audio." }));
          continue;
        }
        path = capture.path;
        attempted.add(path);
      }
      try {
        path = this.#adopt(path);
      } catch (error) {
        outcomes.push(outcome(stem(path), { error: `${basename(path)}: ${errorMessage(error)}` }));
        continue;
      }
      attempted.add(path);
      progress(`Filing ${basename(path)} with ${this.harness.name}…`);
      try {
        const filed = await this.#fileOne(path, instructions, signal, steps, pending);
        const { suggestion } = filed;
        if (suggestion && !pending.some((other) => other.folder === suggestion.folder)) {
          pending.push({ folder: suggestion.folder, name: suggestion.name, definition: suggestion.definition });
        }
        outcomes.push(filed);
      } catch (error) {
        // The agent is gone, and so it is for every capture: say so, instead of failing each in turn.
        if (error instanceof NoAgentError) throw error;
        outcomes.push(outcome(stem(path), { error: errorMessage(error) })); // this capture fails alone; the rest go on
      }
    }
    return outcomes;
  }

  /**
   * Give a file dropped into the inbox by hand (Obsidian's "Untitled.md", a Shortcut's "note.txt")
   * a fresh capture id, so archiving it can never overwrite an earlier capture.
   */
  #adopt(path: string): string {
    const text = readFileSync(path, "utf8");
    const [frontmatter, body] = splitFrontmatter(text);
    if (`\n${frontmatter}\n`.includes("\ntype: capture\n") && !existsSync(this.vault.archivePath(path, this.clock()))) {
      return path;
    }
    const capture = this.vault.newCapture(frontmatter ? body : text, { source: "text", now: this.clock() });
    unlinkSync(path);
    return capture.path;
  }

  async #fileOne(
    path: string,
    instructions: string | null,
    signal?: AbortSignal,
    steps?: (step: FilingStep) => void,
    pending: readonly PendingShelf[] = [],
  ): Promise<FileOutcome> {
    const root = this.vault.root;
    const now = this.clock();
    const captureId = stem(path);
    await this.#commitOwnerChanges(`file ${captureId}`);
    const captureRel = this.vault.relativePath(path);
    const original = readFileSync(path);
    const archiveRel = this.vault.relativePath(this.vault.archivePath(path, now));
    const archiveExisted = lstatOrNull(join(root, archiveRel)) !== null;
    const attachments = this.#attachments(original.toString("utf8"));
    const before = snapshot(root);
    const call = this.#isCall(original.toString("utf8"));
    const continues = this.#continues(original.toString("utf8"));
    const files = original.toString("utf8").includes("raw/attachments/");
    const prompt = filePrompt(captureRel, captureId, now, { attachments, call, continues, files, names: parseDictionary(this.settings.voice.dictionary).map((entry) => entry.term), instructions, shelves: this.#shelfNotes(pending) });
    // Only a caller that asked for the steps is told them: Claude Code's come from its own events, and other agents'
    // from the folder. The changes below are read from `after`, the library as the run left it, whether or not they are.
    const { result, guarded, after } = await this.#run(prompt, { write: true, images: attachments, signal, before, steps });
    const restoral = restoreCapture(root, captureRel, original, archiveExisted ? null : archiveRel);
    const savedOriginal = restoral === "blocked" ? this.#keepOriginal(captureId, original) : null;
    // `after` is from before the guard and the capture's restoral put anything back. What they touch is left out: the
    // capture is in inbox/ or raw/, and the guard lists what it put back.
    const changes = diff(before, after).without([...SOURCES, ...guarded]);
    const refused = result.refused.map((refusedPath) => insideLibrary(root, refusedPath) ?? refusedPath);
    const ran = { changes, message: result.output, restored: restoral === "restored", savedOriginal, guarded, refused };
    const error = this.#notFiled(result, restoral, changes, captureId, archiveRel);
    if (error !== null) {
      // What the run left behind (it failed, timed out, was cancelled or filed nothing) is its own
      // commit, handed out with the outcome so Undo covers it; a run that changed nothing makes none.
      const commit = await this.#commit(`avanzel: leftovers of failed filing ${captureId}`);
      // A run that failed is read for why. One that exited 0 is not: its reply could say anything, and what stopped it
      // is Avanzel's own finding.
      const failure: RunFailure = result.ok ? { kind: "other", resetsAt: null, line: errorLine(error) } : classifyFailure(result);
      return outcome(captureId, { ...ran, error, commit, failure });
    }
    if (!this.vault.logMentions(captureId)) {
      this.vault.appendLog("file", `[[${captureId}]] → ${changes.pages.map(wikilink).join(", ")}`, now);
    }
    const archivedTo = this.vault.archive(path, now);
    const commit = await this.#commit(`avanzel: file ${captureId}`);
    return outcome(captureId, { ...ran, ok: true, archivedTo, commit, suggestion: this.#suggestion(changes, result.output, pending) });
  }

  /** Every shelf as the filing prompt lists it: the built-in ones, the owner's own, the pending suggestions and the ones turned down. */
  #shelfNotes(pending: readonly PendingShelf[]): ShelfNote[] {
    const { shelves, declinedShelves } = this.settings;
    const built = BUILT_IN_SHELVES.map((folder) => ({
      folder,
      name: capitalised(folder),
      definition: BUILT_IN_DEFINITIONS[folder] ?? "",
      kind: "built-in" as const,
    }));
    return [
      ...built,
      ...shelves.map((shelf) => ({ ...shelf, kind: "own" as const })),
      ...pending.map((shelf) => ({ ...shelf, kind: "pending" as const })),
      ...declinedShelves.map((folder) => ({ folder, name: folder, definition: "", kind: "declined" as const })),
    ];
  }

  /**
   * The shelf a successful filing suggests, or null. A top-level folder the agent made on its own comes first, whatever its reply
   * says; else the last well-formed `New shelf:` line of the reply, when it passes `checkedSuggestion`.
   */
  #suggestion(changes: Changes, reply: string, pending: readonly PendingShelf[]): ShelfSuggestion | null {
    const { shelves, declinedShelves } = this.settings;
    const known = [...BUILT_IN_SHELVES, ...shelves.map((shelf) => shelf.folder), ...SPECIAL_DIRS];
    const turnedDown = (folder: string) => declinedShelves.some((declined) => sameShelf(declined, folder));
    for (const [folder, pages] of agentMadeFolders(changes.created, known)) {
      if (folderProblem(folder, []) !== null || turnedDown(folder)) continue;
      return { folder, name: capitalised(folder), definition: "", pages, agentMade: true };
    }
    return checkedSuggestion(parseSuggestion(reply), {
      created: changes.created,
      own: shelves,
      declined: declinedShelves,
      pending,
      onDisk: this.#topLevelFolders(),
    });
  }

  /** The folders at the top of the library now, hidden ones left out. */
  #topLevelFolders(): string[] {
    try {
      return readdirSync(this.vault.root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  /**
   * Why a filing run did not file its capture, or null when it did. Avanzel's own findings say why first, and name the agent as
   * a person knows it: a card keeps only about the first 100 characters of a line, and a capture's id is long, while the card
   * and the evening review's digest already say which note it is.
   */
  #notFiled(result: RunResult, restoral: Restoral, changes: Changes, captureId: string, archiveRel: string): string | null {
    if (!result.ok) return (result.stderr || result.output).trim().slice(-800);
    if (restoral === "blocked") return "A symlink in inbox/ kept Avanzel from putting back the words the agent changed.";
    if (!changes.pages.length && !this.vault.logMentions(captureId)) {
      // Exit 0 but nothing written: a denied tool, a refusal or a question back. Not filed.
      const reply = collapse(result.output) || "(no reply)";
      return `${agentName(this.harness.name)} finished without filing anything. Its reply: ${reply.slice(0, 500)}`;
    }
    if (!realFoldersTo(this.vault.root, archiveRel, true)) {
      return `A folder on the way to ${archiveRel} is a symlink, so the note could not be archived.`;
    }
    const taken = lstatOrNull(join(this.vault.root, archiveRel));
    if (taken && !taken.isFile()) return `The agent left a folder at ${archiveRel}, so the note could not be archived.`;
    return null;
  }

  /**
   * Keep the owner's words where Avanzel can write without following a link: `.avanzel/logs/`,
   * kept out of git and out of Undo's reach. Returns where they are, or null. Words kept by an
   * earlier try stay as they were: by now the inbox may hold the agent's version.
   */
  #keepOriginal(captureId: string, original: Buffer): string | null {
    const rel = `${this.vault.relativePath(this.vault.logsDir)}/${captureId}.original.md`;
    if (createInside(this.vault.root, rel, original)) return rel;
    return isRegularFile(join(this.vault.root, rel)) ? rel : null;
  }

  #isCall(captureText: string): boolean {
    const [frontmatter] = splitFrontmatter(captureText);
    return frontmatterFields(frontmatter).get("source") === "call";
  }

  /**
   * The page the capture continues (its `continues:` field, set when the owner recorded it from that page): library-relative, a
   * Markdown page on a shelf that is there now. Null for anything else, so a field can never point the agent outside the library.
   */
  #continues(captureText: string): string | null {
    const [frontmatter] = splitFrontmatter(captureText);
    const rel = frontmatterFields(frontmatter).get("continues")?.replace(/^["']|["']$/g, "").trim();
    if (!rel || isAbsolute(rel) || !rel.endsWith(".md") || rel.split(/[\\/]/).some((part) => part === ".." || part === "")) return null;
    if (SOURCES.some((source) => rel.startsWith(source))) return null; // a page, never a capture or a recording
    return isRegularFile(join(this.vault.root, rel)) ? rel : null;
  }

  /** The capture's screenshots that really are images inside the library, vault-relative. */
  #attachments(captureText: string): string[] {
    const [frontmatter] = splitFrontmatter(captureText);
    return flowItems(frontmatterFields(frontmatter).get("attachments") ?? "").flatMap((listed) => {
      const inside = this.#within(resolve(this.vault.root, listed), this.vault.root);
      return inside && IMAGE_EXTS.has(extname(inside).toLowerCase()) && isFile(inside) ? [this.vault.relativePath(inside)] : [];
    });
  }

  // --- ask & review -------------------------------------------------------------------------

  /**
   * Answer from the library. It runs under the library lock even when read-only: the guard of an ask
   * that ran alongside a filing could put back a change the filing's guard had just undone. When it
   * has to wait for the lock, `progress` hears `WAITING` once, then `LOOKING` once the lock is held,
   * before the agent starts; when the library is free, it hears nothing. A save given `answer`, the one
   * the owner was shown, keeps its words as the page. A save is `saved` only by a page on the shelves: the thoughts caught while
   * it runs (a capture takes no lock) land in inbox/, and its own folders hold no answer (`isShelfPage`), so a run that wrote no
   * page commits as leftovers and logs no Ask line, however much else it finds changed.
   */
  async ask(
    question: string,
    {
      save = false,
      answer,
      signal,
      progress = quiet,
    }: { save?: boolean; answer?: string; signal?: AbortSignal; progress?: (message: string) => void } = {},
  ): Promise<AgentOutcome> {
    if (!question.trim()) throw new AvanzelError('Ask a question, e.g. "what are my goals this year?"');
    const now = this.clock();
    let waited = false;
    const run = async (): Promise<AgentOutcome> => {
      if (waited) progress(LOOKING);
      if (save) await this.#commitOwnerChanges("saving an answer");
      const before = snapshot(this.vault.root);
      const prompt = askPrompt(question, { save, now, answer, shelves: this.settings.shelves });
      const { result, guarded } = await this.#run(prompt, { write: save, signal });
      const changes = diff(before, snapshot(this.vault.root)).without(guarded);
      let commit: string | null = null;
      const saved = changes.pages.filter(isShelfPage);
      if (save && result.ok && saved.length) {
        if (!changes.modified.includes("log.md")) {
          const pages = saved.map(wikilink).join(", ");
          this.vault.appendLog("ask", `${codePoints(collapse(question), 80)} → ${pages}`, now);
        }
        commit = await this.#commit(`avanzel: save answer to “${codePoints(collapse(question), 60)}”`);
      } else if (save) {
        commit = await this.#commit("avanzel: leftovers of an answer that was not saved"); // not the owner's
      }
      return { result, changes, report: null, guarded, commit };
    };
    return this.vault.withLock(run, () => {
      waited = true;
      progress(WAITING);
    });
  }

  async review({ signal }: { signal?: AbortSignal } = {}): Promise<AgentOutcome> {
    const now = this.clock();
    return this.vault.withLock(async () => {
      const root = this.vault.root;
      const report = this.#newReportPath(localDate(now));
      const reportRel = this.vault.relativePath(report);
      realFoldersTo(root, reportRel, true); // reviews/, for the agent to write into
      await this.#commitOwnerChanges(`review ${stem(report)}`);
      const before = snapshot(root);
      const { result, guarded } = await this.#run(reviewPrompt(reportRel, now, this.settings.shelves), { write: true, signal });
      if (result.ok && result.output) {
        // Only when the agent wrote no report; never through a link it may have put there.
        createInside(root, reportRel, `# Review ${localDate(now)}\n\n${result.output}\n`);
      }
      const changes = diff(before, snapshot(root)).without(guarded);
      let commit: string | null;
      if (result.ok) {
        if (!this.vault.logMentions(stem(report))) this.vault.appendLog("review", `[[${stem(report)}]]`, now);
        commit = await this.#commit(`avanzel: review ${stem(report)}`);
      } else {
        commit = await this.#commit(`avanzel: leftovers of failed review ${stem(report)}`); // not the owner's
      }
      return { result, changes, report: isRegularFile(report) ? report : null, guarded, commit };
    });
  }

  // --- plumbing -----------------------------------------------------------------------------

  /**
   * One agent run; returns its result and what the guard put back after it: changes to the protected paths and
   * links the agent left in Avanzel's own paths (see `FileOutcome.guarded`). Given `before` (the library as it was when
   * the run began), it also returns `after`, the library as the run left it, for the caller to diff against `before`.
   * `after` is taken once, right after the run and before the guard puts anything back. Given `steps` too, the run tells
   * each step the agent takes as it takes it, and the watch of the folder (for an agent that doesn't tell its own)
   * reports what is left from that same `after`.
   */
  #run(prompt: string, options: RunSpec & WithBefore): Promise<Ran & { after: Snapshot }>;
  #run(prompt: string, options: RunSpec): Promise<Ran>;
  async #run(
    prompt: string,
    { write, images = [], signal, before, steps }: RunSpec & Partial<WithBefore>,
  ): Promise<Ran & { after?: Snapshot }> {
    const root = this.vault.root;
    const protectedBefore = protectedState(root);
    let result: RunResult;
    let guarded: string[];
    let after: Snapshot | undefined;
    try {
      const harness = this.harness;
      const model = Object.hasOwn(this.settings.models, harness.name) ? (this.settings.models[harness.name] ?? null) : null;
      const narration = before && steps ? narrate(root, harness, before, steps) : null;
      try {
        result = await runHeadless(harness, prompt, root, {
          write,
          model,
          timeoutSeconds: this.settings.timeoutSeconds,
          images,
          signal,
          onStep: narration?.onStep,
          private: this.settings.private,
          privateKey: this.#privateKey(),
          hosted: this.#hosted,
        });
      } finally {
        // Right after the run, before the guard: what the guard puts back is its own doing, not a step of the agent's.
        // The watch stops whatever becomes of the snapshot.
        try {
          after = before ? snapshot(root) : undefined;
        } finally {
          narration?.stop(after);
        }
      }
    } finally {
      guarded = undoProtected(root, protectedBefore);
    }
    return { result, guarded, after };
  }

  async #commit(message: string): Promise<string | null> {
    return this.settings.autoCommit ? gitops.commitAll(this.vault.root, message) : null;
  }

  /**
   * Commit whatever is pending — the owner's own edits, captures and settings since the last
   * commit — on its own, right before an agent run or the evening review's digest. The run's commit
   * then holds only what the run changed (plus the archive and log), so undoing it never takes the
   * owner's work along. This commit is never handed out for undo. What the owner changes while an
   * agent is running still lands in that run's commit: an accepted gap, short of locking them out.
   */
  async #commitOwnerChanges(before: string): Promise<void> {
    await this.#commit(`avanzel: owner's changes before ${before}`);
  }

  /** reviews/<name>.md, or <name>-2.md, <name>-3.md, … when taken. */
  #newReportPath(name: string): string {
    const folder = join(this.vault.root, "reviews");
    for (let counter = 1; ; counter++) {
      const candidate = join(folder, counter === 1 ? `${name}.md` : `${name}-${counter}.md`);
      if (!lstatOrNull(candidate)) return candidate; // a dangling link counts as taken
    }
  }

  /** `file` itself when it lies under raw/<folder>/ already; otherwise a copy (or the moved file) at a fresh path there. */
  #keepUnder(folder: string, file: string, keepOriginal: boolean, claim: (suffix: string) => string): string {
    const inside = this.#within(file, join(this.vault.raw, folder));
    if (inside) return inside;
    const target = claim(extname(file).toLowerCase());
    if (keepOriginal) copyFileSync(file, target);
    else moveFile(file, target);
    return target;
  }

  /** `file` re-based onto `folder` when it really (symlinks resolved) lies inside it, else null. */
  #within(file: string, folder: string): string | null {
    let rel: string;
    try {
      rel = relative(realpathSync(folder), realpathSync(file));
    } catch {
      return null;
    }
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
    return join(folder, rel);
  }

  /** Where a source file a revert would delete goes instead (null: let it go). */
  #keptOnUndo(rel: string): string | null {
    if (!SOURCES.some((prefix) => rel.startsWith(prefix))) return null;
    const archived = /^raw\/\d{4}\/\d{2}\/([^/]+)$/.exec(rel);
    if (archived?.[1] && TEXT_EXTS.has(extname(rel).toLowerCase())) {
      const back = `inbox/${archived[1]}`;
      return existsSync(join(this.vault.root, back)) ? null : back; // the revert may have put it back already
    }
    return rel;
  }
}

function outcome(captureId: string, fields: Partial<Omit<FileOutcome, "captureId">>): FileOutcome {
  return {
    captureId,
    ok: false,
    changes: new Changes([], [], []),
    message: "",
    archivedTo: null,
    error: "",
    restored: false,
    savedOriginal: null,
    guarded: [],
    refused: [],
    commit: null,
    failure: null,
    suggestion: null,
    ...fields,
  };
}

/**
 * How a run's steps reach `steps`. Claude Code tells its own tool calls (`onStep`, handed to the run). Any other agent
 * has its writes seen in the folder (`watchWrites`) from now until `stop(after)`, which the caller calls when the run is
 * over, with the library as the run left it if it has taken that already.
 */
function narrate(
  root: string,
  harness: Harness,
  before: Snapshot,
  steps: (step: FilingStep) => void,
): { onStep: ((step: ToolStep) => void) | undefined; stop: (after?: Snapshot) => void } {
  if (!harness.streams) return { onStep: undefined, stop: watchWrites(root, before, steps) };
  return {
    onStep: (step) => {
      const told = filingStep(root, before, step);
      if (told) steps(told);
    },
    stop: quiet,
  };
}

/** A tool call of Claude Code as a step in the library, or null when a step may not name its path. */
function filingStep(root: string, before: Snapshot, step: ToolStep): FilingStep | null {
  if (step.kind === "search") return step;
  const rel = stepPath(root, step.path);
  if (rel === null) return null;
  return step.kind === "read" ? { kind: "read", path: rel } : { kind: "wrote", path: rel, created: !before.has(rel) };
}

function digest(outcomes: readonly FileOutcome[], now: Date): string {
  const filed = outcomes.filter((outcome) => outcome.ok);
  const failed = outcomes.filter((outcome) => !outcome.ok);
  const total = outcomes.length;
  const lines = [`# Evening review ${localDate(now)}`, "", `Filed ${filed.length} of ${total} capture${total === 1 ? "" : "s"}.`];
  if (filed.length) {
    lines.push("", "## What went where", "");
    for (const { captureId, message, changes, restored, guarded } of filed) {
      lines.push(`- [[${captureId}]]: ${ellipsize(collapse(message), 300) || "(no reply)"}`);
      const created = changes.created.filter(isPage).map(wikilink);
      const updated = changes.modified.filter(isPage).map(wikilink);
      if (created.length) lines.push(`  - New: ${created.join(", ")}`);
      if (updated.length) lines.push(`  - Updated: ${updated.join(", ")}`);
      if (restored) lines.push("  - The agent edited your capture; your original words were restored.");
      if (guarded.length) {
        const offLimits = "library rules, settings and tasks are off-limits to it, and so are links in Avanzel's own folders";
        lines.push(`  - Undid the agent's changes to ${guarded.join(", ")} (${offLimits}).`);
      }
    }
  }
  if (failed.length) {
    lines.push("", "## Needs attention", "");
    for (const { captureId, error, savedOriginal } of failed) {
      const where = savedOriginal ? `your words are kept in ${savedOriginal}` : "still in the inbox";
      lines.push(`- [[${captureId}]]: ${errorLine(error) || "the agent failed"} (${where})`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** How the capture came out of a run: as the owner left it, put back, or not put back (a symlink in the way). */
type Restoral = "same" | "restored" | "blocked";

/**
 * Put the capture (`rel`) back exactly as the owner said it. `archiveRel` is where the agent may have
 * archived it itself (null if that file predates the run). Nothing is written, moved or deleted
 * through a symlink below the library root.
 */
function restoreCapture(root: string, rel: string, original: Buffer, archiveRel: string | null): Restoral {
  const path = join(root, rel);
  if (isRegularFile(path) && readFileSync(path).equals(original)) return "same";
  if (archiveRel && !lstatOrNull(path) && realFoldersTo(root, archiveRel, false) && realFoldersTo(root, rel, true)) {
    const archived = join(root, archiveRel);
    if (isRegularFile(archived) && readFileSync(archived).equals(original)) {
      renameSync(archived, path); // the agent archived it itself; that is fine
      return "same";
    }
  }
  if (!realFoldersTo(root, rel, true)) return "blocked";
  writeInside(root, rel, original);
  if (archiveRel) removeInside(root, archiveRel);
  return "restored";
}

function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    copyFileSync(from, to);
    unlinkSync(from);
  }
}

function ownShelf(settings: Settings, folder: string): OwnShelf {
  const shelf = settings.shelves.find((other) => other.folder === folder);
  if (!shelf) throw new AvanzelError(`${folder} is not one of your shelves, so nothing was changed.`);
  return shelf;
}

/** A built-in shelf's index heading is its folder name with a capital: an own shelf can't take it, or removing that shelf would take the heading. */
function refuseBuiltInName(name: string): void {
  const builtIn = BUILT_IN_SHELVES.find((folder) => sameShelf(folder, name));
  if (builtIn) {
    throw new AvanzelError(`A shelf called ${builtIn.charAt(0).toUpperCase()}${builtIn.slice(1)} already exists. Choose another name.`);
  }
}

function checkedName(name: string): string {
  const trimmed = name.trim();
  const length = shelfTextLength(trimmed);
  if (length < 1) throw new AvanzelError("Give the shelf a name, then save it.");
  if (length > MAX_SHELF_NAME) {
    throw new AvanzelError(`A shelf name can be at most ${MAX_SHELF_NAME} characters, and this one has ${length}. Choose a shorter name.`);
  }
  if (nameBreaksRules(trimmed)) throw new AvanzelError("A shelf name can't hold | or a line break. Remove them, then save it.");
  return trimmed;
}

function checkedDefinition(text: string): string {
  const definition = cleanDefinition(text);
  if (definition === "") throw new AvanzelError("Say what belongs on the shelf, then save it.");
  return definition;
}

/** Whether the folder holds nothing but hidden files such as .DS_Store. */
function isEmptyFolder(path: string): boolean {
  return readdirSync(path).every((name) => name.startsWith("."));
}

/** `text` (a page) with `shelf: <folder>` in its front matter: replaced if there, added if not, a block made if there is none. */
function withShelfField(text: string, folder: string): string {
  const line = `shelf: ${folder}`;
  if (!text.startsWith("---\n") || text.indexOf("\n---\n", 3) === -1) return `---\n${line}\n---\n${text}`;
  const [block, body] = splitFrontmatter(text);
  const lines = block === "" ? [] : block.split("\n");
  const at = lines.findIndex((each) => /^shelf:/.test(each));
  const carriage = (lines[at === -1 ? lines.length - 1 : at] ?? "").endsWith("\r") ? "\r" : "";
  if (at === -1) lines.push(`${line}${carriage}`);
  else lines[at] = `${line}${carriage}`;
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

function stem(path: string): string {
  return basename(path, extname(path));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wikilink(page: string): string {
  return `[[${stem(page)}]]`;
}

function isPage(path: string): boolean {
  return path.endsWith(".md") && path.includes("/");
}

/** A page of a shelf: a page in none of the folders that hold no shelf pages (inbox/, raw/, reviews/ and tasks/: `SPECIAL_DIRS`). */
function isShelfPage(path: string): boolean {
  return isPage(path) && !SPECIAL_DIRS.includes(path.split("/")[0] ?? "");
}

function capitalised(folder: string): string {
  return folder.charAt(0).toUpperCase() + folder.slice(1);
}

function collapse(text: string): string {
  return text.trim().split(/\s+/).filter(Boolean).join(" ");
}

function codePoints(text: string, count: number): string {
  return Array.from(text).slice(0, count).join("");
}

function ellipsize(text: string, max: number): string {
  return Array.from(text).length > max ? `${codePoints(text, max - 1)}…` : text;
}

function isRegularFile(path: string): boolean {
  return lstatOrNull(path)?.isFile() ?? false;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
