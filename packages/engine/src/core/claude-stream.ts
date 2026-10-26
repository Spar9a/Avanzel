// What `claude -p --output-format stream-json --verbose` prints: one JSON event per line, as the run goes. Reading the
// lines as they arrive hands over each step the agent takes while it takes it (a read or a write once Claude Code has
// done it, a search when it is made), and the run's reply is the result event's text, so a caller sees the same plain
// reply that `--output-format text` printed whole. The last rate_limit_event is kept too: it says whether the run hit
// its usage limit, and when the limit resets.

/** One thing a Claude Code run did, with the path as the agent gave it (absolute). */
export type ToolStep = { kind: "read"; path: string } | { kind: "search" } | { kind: "wrote"; path: string };

/**
 * What a rate_limit_event said: its `status` ("allowed", "rejected", …), and `resetsAt`, when the limit resets, in epoch
 * ms (Claude Code gives epoch seconds), or null when the event named no time.
 */
export interface RateLimit {
  status: string;
  resetsAt: number | null;
}

type Json = Record<string, unknown>;

/** How many of the lines that weren't JSON are kept: the last 200. A run that prints without end can't fill the memory. */
const PLAIN_LINES_KEPT = 200;

/** What the result event, the last line of a run, said. `reply` is null when it had neither a result nor errors. */
interface Result {
  reply: string | null;
  failed: boolean;
  refused: string[];
}

/** Reads `claude -p --output-format stream-json --verbose` one stdout line at a time. */
export class ClaudeStream {
  readonly #onStep: (step: ToolStep) => void;
  // A read, a write or an edit is a step once its tool_result comes back without an error, not when it is asked for: a
  // page that isn't there can't be read, and the write guard may refuse a write. They wait here by tool_use id, with the
  // step they will be. A search is a step when it is made, since it was made even when it found nothing.
  readonly #pending = new Map<string, ToolStep>();
  // The last PLAIN_LINES_KEPT lines that weren't JSON objects. A run that never got as far as a result has nothing else
  // to say, and what it said last is what tells why.
  readonly #plain: string[] = [];
  #result: Result | null = null;
  #rateLimit: RateLimit | null = null;

  constructor(onStep: (step: ToolStep) => void) {
    this.#onStep = onStep;
  }

  /** Reads one line of stdout, without its line end. */
  line(text: string): void {
    const event = parseObject(text);
    if (!event) {
      this.#plain.push(text);
      if (this.#plain.length > PLAIN_LINES_KEPT) this.#plain.shift();
      return;
    }
    // Everything else is ignored: thinking and text, system/* (hook events too) and stream_event.
    switch (event.type) {
      case "assistant":
        for (const block of blocks(event)) if (block.type === "tool_use") this.#toolUse(block);
        break;
      case "user":
        for (const block of blocks(event)) if (block.type === "tool_result") this.#toolResult(block);
        break;
      case "rate_limit_event":
        this.#rateLimit = rateLimitOf(event) ?? this.#rateLimit; // the last one that says a status counts
        break;
      case "result":
        this.#result = {
          reply: resultText(event),
          failed: event.is_error === true,
          refused: refusedPaths(event.permission_denials),
        };
        break;
    }
  }

  /**
   * The result event's `result`; else its `errors`, one to a line (a run that failed before it could reply has those
   * and no result); with neither, the last 200 lines that weren't JSON, joined with "\n".
   */
  get reply(): string {
    return this.#result?.reply ?? this.#plain.join("\n");
  }

  /** The result event's `is_error`. */
  get failed(): boolean {
    return this.#result?.failed ?? false;
  }

  /** `permission_denials[].tool_input.file_path` (or `notebook_path`) of each refused write, as given. */
  get refused(): string[] {
    return this.#result ? [...this.#result.refused] : [];
  }

  /** The last rate_limit_event that gave a status, even for a run that went well; null when there was none. */
  get rateLimit(): RateLimit | null {
    return this.#rateLimit ? { ...this.#rateLimit } : null;
  }

  #toolUse(block: Json): void {
    const input: Json = isObject(block.input) ? block.input : {};
    switch (block.name) {
      case "Read":
        this.#expect(block.id, "read", input.file_path);
        break;
      case "Glob":
      case "Grep":
        this.#step({ kind: "search" });
        break;
      case "Write":
      case "Edit":
        this.#expect(block.id, "wrote", input.file_path);
        break;
      case "NotebookEdit":
        this.#expect(block.id, "wrote", input.notebook_path);
        break;
    }
  }

  /** A call whose step waits for its result: a read or a write of `path`, asked for as tool_use `id`. */
  #expect(id: unknown, kind: "read" | "wrote", path: unknown): void {
    if (typeof id === "string" && typeof path === "string" && path) this.#pending.set(id, { kind, path });
  }

  #toolResult(block: Json): void {
    const id = block.tool_use_id;
    if (typeof id !== "string") return;
    const step = this.#pending.get(id);
    if (step === undefined) return;
    this.#pending.delete(id);
    if (!block.is_error) this.#step(step);
  }

  #step(step: ToolStep): void {
    try {
      this.#onStep(step);
    } catch {
      // Whoever listens is no concern of the run: its reply and its refusals still count.
    }
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The JSON object a line holds, or null for any other line, including JSON that isn't an object. */
function parseObject(text: string): Json | null {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null; // not JSON
  }
}

/** The content blocks of an assistant or user event's message. */
function blocks(event: Json): Json[] {
  const content = isObject(event.message) ? event.message.content : undefined;
  return Array.isArray(content) ? content.filter(isObject) : [];
}

/**
 * What a result event has to say: its `result`, or else its `errors` (the error_during_execution and error_max_turns
 * subtypes carry those and no result), one to a line. Null when it has neither.
 */
function resultText(event: Json): string | null {
  if (typeof event.result === "string") return event.result;
  const errors = Array.isArray(event.errors)
    ? event.errors.filter((error: unknown): error is string => typeof error === "string" && error !== "")
    : [];
  return errors.length ? errors.join("\n") : null;
}

/**
 * What a rate_limit_event says. Its `status` and `resetsAt` (epoch seconds) are under `rate_limit_info`, or on the event
 * itself; each is read from the first that has it. Null when the event gives no status. A `resetsAt` that is no time
 * (not a positive number) is none, so that nothing waits for a moment that isn't one.
 */
function rateLimitOf(event: Json): RateLimit | null {
  const info: Json = isObject(event.rate_limit_info) ? event.rate_limit_info : {};
  const status = [info.status, event.status].find((value): value is string => typeof value === "string" && value !== "");
  if (status === undefined) return null;
  const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
  const seconds = [info.resetsAt, event.resetsAt].find(isTime);
  return { status, resetsAt: seconds === undefined ? null : seconds * 1000 };
}

/** The tools that write: a denial of one of them is a refused write. */
const WRITE_TOOLS: readonly unknown[] = ["Write", "Edit", "NotebookEdit"];

/** The path of each write the result's `permission_denials` lists; a refused read or any other call isn't one. */
function refusedPaths(denials: unknown): string[] {
  if (!Array.isArray(denials)) return [];
  return denials.flatMap((denial: unknown) => {
    if (!isObject(denial) || !WRITE_TOOLS.includes(denial.tool_name)) return [];
    const input = denial.tool_input;
    const path = isObject(input) ? (input.file_path ?? input.notebook_path) : undefined;
    return typeof path === "string" && path ? [path] : [];
  });
}
