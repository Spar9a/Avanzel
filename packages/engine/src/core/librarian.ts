// The orchestration layer: hand one capture at a time to the harness and enforce the filing contract.
//
// The agent does the thinking (which shelf, which pages, which links). Avanzel guarantees the
// bookkeeping no matter how the agent behaves: the owner's words are restored if touched, a run that
// filed nothing leaves the capture in the inbox, the log gets its line, the capture is archived under
// a name that never overwrites another, the library's rules, settings and shadow tasks are put back,
// and every filing is its own git commit, so it can be undone.

import { copyFileSync, existsSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AvanzelError, type Transcriber } from "../types.ts";
import { Changes, diff, snapshot } from "./changes.ts";
import type { Settings } from "./config.ts";
import { localDate } from "./dates.ts";
import { flowItems, frontmatterFields, splitFrontmatter } from "./frontmatter.ts";
import * as gitops from "./git.ts";
import { protectedState, undoProtected } from "./guard.ts";
import { errorLine, runHeadless, selectHarness, type Harness, type RunResult } from "./harness.ts";
import { createInside, lstatOrNull, realFoldersTo, removeInside, writeInside } from "./inside.ts";
import { askPrompt, filePrompt, reviewPrompt } from "./prompts.ts";
import { AUDIO_EXTS, IMAGE_EXTS, TEXT_EXTS, type Capture, type Vault } from "./vault.ts";

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
  /** Protected paths whose changes were undone. */
  guarded: string[];
  /**
   * The run's commit, for Undo: the filing, or what a failed, timed-out or cancelled run left
   * behind. Null without git, with auto_commit off, or when a failed run changed nothing.
   */
  commit: string | null;
}

export interface AgentOutcome {
  result: RunResult;
  changes: Changes;
  report: string | null;
  guarded: string[];
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
  context?: { app?: string; title?: string; url?: string };
}

export interface FileOptions {
  progress?: (message: string) => void;
  /** The owner's standing instructions for this run (a shadow task's body). */
  instructions?: string | null;
  signal?: AbortSignal;
}

export interface LibrarianOptions {
  harnessName?: string | null;
  /** Only `captureAudio` (and filing recordings dropped into the inbox) needs one. */
  transcriber?: Transcriber | null;
  clock?: () => Date;
}

function quiet(): void {}

export class Librarian {
  readonly vault: Vault;
  readonly settings: Settings;
  readonly harnessName: string | null;
  readonly clock: () => Date;
  readonly #transcriber: Transcriber | null;
  #harness: Harness | null = null;

  constructor(
    vault: Vault,
    settings: Settings,
    { harnessName = null, transcriber = null, clock = () => new Date() }: LibrarianOptions = {},
  ) {
    this.vault = vault;
    this.settings = settings;
    this.harnessName = harnessName;
    this.clock = clock;
    this.#transcriber = transcriber;
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
    return this.vault.newCapture(transcript.text, { source, audio: stored, transcriber: transcript.engine, now });
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
      context: { app: context.app, title: context.title, url: context.url },
      attachments: [stored],
      audio: recording,
      transcriber,
      now,
    });
  }

  // --- file ---------------------------------------------------------------------------------

  /**
   * File captures one per agent run, oldest first. Without `only`, the inbox is re-read after every
   * capture, so anything captured meanwhile is filed too.
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
      this.vault.ensureFolders();
      return undone;
    });
  }

  async #fileQueue(only: readonly string[] | null, { progress = quiet, instructions = null, signal }: FileOptions): Promise<FileOutcome[]> {
    const outcomes: FileOutcome[] = [];
    const attempted = new Set<string>();
    while (!signal?.aborted) {
      const queue = only ?? this.vault.pending();
      let path = queue.find((candidate) => !attempted.has(candidate) && isFile(candidate));
      if (path === undefined) break;
      attempted.add(path);
      if (AUDIO_EXTS.has(extname(path).toLowerCase())) {
        progress(`Transcribing ${basename(path)} locally…`);
        let capture: Capture | null;
        try {
          capture = await this.captureAudio(path, { source: "audio", keepOriginal: false });
        } catch (error) {
          if (!(error instanceof AvanzelError)) throw error;
          outcomes.push(outcome(stem(path), { error: error.message }));
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
        if (!(error instanceof AvanzelError)) throw error;
        outcomes.push(outcome(stem(path), { error: `${basename(path)}: ${error.message}` }));
        continue;
      }
      attempted.add(path);
      progress(`Filing ${basename(path)} with ${this.harness.name}…`);
      try {
        outcomes.push(await this.#fileOne(path, instructions, signal));
      } catch (error) {
        if (!(error instanceof AvanzelError)) throw error;
        outcomes.push(outcome(stem(path), { error: error.message })); // this capture fails alone; the rest go on
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

  async #fileOne(path: string, instructions: string | null, signal?: AbortSignal): Promise<FileOutcome> {
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
    const prompt = filePrompt(captureRel, captureId, now, { attachments, instructions });
    const { result, guarded } = await this.#run(prompt, { write: true, images: attachments, signal });
    const restoral = restoreCapture(root, captureRel, original, archiveExisted ? null : archiveRel);
    const savedOriginal = restoral === "blocked" ? this.#keepOriginal(captureId, original) : null;
    const changes = diff(before, snapshot(root)).without([...SOURCES, ...guarded]);
    const ran = { changes, message: result.output, restored: restoral === "restored", savedOriginal, guarded };
    const error = this.#notFiled(result, restoral, changes, captureId, archiveRel);
    if (error !== null) {
      // What the run left behind (it failed, timed out, was cancelled or filed nothing) is its own
      // commit, handed out with the outcome so Undo covers it; a run that changed nothing makes none.
      const commit = await this.#commit(`avanzel: leftovers of failed filing ${captureId}`);
      return outcome(captureId, { ...ran, error, commit });
    }
    if (!this.vault.logMentions(captureId)) {
      this.vault.appendLog("file", `[[${captureId}]] → ${changes.pages.map(wikilink).join(", ")}`, now);
    }
    const archivedTo = this.vault.archive(path, now);
    const commit = await this.#commit(`avanzel: file ${captureId}`);
    return outcome(captureId, { ...ran, ok: true, archivedTo, commit });
  }

  /** Why a filing run did not file its capture, or null when it did. */
  #notFiled(result: RunResult, restoral: Restoral, changes: Changes, captureId: string, archiveRel: string): string | null {
    if (!result.ok) return (result.stderr || result.output).trim().slice(-800);
    if (restoral === "blocked") {
      return `The agent changed ${captureId}, and Avanzel does not write it back through a symlink in inbox/.`;
    }
    if (!changes.pages.length && !this.vault.logMentions(captureId)) {
      // Exit 0 but nothing written: a denied tool, a refusal or a question back. Not filed.
      const reply = collapse(result.output) || "(no reply)";
      return `${this.harness.name} finished without filing anything. Its reply: ${reply.slice(0, 500)}`;
    }
    if (!realFoldersTo(this.vault.root, archiveRel, true)) {
      return `Could not archive ${captureId}: a folder on the way to ${archiveRel} is a symlink.`;
    }
    const taken = lstatOrNull(join(this.vault.root, archiveRel));
    if (taken && !taken.isFile()) return `Could not archive ${captureId}: the agent left a folder at ${archiveRel}.`;
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
   * before the agent starts; when the library is free, it hears nothing.
   */
  async ask(
    question: string,
    { save = false, signal, progress = quiet }: { save?: boolean; signal?: AbortSignal; progress?: (message: string) => void } = {},
  ): Promise<AgentOutcome> {
    if (!question.trim()) throw new AvanzelError('Ask a question, e.g. "what are my goals this year?"');
    const now = this.clock();
    let waited = false;
    const answer = async (): Promise<AgentOutcome> => {
      if (waited) progress(LOOKING);
      if (save) await this.#commitOwnerChanges("saving an answer");
      const before = snapshot(this.vault.root);
      const { result, guarded } = await this.#run(askPrompt(question, { save, now }), { write: save, signal });
      const changes = diff(before, snapshot(this.vault.root)).without(guarded);
      if (save && result.ok && changes.pages.length) {
        if (!changes.modified.includes("log.md")) {
          const pages = changes.pages.map(wikilink).join(", ");
          this.vault.appendLog("ask", `${codePoints(collapse(question), 80)} → ${pages}`, now);
        }
        await this.#commit(`avanzel: save answer to “${codePoints(collapse(question), 60)}”`);
      } else if (save) {
        await this.#commit("avanzel: leftovers of an answer that was not saved"); // not the owner's
      }
      return { result, changes, report: null, guarded };
    };
    return this.vault.withLock(answer, () => {
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
      const { result, guarded } = await this.#run(reviewPrompt(reportRel, now), { write: true, signal });
      if (result.ok && result.output) {
        // Only when the agent wrote no report; never through a link it may have put there.
        createInside(root, reportRel, `# Review ${localDate(now)}\n\n${result.output}\n`);
      }
      const changes = diff(before, snapshot(root)).without(guarded);
      if (result.ok) {
        if (!this.vault.logMentions(stem(report))) this.vault.appendLog("review", `[[${stem(report)}]]`, now);
        await this.#commit(`avanzel: review ${stem(report)}`);
      } else {
        await this.#commit(`avanzel: leftovers of failed review ${stem(report)}`); // not the owner's
      }
      return { result, changes, report: isRegularFile(report) ? report : null, guarded };
    });
  }

  // --- plumbing -----------------------------------------------------------------------------

  /** One agent run; returns its result and the protected paths whose changes were undone. */
  async #run(
    prompt: string,
    { write, images = [], signal }: { write: boolean; images?: readonly string[]; signal?: AbortSignal | undefined },
  ): Promise<{ result: RunResult; guarded: string[] }> {
    const root = this.vault.root;
    const protectedBefore = protectedState(root);
    let result: RunResult;
    let guarded: string[];
    try {
      const harness = this.harness;
      const model = Object.hasOwn(this.settings.models, harness.name) ? (this.settings.models[harness.name] ?? null) : null;
      result = await runHeadless(harness, prompt, root, {
        write,
        model,
        timeoutSeconds: this.settings.timeoutSeconds,
        images,
        signal,
      });
    } finally {
      guarded = undoProtected(root, protectedBefore);
    }
    return { result, guarded };
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
    commit: null,
    ...fields,
  };
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

function stem(path: string): string {
  return basename(path, extname(path));
}

function wikilink(page: string): string {
  return `[[${stem(page)}]]`;
}

function isPage(path: string): boolean {
  return path.endsWith(".md") && path.includes("/");
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
