// What `claude -p --output-format stream-json --verbose` prints: one JSON event per line, as the run goes. Reading the
// lines as they arrive hands over each tool call while it happens, and the run's reply is the result event's text, so a
// caller sees the same plain reply that `--output-format text` printed whole.

/** One thing a Claude Code run did, with the path as the agent gave it (absolute). */
export type ToolStep = { kind: "read"; path: string } | { kind: "search" } | { kind: "wrote"; path: string };

type Json = Record<string, unknown>;

/** What the result event, the last line of a run, said. */
interface Result {
  reply: string;
  failed: boolean;
  refused: string[];
}

/** Reads `claude -p --output-format stream-json --verbose` one stdout line at a time. */
export class ClaudeStream {
  readonly #onStep: (step: ToolStep) => void;
  // A write or an edit is a step once its tool_result comes back without an error, not when it is asked for: the
  // write guard may refuse it. They wait here by tool_use id, with the path they were asked to write.
  readonly #writing = new Map<string, string>();
  // The lines that weren't JSON objects. A run that never got as far as a result has nothing else to say.
  readonly #plain: string[] = [];
  #result: Result | null = null;

  constructor(onStep: (step: ToolStep) => void) {
    this.#onStep = onStep;
  }

  /** Reads one line of stdout, without its line end. */
  line(text: string): void {
    const event = parseObject(text);
    if (!event) {
      this.#plain.push(text);
      return;
    }
    // Everything else is ignored: thinking and text, rate_limit_event, system/* (hook events too) and stream_event.
    switch (event.type) {
      case "assistant":
        for (const block of blocks(event)) if (block.type === "tool_use") this.#toolUse(block);
        break;
      case "user":
        for (const block of blocks(event)) if (block.type === "tool_result") this.#toolResult(block);
        break;
      case "result":
        this.#result = {
          reply: typeof event.result === "string" ? event.result : "",
          failed: event.is_error === true,
          refused: refusedPaths(event.permission_denials),
        };
        break;
    }
  }

  /** The result event's `result`; with no result event, the lines that weren't JSON, joined with "\n". */
  get reply(): string {
    return this.#result ? this.#result.reply : this.#plain.join("\n");
  }

  /** The result event's `is_error`. */
  get failed(): boolean {
    return this.#result?.failed ?? false;
  }

  /** `permission_denials[].tool_input.file_path` (or `notebook_path`), as given. */
  get refused(): string[] {
    return this.#result ? [...this.#result.refused] : [];
  }

  #toolUse(block: Json): void {
    const input: Json = isObject(block.input) ? block.input : {};
    switch (block.name) {
      case "Read":
        if (typeof input.file_path === "string" && input.file_path) this.#step({ kind: "read", path: input.file_path });
        break;
      case "Glob":
      case "Grep":
        this.#step({ kind: "search" });
        break;
      case "Write":
      case "Edit":
        this.#expectWrite(block.id, input.file_path);
        break;
      case "NotebookEdit":
        this.#expectWrite(block.id, input.notebook_path);
        break;
    }
  }

  #expectWrite(id: unknown, path: unknown): void {
    if (typeof id === "string" && typeof path === "string" && path) this.#writing.set(id, path);
  }

  #toolResult(block: Json): void {
    const id = block.tool_use_id;
    if (typeof id !== "string") return;
    const path = this.#writing.get(id);
    if (path === undefined) return;
    this.#writing.delete(id);
    if (!block.is_error) this.#step({ kind: "wrote", path });
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

function refusedPaths(denials: unknown): string[] {
  if (!Array.isArray(denials)) return [];
  return denials.flatMap((denial: unknown) => {
    const input = isObject(denial) ? denial.tool_input : undefined;
    const path = isObject(input) ? (input.file_path ?? input.notebook_path) : undefined;
    return typeof path === "string" && path ? [path] : [];
  });
}
