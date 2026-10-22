import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ClaudeStream, type ToolStep } from "../../src/core/claude-stream.ts";

// A Claude Code 2.1.296 filing run, trimmed: one JSON event per line. It reads index.md, searches, writes a page, and is
// refused an Edit of a file under raw/.
const FILING = readFileSync(new URL("../fixtures/claude-filing.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean);

/** A stream that has been fed `lines`, with the steps it handed over. */
function feed(lines: readonly string[], onStep?: (step: ToolStep) => void): { stream: ClaudeStream; steps: ToolStep[] } {
  const steps: ToolStep[] = [];
  const stream = new ClaudeStream((step) => {
    steps.push(step);
    onStep?.(step);
  });
  for (const line of lines) stream.line(line);
  return { stream, steps };
}

const toolUse = (id: string, name: string, input: unknown): string =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });

const resultEvent = (fields: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done", ...fields });

const toolResult = (id: string, isError = false): string =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "done", ...(isError ? { is_error: true } : {}) }] },
  });

describe("ClaudeStream", () => {
  it("turns Claude Code's tool calls into steps", () => {
    const { steps } = feed(FILING);
    // The refused Edit of raw/ is not among them.
    expect(steps).toEqual([{ kind: "read", path: "/lib/index.md" }, { kind: "search" }, { kind: "wrote", path: "/lib/ideas/podcast.md" }]);
  });

  it("takes the reply from the result event", () => {
    const { stream } = feed(FILING);
    expect(stream.reply).toBe("Filed into [[podcast]].");
    expect(stream.failed).toBe(false);
  });

  it("lists the writes Claude Code refused", () => {
    const { stream } = feed(FILING);
    expect(stream.refused).toEqual(["/lib/raw/2026/10/x.md"]);
  });

  it("keeps lines that aren't JSON as the reply when no result came", () => {
    const { stream, steps } = feed(["Not logged in · Please run /login"]);
    expect(stream.reply).toBe("Not logged in · Please run /login");
    expect(stream.failed).toBe(false);
    expect(stream.refused).toEqual([]);
    expect(steps).toEqual([]);
  });

  it("keeps every line that isn't a JSON object, JSON or not, in order", () => {
    const { stream } = feed(["first", "42", '{"type":"system","subtype":"init"}', "[1]", "null", "", "last"]);
    expect(stream.reply).toBe("first\n42\n[1]\nnull\n\nlast");
  });

  it("prefers the result's text to lines that weren't JSON", () => {
    const { stream } = feed(["a warning on stdout", ...FILING]);
    expect(stream.reply).toBe("Filed into [[podcast]].");
  });

  it("says a run failed when its result does", () => {
    const { stream } = feed([resultEvent({ is_error: true, result: "Credit balance is too low" })]);
    expect(stream.failed).toBe(true);
    expect(stream.reply).toBe("Credit balance is too low");
  });

  it("a failed result without text gives its errors as the reply", () => {
    // The error subtypes (error_during_execution, error_max_turns, …) carry errors[] and no result.
    const { stream } = feed([
      '{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["Claude AI usage limit reached"]}',
    ]);
    expect(stream.failed).toBe(true);
    expect(stream.reply).toBe("Claude AI usage limit reached");
  });

  it("takes the result's text, else its errors one to a line, else the lines that weren't JSON", () => {
    const errors = ["first", "second"];
    const replyOf = (...lines: string[]) => feed(lines).stream.reply;
    expect(replyOf("a line", resultEvent({ result: "text", errors }))).toBe("text");
    expect(replyOf("a line", resultEvent({ result: undefined, errors }))).toBe("first\nsecond");
    expect(replyOf("a line", resultEvent({ result: undefined, errors: [] }))).toBe("a line");
    expect(replyOf("a line", resultEvent({ result: undefined }))).toBe("a line");
  });

  it("hands over a search at once, and a read or a write once its result arrives", () => {
    const { stream, steps } = feed([
      toolUse("r", "Read", { file_path: "/lib/a.md" }),
      toolUse("g", "Glob", { pattern: "*.md" }),
      toolUse("w", "Write", { file_path: "/lib/b.md", content: "b" }),
      toolUse("e", "Edit", { file_path: "/lib/c.md", old_string: "c", new_string: "d" }),
      toolUse("n", "NotebookEdit", { notebook_path: "/lib/d.ipynb", new_source: "d" }),
    ]);
    expect(steps).toEqual([{ kind: "search" }]);
    for (const id of ["r", "w", "e", "n"]) stream.line(toolResult(id));
    expect(steps.slice(1)).toEqual([
      { kind: "read", path: "/lib/a.md" },
      { kind: "wrote", path: "/lib/b.md" },
      { kind: "wrote", path: "/lib/c.md" },
      { kind: "wrote", path: "/lib/d.ipynb" },
    ]);
  });

  it("a read Claude Code couldn't do is not a step", () => {
    // A page that isn't there yet is an ordinary thing to read in a new library, and Claude Code answers it with an error.
    const { steps } = feed([
      toolUse("r", "Read", { file_path: "/lib/people/mark.md" }),
      toolResult("r", true),
      toolUse("s", "Read", { file_path: "/lib/people/ana.md" }), // never answered: the run ends first
      resultEvent(),
    ]);
    expect(steps).toEqual([]);
  });

  it("makes no step of a write whose result is an error, or never comes", () => {
    const { steps } = feed([
      toolUse("w", "Write", { file_path: "/lib/b.md", content: "b" }),
      toolResult("w", true),
      toolUse("e", "Edit", { file_path: "/lib/c.md", old_string: "c", new_string: "d" }),
      resultEvent(),
    ]);
    expect(steps).toEqual([]);
  });

  it("names a refused notebook edit by its notebook_path", () => {
    const denials = [
      { tool_name: "NotebookEdit", tool_use_id: "n", tool_input: { notebook_path: "/lib/raw/n.ipynb" } },
      { tool_name: "Write", tool_use_id: "w", tool_input: { file_path: "/lib/raw/w.md" } },
    ];
    const { stream } = feed([resultEvent({ permission_denials: denials })]);
    expect(stream.refused).toEqual(["/lib/raw/n.ipynb", "/lib/raw/w.md"]);
  });

  it("ignores everything else it sees", () => {
    const { stream, steps } = feed([
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Let me look." }] } }),
      JSON.stringify({ type: "stream_event", event: { type: "content_block_delta" } }),
      toolUse("b", "Bash", { command: "ls" }),
      toolUse("t", "TodoWrite", { todos: [] }),
      JSON.stringify({ type: "system", subtype: "hook_started", hook_name: "PreToolUse:Write" }),
      JSON.stringify({ type: "unheard-of", whatever: true }),
    ]);
    expect(steps).toEqual([]);
    expect(stream.reply).toBe("");
  });

  it("shrugs off events shaped in ways it doesn't know, and goes on", () => {
    const odd = [
      '{"type":"assistant"}',
      '{"type":"assistant","message":null}',
      '{"type":"assistant","message":{"content":"text"}}',
      '{"type":"assistant","message":{"content":[null,3,"x",{"type":"tool_use"},{"type":"tool_use","name":"Read","input":null}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":5,"name":"Write","input":{"file_path":7}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result"},{"type":"tool_result","tool_use_id":{}}]}}',
      '{"type":"result"}',
      '{"type":"result","result":5,"is_error":"yes","permission_denials":"none"}',
      '{"type":"result","permission_denials":[null,7,{"tool_input":null},{"tool_input":{"file_path":3}}]}',
    ];
    const { stream, steps } = feed(odd);
    expect(steps).toEqual([]);
    expect(stream.reply).toBe("");
    expect(stream.failed).toBe(false);
    expect(stream.refused).toEqual([]);
    for (const line of FILING) stream.line(line);
    expect(steps).toHaveLength(3);
    expect(stream.reply).toBe("Filed into [[podcast]].");
  });

  it("a step listener that throws doesn't stop the stream", () => {
    const { stream, steps } = feed(FILING, () => {
      throw new Error("the listener is broken");
    });
    expect(steps).toEqual([{ kind: "read", path: "/lib/index.md" }, { kind: "search" }, { kind: "wrote", path: "/lib/ideas/podcast.md" }]);
    expect(stream.reply).toBe("Filed into [[podcast]].");
    expect(stream.refused).toEqual(["/lib/raw/2026/10/x.md"]);
  });
});
