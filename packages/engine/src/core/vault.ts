// The library on disk: layout, captures, inbox, archive, log, lock.
//
// Karpathy's LLM-wiki layers map onto folders: `inbox/` + `raw/` hold the owner's immutable words,
// the shelves hold the agent-maintained wiki, and AGENTS.md is the schema every harness reads.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { uptime } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { AvanzelError } from "../types.ts";
import { visibleFiles } from "./changes.ts";
import { CONFIG_NAME, defaultSettings, saveSettings, VAULT_MARKER } from "./config.ts";
import { idStamp, isoLocal, localMinute, yearMonth } from "./dates.ts";
import { yamlScalar } from "./frontmatter.ts";
import * as gitops from "./git.ts";
import { lstatOrNull, realFoldersTo, replaceInside } from "./inside.ts";
import { ensureDefaultTasks } from "./tasks.ts";
import { template } from "./templates.ts";

export { isoLocal } from "./dates.ts";

export const SHELVES = ["goals", "ideas", "problems", "memories", "people", "topics"] as const;
/** Top-level folders that are not shelves. */
export const SPECIAL_DIRS: readonly string[] = ["inbox", "raw", "reviews", "tasks"];
export const TEXT_EXTS: ReadonlySet<string> = new Set([".md", ".txt"]);
export const AUDIO_EXTS: ReadonlySet<string> = new Set([
  ".wav", ".m4a", ".mp3", ".ogg", ".oga", ".opus", ".flac", ".aiff", ".aif", ".aac", ".webm", ".mp4", ".caf",
]);
export const IMAGE_EXTS: ReadonlySet<string> = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".tiff", ".tif", ".bmp", ".avif",
]);

// vault-relative path -> template name (`.avanzel/config.toml` is rendered from the default settings)
const SCAFFOLD: Readonly<Record<string, string>> = {
  "AGENTS.md": "AGENTS.md",
  "CLAUDE.md": "CLAUDE.md",
  "index.md": "index.md",
  "log.md": "log.md",
  "opencode.json": "opencode.json",
  ".gitignore": "gitignore",
};
const RESERVED_FIELDS = new Set(["id", "type", "source", "created", "attachments", "audio", "transcriber"]);

const LOCK_POLL_MS = 200;
// mkdir and writing the owner are two steps; an owner-less lock is only abandoned after this long.
const OWNERLESS_LOCK_GRACE_MS = 10_000;
// Releasing reads the owner file, which can fail for a moment (too many open files, say): it is read
// this many times, this far apart, before the lock is left as it is.
const RELEASE_TRIES = 5;
const RELEASE_RETRY_MS = 100;
// This boot, to the second. A lock from an earlier boot is stale even if its pid is alive again.
const BOOT_SECONDS = Math.round(Date.now() / 1000 - uptime());
const SAME_BOOT_SECONDS = 60;
// This process's start, to the second. A lock whose live pid started at another time is stale: the pid was reused.
const START_SECONDS = Math.round(Date.now() / 1000 - process.uptime());
const SAME_START_SECONDS = 60;
// Owner line -> whether its live pid was reused: `ps` runs once per owner line, not on every poll.
const reusedPids = new Map<string, boolean>();

export interface Capture {
  id: string;
  path: string;
  source: string;
}

export interface CaptureOptions {
  /** text, voice, audio, screen, chat, … */
  source: string;
  /** The recording the text was transcribed from, inside `raw/audio/`. */
  audio?: string | null;
  /** Screenshots inside the library, usually under `raw/attachments/`. */
  attachments?: readonly string[];
  /** Where the capture came from: `app`, `title`, `url`, … (empty values are left out). */
  context?: Readonly<Record<string, string | undefined>>;
  /** The speech-to-text engine, e.g. "onnx-asr:nemo-parakeet-tdt-0.6b-v3". */
  transcriber?: string | null;
  now?: Date;
}

export function slugify(text: string, maxWords = 5, maxLength = 40): string {
  const ascii = text.normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
  const words = (ascii.toLowerCase().match(/[a-z0-9]+/g) ?? []).slice(0, maxWords);
  return words.join("-").slice(0, maxLength).replace(/^-+|-+$/g, "");
}

export class Vault {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  get inbox(): string {
    return join(this.root, "inbox");
  }

  get raw(): string {
    return join(this.root, "raw");
  }

  get indexPath(): string {
    return join(this.root, "index.md");
  }

  get logPath(): string {
    return join(this.root, "log.md");
  }

  get metaDir(): string {
    return join(this.root, VAULT_MARKER);
  }

  get lockDir(): string {
    return join(this.metaDir, "lock.d");
  }

  get logsDir(): string {
    return join(this.metaDir, "logs");
  }

  exists(): boolean {
    return isDirectory(this.metaDir);
  }

  require(): this {
    if (!this.exists()) {
      throw new AvanzelError(`No Avanzel library at ${this.root}. Create one in the Avanzel app or with \`avanzel init\`.`);
    }
    return this;
  }

  static async init(root: string, { git = true }: { git?: boolean } = {}): Promise<Vault> {
    const vault = new Vault(root);
    vault.ensureFolders();
    for (const [rel, name] of Object.entries(SCAFFOLD)) {
      const target = join(vault.root, rel);
      if (!existsSync(target)) writeFileSync(target, template(name), "utf8");
    }
    if (!existsSync(join(vault.metaDir, CONFIG_NAME))) saveSettings(vault.root, defaultSettings());
    ensureDefaultTasks(vault);
    // Without a usable git (none, or only Apple's stub, which would open an install dialog), no git runs at all.
    if (git && gitops.gitUsable() && !gitops.isRepo(vault.root)) {
      await gitops.initRepo(vault.root);
      await gitops.commitAll(vault.root, "avanzel: new library");
    }
    return vault;
  }

  /** Create the inbox, sources, reviews and shelf folders that are missing (git drops emptied folders). */
  ensureFolders(): void {
    for (const folder of ["inbox", "raw", "reviews", ...SHELVES]) mkdirSync(join(this.root, folder), { recursive: true });
    mkdirSync(this.logsDir, { recursive: true });
  }

  // --- captures -----------------------------------------------------------------------------

  /** Write the owner's words into the inbox under a fresh id (atomic, never overwrites another capture). */
  newCapture(text: string, options: CaptureOptions): Capture {
    const { source, audio = null, attachments = [], context = {}, transcriber = null, now = new Date() } = options;
    const words = text.trim();
    if (!words && !attachments.length) throw new AvanzelError("Nothing to capture: the text is empty.");
    const fields = Object.entries(context).filter((entry): entry is [string, string] => Boolean(entry[1]));
    for (const [key] of fields) {
      if (!/^[A-Za-z][\w-]*$/.test(key) || RESERVED_FIELDS.has(key)) throw new Error(`Invalid capture field: ${key}`);
    }
    const render = (id: string) => {
      const lines = ["---", `id: ${id}`, "type: capture", `source: ${yamlScalar(source)}`, `created: ${isoLocal(now)}`];
      for (const [key, value] of fields) lines.push(`${key}: ${yamlScalar(value)}`);
      if (attachments.length) {
        lines.push(`attachments: [${attachments.map((file) => yamlScalar(this.relativePath(file), true)).join(", ")}]`);
      }
      if (audio) lines.push(`audio: ${yamlScalar(this.relativePath(audio))}`);
      if (transcriber) lines.push(`transcriber: ${yamlScalar(transcriber)}`);
      lines.push("---", "", words || "(no comment)", "");
      for (const file of [...attachments, ...(audio ? [audio] : [])]) lines.push(`![[${basename(file)}]]`, "");
      return lines.join("\n");
    };
    const slug = slugify(words);
    mkdirSync(this.inbox, { recursive: true });
    for (const id of this.candidateIds(slug ? `${idStamp(now)}-${slug}` : idStamp(now))) {
      const path = join(this.inbox, `${id}.md`);
      if (publish(path, render(id))) return { id, path, source };
    }
    throw new Error("unreachable: candidate ids are unbounded");
  }

  /** Claim a fresh recording path (created empty, so concurrent recorders never share one), never through a link. */
  newAudioPath(now: Date, suffix = ".wav"): string {
    return claim(this.root, `raw/audio/${yearMonth(now).join("/")}`, idStamp(now), suffix);
  }

  /** Claim a fresh screenshot path under `raw/attachments/YYYY/MM/` (created empty), never through a link. */
  newAttachmentPath(now: Date, suffix: string): string {
    return claim(this.root, `raw/attachments/${yearMonth(now).join("/")}`, idStamp(now), suffix);
  }

  /** Text and audio files waiting in the inbox, oldest (by name) first. */
  pending(): string[] {
    let names: string[];
    try {
      names = readdirSync(this.inbox);
    } catch {
      return [];
    }
    return names
      .filter((name) => !name.startsWith(".") && PENDING_EXTS.has(extname(name).toLowerCase()))
      .map((name) => join(this.inbox, name))
      .filter(isFile)
      .sort();
  }

  archivePath(capturePath: string, now?: Date): string {
    const name = basename(capturePath);
    const dated = /^(\d{4})-(\d{2})-/.exec(name);
    const [year, month] = dated ? [dated[1] ?? "", dated[2] ?? ""] : yearMonth(now ?? new Date());
    return join(this.raw, year, month, name);
  }

  /**
   * Move a capture to its archive path. Refuses when a folder on the way is a symlink (it could lead
   * out of the library), or when something that is not a file, such as a folder, is at the path.
   */
  archive(capturePath: string, now?: Date): string {
    const destination = this.archivePath(capturePath, now);
    const rel = this.relativePath(destination);
    if (!realFoldersTo(this.root, rel, true)) {
      throw new AvanzelError(`Not archiving ${basename(capturePath)}: a folder on the way to ${rel} is a symlink.`);
    }
    const taken = lstatOrNull(destination);
    if (taken && !taken.isFile()) {
      throw new AvanzelError(`Not archiving ${basename(capturePath)}: ${rel} is already there, and it is not a file.`);
    }
    renameSync(capturePath, destination);
    return destination;
  }

  /** `path` relative to the library root, with forward slashes. */
  relativePath(path: string): string {
    const rel = relative(this.root, path);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new AvanzelError(`${path} is not inside the library at ${this.root}.`);
    }
    return rel.split(sep).join("/");
  }

  private *candidateIds(stem: string): Generator<string> {
    for (let counter = 1; ; counter++) {
      const id = counter === 1 ? stem : `${stem}-${counter}`;
      if (!existsSync(join(this.inbox, `${id}.md`)) && !existsSync(this.archivePath(`${id}.md`))) yield id;
    }
  }

  // --- log, shelves, lock -------------------------------------------------------------------

  static logLine(now: Date, op: string, details: string): string {
    return `- ${localMinute(now)} | ${op} | ${details}`;
  }

  /**
   * Append one line to log.md. The new log is written aside and renamed into place: a symlink at
   * log.md is replaced rather than followed (and not read through), and a file outside the library
   * that an agent hard-linked as log.md is left as it was.
   */
  appendLog(op: string, details: string, now = new Date()): void {
    const existing = lstatOrNull(this.logPath)?.isFile() ? readFileSync(this.logPath, "utf8") : "# Log\n";
    const separator = existing && !existing.endsWith("\n") ? "\n" : "";
    replaceInside(this.root, "log.md", `${existing}${separator}${Vault.logLine(now, op, details)}\n`);
  }

  logMentions(captureId: string): boolean {
    try {
      return readFileSync(this.logPath, "utf8").includes(`[[${captureId}]]`);
    } catch {
      return false;
    }
  }

  /** Pages per shelf: the standard shelves first, then the owner's own folders A–Z. */
  shelfCounts(): Record<string, number> {
    const folders = readdirSync(this.root).filter(
      (name) => !name.startsWith(".") && !SPECIAL_DIRS.includes(name) && isDirectory(join(this.root, name)),
    );
    const standard: readonly string[] = SHELVES;
    const ordered = [
      ...standard.filter((name) => folders.includes(name)),
      ...folders.filter((name) => !standard.includes(name)).sort(),
    ];
    return Object.fromEntries(
      ordered.map((name) => [name, visibleFiles(join(this.root, name)).filter((file) => file.endsWith(".md")).length]),
    );
  }

  /**
   * Serialise agent runs on this library (a dictation filed while the evening review runs, a second
   * app). The lock is the folder `.avanzel/lock.d`, created atomically, holding the owner's pid, boot,
   * start and a token for this hold; a lock whose owner is gone — or was taken before the machine
   * restarted, or by an earlier process with the same pid — is taken over. Only its holder removes it.
   */
  async withLock<T>(fn: () => T | Promise<T>, onWait?: () => void): Promise<T> {
    mkdirSync(this.metaDir, { recursive: true });
    const owner = `${process.pid} ${BOOT_SECONDS} ${START_SECONDS} ${randomUUID()}\n`;
    let waiting = false;
    while (!tryLock(this.lockDir, owner)) {
      if (!waiting) {
        waiting = true;
        onWait?.();
      }
      await sleep(LOCK_POLL_MS);
    }
    try {
      return await fn();
    } finally {
      await release(this.lockDir, owner);
    }
  }
}

const PENDING_EXTS: ReadonlySet<string> = new Set([...TEXT_EXTS, ...AUDIO_EXTS]);

/**
 * Create `path` with `content` atomically; false if the name is already taken.
 *
 * The content goes to a private temp file that is then hard-linked into place: the link fails
 * instead of overwriting when another capture claimed the name first, and a concurrent filer never
 * sees half a file. Filesystems without hard links fall back to an exclusive create.
 */
function publish(path: string, content: string): boolean {
  const partial = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(partial, content, { encoding: "utf8", flag: "wx" });
    linkSync(partial, path);
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    try {
      writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
      return true;
    } catch (fallback) {
      if (errorCode(fallback) === "EEXIST") return false;
      throw fallback;
    }
  } finally {
    rmSync(partial, { force: true });
  }
}

/**
 * Create the first free `<stem>[-N]<suffix>` in `folder` (library-relative), empty, and return its
 * path. The folders are made, and must be, real folders inside the library: never through a link,
 * and a file on the way refuses too.
 */
function claim(root: string, folder: string, stem: string, suffix: string): string {
  if (!realFoldersTo(root, `${folder}/${stem}${suffix}`, true)) {
    throw new AvanzelError(`Avanzel saves only into plain folders, and ${folder} isn't one: a link or a file is on its path. Remove it, then try again.`);
  }
  for (let counter = 1; ; counter++) {
    const candidate = join(root, folder, counter === 1 ? `${stem}${suffix}` : `${stem}-${counter}${suffix}`);
    try {
      closeSync(openSync(candidate, "wx"));
      return candidate;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
  }
}

function tryLock(lockDir: string, owner: string): boolean {
  try {
    mkdirSync(lockDir);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    const stale = staleOwner(lockDir);
    if (stale === null) return false;
    discard(lockDir, stale);
    try {
      mkdirSync(lockDir);
    } catch (retry) {
      if (errorCode(retry) === "EEXIST") return false;
      throw retry;
    }
  }
  try {
    writeFileSync(join(lockDir, "owner"), owner);
    // Keep the lock out of git even in libraries whose .gitignore predates it.
    writeFileSync(join(lockDir, ".gitignore"), "*\n");
  } catch (error) {
    rmSync(lockDir, { recursive: true, force: true });
    throw error;
  }
  return true;
}

/** The owner file of a lock nobody holds any more, or null while the lock is (or may be) held. */
function staleOwner(lockDir: string): string | null {
  const owner = ownerOf(lockDir);
  const [pid = 0, boot, start] = owner.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(pid) || pid <= 0) {
    try {
      return Date.now() - statSync(lockDir).mtimeMs > OWNERLESS_LOCK_GRACE_MS ? owner : null;
    } catch {
      return null; // released meanwhile
    }
  }
  if (boot !== undefined && Number.isFinite(boot) && Math.abs(boot - BOOT_SECONDS) > SAME_BOOT_SECONDS) return owner;
  if (!isAlive(pid)) return owner;
  return start !== undefined && Number.isFinite(start) && isReused(owner, pid, start) ? owner : null;
}

/**
 * Remove the lock whose owner file reads `owner` (a stale lock, or our own), unless it is someone
 * else's by now: then it stays.
 */
function discard(lockDir: string, owner: string): void {
  const grave = `${lockDir}.stale-${randomUUID()}`;
  try {
    renameSync(lockDir, grave);
  } catch {
    return; // someone else got there first
  }
  if (ownerOf(grave) !== owner) {
    try {
      renameSync(grave, lockDir); // someone else's lock, not the one meant: put it back
      return;
    } catch {
      // its place is taken already
    }
  }
  rmSync(grave, { recursive: true, force: true });
}

/**
 * Remove this process's lock, `owner`, unless someone took it over meanwhile. Only a missing owner
 * file means the lock is gone. One that can't be read for another reason is read again a few times,
 * so a passing error doesn't leave the lock behind for every later run to wait on; should it stay
 * unreadable, whose the lock is can't be told, and it stays (a waiter takes it over as owner-less).
 */
async function release(lockDir: string, owner: string): Promise<void> {
  for (let tries = 1; tries <= RELEASE_TRIES; tries++) {
    const current = readOwner(lockDir);
    if (current !== null) {
      if (current === owner) discard(lockDir, owner); // which checks again, once the lock is moved aside
      return;
    }
    if (tries < RELEASE_TRIES) await sleep(RELEASE_RETRY_MS);
  }
}

/** A lock folder's owner file: "" when it has none (not written yet, abandoned before it was, or gone), null when it can't be read now. */
function readOwner(lockDir: string): string | null {
  try {
    return readFileSync(join(lockDir, "owner"), "utf8");
  } catch (error) {
    return errorCode(error) === "ENOENT" ? "" : null;
  }
}

/** A lock folder's owner file, or "" when it has none or can't be read. */
function ownerOf(lockDir: string): string {
  return readOwner(lockDir) ?? "";
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM"; // alive, but someone else's
  }
}

/**
 * Whether the live process `pid` started more than a minute away from `startSeconds`, the start its
 * owner line records: then the owner is gone and a later process got its pid. `ps` is asked once per
 * owner line; when it fails, prints something else or takes over five seconds (it runs on the app's
 * main thread, which it must not freeze), the pid counts as the owner's.
 */
function isReused(owner: string, pid: number, startSeconds: number): boolean {
  let reused = reusedPids.get(owner);
  if (reused === undefined) {
    const env = { ...process.env, LC_ALL: "C" };
    const ps = spawnSync("ps", ["-o", "etime=", "-p", String(pid)], { encoding: "utf8", env, timeout: 5_000 });
    const elapsed = ps.status === 0 ? parseElapsed(ps.stdout.trim()) : null;
    reused = elapsed !== null && Math.abs(Date.now() / 1000 - elapsed - startSeconds) > SAME_START_SECONDS;
    reusedPids.set(owner, reused);
  }
  return reused;
}

/** `ps`'s elapsed time, `[[dd-]hh:]mm:ss`, in seconds; null for anything else. */
export function parseElapsed(text: string): number | null {
  const match = /^(?:(?:(\d+)-)?(\d{2}):)?(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const [days = 0, hours = 0, minutes = 0, seconds = 0] = match.slice(1).map((part) => Number(part ?? 0));
  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
