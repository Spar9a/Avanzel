// A model Avanzel hosts itself: the person picks it, Avanzel downloads the model and a small inference server (llama.cpp's
// llama-server), starts the server on this Mac when a run needs it, and stops it after a while with nothing to do. The server
// listens on 127.0.0.1 only, with a key made fresh at every start and kept in a file only this person can read. Nothing here
// reaches a model provider: the server is the "private model" a run is pointed at (see private-model.ts).
//
// Everything downloaded is pinned: the server's tarball and the model file have the size and SHA-256 recorded below, and a
// download that stops continues from what arrived (`fetchFile`).

import { type ChildProcess, execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { downloadModelsFiles, fetchFile, type ModelSpec } from "../voice/models.ts";
import { AvanzelError } from "../types.ts";
import { QWEN35_TEMPLATE } from "./hosted-templates.ts";

const run = promisify(execFile);

export interface HostedModel {
  /** The name the server serves it under, and the one kept in settings. */
  id: string;
  /** What a person reads. */
  label: string;
  licence: string;
  /** The file the server loads, pinned to a Hugging Face commit. */
  file: { repo: string; revision: string; name: string; size: number; sha256: string };
  /** How much memory the model needs while the server runs, with its context, in bytes. A guess to warn a small Mac with. */
  memory: number;
  /** The context the server is started with, which the agent is told. */
  contextWindow: number;
  /** A chat template to load in place of the one inside the model file, when that one refuses what agents send. */
  chatTemplate?: string;
}

export const HOSTED_MODELS: readonly HostedModel[] = [
  {
    id: "qwen3.5-4b",
    label: "Qwen3.5-4B",
    licence: "Apache 2.0",
    file: {
      repo: "unsloth/Qwen3.5-4B-GGUF",
      revision: "e87f176479d0855a907a41277aca2f8ee7a09523",
      name: "Qwen3.5-4B-Q4_K_M.gguf",
      size: 2_740_937_888,
      sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
    },
    memory: 5_000_000_000,
    contextWindow: 65_536,
    chatTemplate: QWEN35_TEMPLATE,
  },
];

export function hostedModel(id: string): HostedModel | null {
  return HOSTED_MODELS.find((model) => model.id === id) ?? null;
}

/** The inference server as a tarball: it unpacks to `llama-<tag>/llama-server` with its libraries beside it. */
export interface HostedEngine {
  tag: string;
  url: string;
  size: number;
  sha256: string;
}

/** The inference server, as llama.cpp publishes it for Apple silicon, pinned to one build. */
export const LLAMA_SERVER: HostedEngine = {
  tag: "b12318",
  url: "https://github.com/ggml-org/llama.cpp/releases/download/b12318/llama-b12318-bin-macos-arm64.tar.gz",
  size: 16_896_103,
  sha256: "c8de54b88616af7f76911608905ab4fd2e2343aefcdf997b4823f73ea7341f53",
};

/** What the person sees of the hosted model on this Mac. */
export type HostedStatus =
  | { kind: "missing"; bytes: number }
  | { kind: "downloading"; receivedBytes: number; totalBytes: number }
  | { kind: "ready" }
  | { kind: "error"; message: string; resumable: boolean };

export interface HostedPaths {
  /** The server's binary, where the tarball unpacks. */
  binary: string;
  /** The model file. */
  file: string;
  /** Where the server's log, key and process id go. */
  run: string;
}

export interface HostedOptions {
  /** A server binary to use as it is, whatever is downloaded (tests, `AVANZEL_LLAMA_SERVER`). */
  binary?: string;
  /** The server's tarball, when not the pinned one (tests serve their own). */
  engine?: HostedEngine;
}

export function hostedPaths(dir: string, model: HostedModel, options: HostedOptions = {}): HostedPaths {
  const engine = options.engine ?? LLAMA_SERVER;
  return {
    binary: options.binary || join(dir, "engine", engine.tag, `llama-${engine.tag}`, "llama-server"),
    file: join(dir, "models", model.id, model.file.name),
    run: join(dir, "run"),
  };
}

function sizeOf(path: string): number | null {
  try {
    const stats = statSync(path);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

/** Whether the server and the model are both on this Mac, whole. */
export function hostedReady(dir: string, model: HostedModel, options: HostedOptions = {}): boolean {
  const paths = hostedPaths(dir, model, options);
  return existsSync(paths.binary) && sizeOf(paths.file) === model.file.size;
}

/** The bytes a download would fetch now: what is missing, by its pinned size. */
export function hostedDownloadSize(dir: string, model: HostedModel, options: HostedOptions = {}): number {
  const paths = hostedPaths(dir, model, options);
  return (existsSync(paths.binary) ? 0 : (options.engine ?? LLAMA_SERVER).size) + (sizeOf(paths.file) === model.file.size ? 0 : model.file.size);
}

export interface HostedDownloadOptions extends HostedOptions {
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
  /** Where the model comes from; defaults to https://huggingface.co. Tests point it at a local server. */
  modelsUrl?: string;
}

/**
 * Makes the server and the model whole on this Mac, fetching what is missing, and returns the paths. The server is unpacked
 * from its tarball into a folder of its own that is renamed into place only when the unpacking worked, so a stop halfway
 * leaves nothing that looks complete.
 */
export async function downloadHosted(dir: string, model: HostedModel, options: HostedDownloadOptions = {}): Promise<HostedPaths> {
  const { onProgress, signal, modelsUrl, engine: pinned = LLAMA_SERVER } = options;
  const paths = hostedPaths(dir, model, options);
  const total = hostedDownloadSize(dir, model, options);
  let done = 0;
  const report = (extra: number) => onProgress?.(done + extra, total);
  report(0);

  if (!existsSync(paths.binary)) {
    const engine = join(dir, "engine");
    const tarball = join(engine, `${pinned.tag}.tar.gz`);
    const unpacked = join(engine, `${pinned.tag}.unpacking`);
    mkdirSync(engine, { recursive: true });
    await fetchFile({ name: "the model server", size: pinned.size, sha256: pinned.sha256 }, pinned.url, tarball, signal, (received) =>
      report(received),
    );
    rmSync(unpacked, { recursive: true, force: true });
    mkdirSync(unpacked, { recursive: true });
    try {
      await run("/usr/bin/tar", ["-xzf", tarball, "-C", unpacked]);
      if (!existsSync(join(unpacked, `llama-${pinned.tag}`, "llama-server"))) throw new Error("the server isn't in its download");
      rmSync(join(engine, pinned.tag), { recursive: true, force: true });
      renameSync(unpacked, join(engine, pinned.tag));
    } catch (error) {
      rmSync(unpacked, { recursive: true, force: true });
      throw new AvanzelError(`Could not unpack the model server: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      rmSync(tarball, { force: true });
    }
    done += pinned.size;
  }

  if (sizeOf(paths.file) !== model.file.size) {
    const spec: ModelSpec = {
      repo: model.file.repo,
      revision: model.file.revision,
      files: { "": [model.file.name] },
      digests: { [model.file.name]: { size: model.file.size, sha256: model.file.sha256 } },
    };
    await downloadModelsFiles([{ model: spec, dir: join(dir, "models", model.id) }], {
      quantization: "",
      baseUrl: modelsUrl,
      signal,
      onProgress: (progress) => report(progress.overallReceived),
    });
  }
  onProgress?.(total, total);
  return paths;
}

/** Deletes the downloaded model and server. A running server must be stopped first (`HostedServer.stop`). */
export function removeHosted(dir: string, model: HostedModel): void {
  rmSync(join(dir, "models", model.id), { recursive: true, force: true });
  rmSync(join(dir, "engine"), { recursive: true, force: true });
}

/** Whether this Mac has the memory for the model, by the total it has: a Mac with less would swap and crawl. */
export function hostedMemoryProblem(model: HostedModel, totalMemory: number): string | null {
  if (totalMemory >= model.memory * 1.6) return null;
  const gb = (bytes: number) => `${Math.round(bytes / 1e9)} GB`;
  return `This Mac has ${gb(totalMemory)} of memory and ${model.label} needs about ${gb(model.memory)} free while it runs. Use your own server instead.`;
}

/** Where a started server can be reached. */
export interface HostedEndpoint {
  /** http://127.0.0.1:<port>/v1 */
  baseUrl: string;
  /** What the run sends as the model's name. */
  model: string;
  /** The key the server wants, fresh at each start. */
  key: string;
  contextWindow: number;
  /** Lets the server go: when every holder has released it, the idle timer starts. */
  release: () => void;
}

/** What a run asks for the hosted model's server: `HostedServer` is one. */
export interface HostedProvider {
  acquire(): Promise<HostedEndpoint>;
}

export interface HostedServerOptions extends HostedOptions {
  /** How long a server nobody holds keeps running. */
  idleMs?: number;
  /** How long a server may take to load the model. */
  startMs?: number;
}

const DEFAULT_IDLE_MS = 10 * 60_000;
const DEFAULT_START_MS = 180_000;

/** A free port on 127.0.0.1: the system hands one out, and it is given back for the server to use. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The last lines of the server's log, for a failure to say why. */
function logTail(file: string): string {
  try {
    const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-4).join(" ").slice(0, 400);
  } catch {
    return "";
  }
}

/**
 * The hosted model's server: started when a run asks for it (`acquire`), shared by the runs that overlap, and stopped when
 * the last of them has released it and the idle time is up, or by `stop` (the app quitting). One server runs at a time.
 */
export class HostedServer {
  readonly #dir: string;
  readonly #model: HostedModel;
  readonly #options: HostedServerOptions;
  #child: ChildProcess | null = null;
  #endpoint: Omit<HostedEndpoint, "release"> | null = null;
  #starting: Promise<Omit<HostedEndpoint, "release">> | null = null;
  #holders = 0;
  #idle: NodeJS.Timeout | null = null;

  constructor(dir: string, model: HostedModel, options: HostedServerOptions = {}) {
    this.#dir = dir;
    this.#model = model;
    this.#options = options;
  }

  /** Whether a server is running now. */
  get running(): boolean {
    return this.#endpoint !== null;
  }

  /** Starts the server if it isn't running and holds it for the caller until `release` is called. */
  async acquire(): Promise<HostedEndpoint> {
    this.#holders += 1;
    this.#cancelIdle();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.#holders -= 1;
      if (this.#holders === 0) this.#armIdle();
    };
    try {
      const endpoint = this.#endpoint ?? (await (this.#starting ??= this.#start()));
      return { ...endpoint, release };
    } catch (error) {
      release();
      throw error;
    }
  }

  /** Stops the server now, whoever holds it, and waits until it has exited. */
  async stop(): Promise<void> {
    this.#cancelIdle();
    const child = this.#child;
    this.#endpoint = null;
    this.#starting = null;
    this.#child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
      child.once("exit", () => {
        clearTimeout(force);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  #cancelIdle(): void {
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = null;
  }

  #armIdle(): void {
    this.#cancelIdle();
    this.#idle = setTimeout(() => void this.stop(), this.#options.idleMs ?? DEFAULT_IDLE_MS);
    this.#idle.unref();
  }

  async #start(): Promise<Omit<HostedEndpoint, "release">> {
    const paths = hostedPaths(this.#dir, this.#model, this.#options);
    if (!hostedReady(this.#dir, this.#model, this.#options)) {
      this.#starting = null;
      throw new AvanzelError(`${this.#model.label} isn't downloaded yet. Download it in Settings → Agents.`);
    }
    mkdirSync(paths.run, { recursive: true, mode: 0o700 });
    this.#stopStale(paths);
    const port = await freePort();
    const key = `avz-${randomBytes(24).toString("base64url")}`;
    const keyFile = join(paths.run, "server.key");
    writeFileSync(keyFile, key, { mode: 0o600 });
    const logFile = join(paths.run, "server.log");
    writeFileSync(logFile, "");
    const templateFile = join(paths.run, "chat-template.jinja");
    if (this.#model.chatTemplate) writeFileSync(templateFile, this.#model.chatTemplate);
    const log = openSync(logFile, "a");
    const child = spawn(
      paths.binary,
      [
        "-m", paths.file,
        "--alias", this.#model.id,
        "--host", "127.0.0.1",
        "--port", String(port),
        "--api-key-file", keyFile,
        "-c", String(this.#model.contextWindow),
        "--reasoning", "off",
        "--no-webui",
        "-np", "1",
        ...(this.#model.chatTemplate ? ["--chat-template-file", templateFile] : []),
      ],
      { stdio: ["ignore", log, log], env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } },
    );
    closeSync(log); // the child holds its own copy
    this.#child = child;
    if (child.pid) writeFileSync(join(paths.run, "server.pid"), String(child.pid));
    let exited: string | null = null;
    child.once("exit", (code, signal) => {
      exited = signal ? `signal ${signal}` : `code ${code}`;
      if (this.#child === child) {
        this.#child = null;
        this.#endpoint = null;
        this.#starting = null;
      }
    });
    child.once("error", (error) => {
      exited = error.message;
    });

    const deadline = Date.now() + (this.#options.startMs ?? DEFAULT_START_MS);
    try {
      while (Date.now() < deadline) {
        if (exited !== null) {
          const why = logTail(logFile);
          throw new AvanzelError(`The model server stopped (${exited}).${why ? ` It said: ${why}` : ""}`);
        }
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`);
          if (response.ok) {
            this.#endpoint = { baseUrl: `http://127.0.0.1:${port}/v1`, model: this.#model.id, key, contextWindow: this.#model.contextWindow };
            this.#starting = null;
            return this.#endpoint;
          }
        } catch {
          // not listening yet
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new AvanzelError("The model server didn't start in time. It may need more memory than this Mac has free.");
    } catch (error) {
      this.#starting = null;
      await this.stop();
      throw error;
    }
  }

  /** A server an earlier run of Avanzel left behind (it was killed, say) would hold the model's memory: it is stopped. */
  #stopStale(paths: HostedPaths): void {
    try {
      const pid = Number(readFileSync(join(paths.run, "server.pid"), "utf8"));
      if (!Number.isInteger(pid) || pid <= 1 || !alive(pid)) return;
      // The number may have been given to another process since: only a llama-server is stopped.
      const name = execFileSync("/bin/ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" }).trim();
      if (name.endsWith("llama-server")) process.kill(pid, "SIGTERM");
    } catch {
      // no pid file, or it names nothing alive
    }
  }
}
