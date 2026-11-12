// The models Avanzel hosts on this Mac (Settings → Agents → Use a private model → a model on this Mac): which are downloaded, a
// download under way, and the server that runs one while a run needs it. The engine does the work (`hosted-model.ts` there); this
// keeps the state Settings shows and the one server per model.
import { readFileSync } from "node:fs";
import { totalmem } from "node:os";
import {
  DownloadError,
  downloadHosted,
  HOSTED_MODELS,
  hostedDownloadSize,
  hostedMemoryProblem,
  type HostedModel,
  type HostedOptions,
  type HostedProvider,
  hostedReady,
  HostedServer,
  type HostedStatus,
  removeHosted,
} from "@avanzel/engine";
import type { HostedModelInfo } from "../shared/ipc.ts";

/** What the e2e tests change so nothing real is downloaded or run: only read when AVANZEL_TEST is 1, from the file AVANZEL_HOSTED_STUB names. */
interface Stub extends HostedOptions {
  model?: Partial<HostedModel>;
  modelsUrl?: string;
  idleMs?: number;
}

function stubFrom(env: NodeJS.ProcessEnv): Stub {
  if (env.AVANZEL_TEST !== "1" || !env.AVANZEL_HOSTED_STUB) return {};
  try {
    return JSON.parse(readFileSync(env.AVANZEL_HOSTED_STUB, "utf8")) as Stub;
  } catch {
    return {};
  }
}

export class HostedModels {
  readonly #dir: string;
  readonly #changed: () => void;
  readonly #env: NodeJS.ProcessEnv;
  readonly #memory: () => number;
  readonly #status = new Map<string, HostedStatus>();
  readonly #aborts = new Map<string, AbortController>();
  readonly #servers = new Map<string, HostedServer>();

  /**
   * `dir` is where the server, the models and the running server's files go; `changed` is called when what Settings shows has
   * (a download's progress, its end). `memory` is the Mac's memory in bytes, a function so a test can say a small one.
   */
  constructor(dir: string, changed: () => void, env: NodeJS.ProcessEnv = process.env, memory: () => number = totalmem) {
    this.#dir = dir;
    this.#changed = changed;
    this.#env = env;
    this.#memory = memory;
  }

  /** The model `id`, with any change the e2e tests ask for. */
  #model(id: string): HostedModel | null {
    const model = HOSTED_MODELS.find((entry) => entry.id === id);
    return model ? { ...model, ...stubFrom(this.#env).model } : null;
  }

  #options(): HostedOptions {
    const { binary, engine } = stubFrom(this.#env);
    return { binary, engine };
  }

  /** What Settings shows of each model: whether it is here, how far its download is, and why this Mac can't run it, if it can't. */
  info(): HostedModelInfo[] {
    return HOSTED_MODELS.map((entry) => {
      const model = this.#model(entry.id)!;
      return {
        id: model.id,
        label: model.label,
        licence: model.licence,
        memoryBytes: model.memory,
        problem: hostedMemoryProblem(model, this.#memory()),
        state: this.#state(model),
      };
    });
  }

  #state(model: HostedModel): HostedStatus {
    const kept = this.#status.get(model.id);
    if (kept?.kind === "downloading" || kept?.kind === "error") return kept;
    if (hostedReady(this.#dir, model, this.#options())) return { kind: "ready" };
    return { kind: "missing", bytes: hostedDownloadSize(this.#dir, model, this.#options()) };
  }

  /** Whether model `id` is downloaded and whole. */
  ready(id: string): boolean {
    const model = this.#model(id);
    return model !== null && hostedReady(this.#dir, model, this.#options());
  }

  /** What a run asks for the server of model `id`, or null for a model this app doesn't know. */
  provider(id: string): HostedProvider | null {
    const model = this.#model(id);
    if (!model) return null;
    return {
      acquire: () => {
        let server = this.#servers.get(id);
        if (!server) {
          const stub = stubFrom(this.#env);
          server = new HostedServer(this.#dir, model, { ...this.#options(), idleMs: stub.idleMs });
          this.#servers.set(id, server);
        }
        return server.acquire();
      },
    };
  }

  /** Starts downloading model `id`, unless it is here or a download is under way. It returns at once. */
  download(id: string): void {
    const model = this.#model(id);
    if (!model || this.#status.get(id)?.kind === "downloading" || hostedReady(this.#dir, model, this.#options())) return;
    const abort = new AbortController();
    this.#aborts.set(id, abort);
    const total = hostedDownloadSize(this.#dir, model, this.#options());
    this.#status.set(id, { kind: "downloading", receivedBytes: 0, totalBytes: total });
    this.#changed();
    let last = 0;
    void downloadHosted(this.#dir, model, {
      ...this.#options(),
      modelsUrl: stubFrom(this.#env).modelsUrl || this.#env.AVANZEL_MODELS_URL || undefined,
      signal: abort.signal,
      onProgress: (receivedBytes, totalBytes) => {
        this.#status.set(id, { kind: "downloading", receivedBytes, totalBytes });
        if (Date.now() - last > 250) {
          last = Date.now();
          this.#changed();
        }
      },
    })
      .then(() => this.#status.delete(id))
      .catch((error) => {
        if (abort.signal.aborted) return void this.#status.delete(id); // cancelled: back to not downloaded
        const message = error instanceof Error ? error.message : String(error);
        this.#status.set(id, { kind: "error", message, resumable: error instanceof DownloadError && error.resumable });
      })
      .finally(() => {
        this.#aborts.delete(id);
        this.#changed();
      });
  }

  /** Stops a download under way; the part that arrived is deleted. */
  cancel(id: string): void {
    this.#aborts.get(id)?.abort();
  }

  /** Deletes model `id` and the server, after stopping the server if it is running. */
  async remove(id: string): Promise<void> {
    const model = this.#model(id);
    if (!model) return;
    await this.#servers.get(id)?.stop();
    this.#servers.delete(id);
    this.#status.delete(id);
    removeHosted(this.#dir, model);
    this.#changed();
  }

  /** Stops every server now (Avanzel is quitting): the signal is sent before this returns, whether or not the caller waits. */
  stopAll(): Promise<void> {
    for (const abort of this.#aborts.values()) abort.abort();
    return Promise.all([...this.#servers.values()].map((server) => server.stop())).then(() => undefined);
  }
}
