// The MCP server the owner's other agents use: four tools that read the library and one that leaves a note in the inbox.
// Every call first asks the Settings switch, so turning access off takes effect at once, even mid-session. Answers go
// out on stdout and nothing else may: the protocol owns it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { tagCounts } from "../core/pages.ts";
import { searchLibrary } from "../core/search.ts";
import { loadTasks } from "../core/tasks.ts";
import { Vault } from "../core/vault.ts";
import { REMEMBER_RULES, serverInstructions, WRITING_RULES } from "./instructions.ts";
import { libraryShelves, remember, unfiledAgentNotes } from "./notes.ts";
import { bound, fenced, readableKind } from "./reach.ts";

/** What the server needs from whoever runs it. Each is asked on every call, so a change in Settings counts at once. */
export interface AgentAccess {
  /** The library, or null when none is chosen. */
  root(): string | null;
  /** The Settings switch "Let your other agents use this library". */
  enabled(): boolean;
  /** Whether this server was started by one of Avanzel's own runs (a filing or Ask run), which may read but not remember. */
  fromAvanzel(): boolean;
  now?(): Date;
}

/** What every tool answers while the switch is off. */
export const AGENT_ACCESS_OFF = "Avanzel's library is closed to other agents. The owner can open it in Avanzel → Settings → Agents.";
const NO_LIBRARY = "Avanzel has no library open. The owner can choose one in Avanzel → Settings → Library.";
const OWN_RUN = "Avanzel's own librarian can't leave notes for itself.";

const INDEX_CHARS = 8_000;
const TOP_TAGS = 100;
const RECENT_DEFAULT = 20;
const RECENT_MAX = 100;
const PATH_SHOWN = 200;

interface Answer {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const say = (text: string): Answer => ({ content: [{ type: "text", text }] });
const fail = (text: string): Answer => ({ content: [{ type: "text", text }], isError: true });

/** Asks the caller, treating a question that throws as `fallback`. */
function ask(question: () => boolean, fallback: boolean): boolean {
  try {
    return question();
  } catch {
    return fallback;
  }
}

/** The library's folder when the switch is on and a library is open there; otherwise the answer to give instead. */
function openLibrary(access: AgentAccess): string | Answer {
  if (!ask(() => access.enabled(), false)) return say(AGENT_ACCESS_OFF);
  let root: string | null = null;
  try {
    root = access.root();
  } catch {
    // No library to be had is no library open.
  }
  if (root === null || !new Vault(root).exists()) return fail(NO_LIBRARY);
  return root;
}

/** Runs `work` on the open library; a failure the tools didn't foresee comes back as a plain error, not a crash. */
function withLibrary(access: AgentAccess, work: (root: string) => Answer): Answer {
  const root = openLibrary(access);
  if (typeof root !== "string") return root;
  try {
    return work(root);
  } catch (error) {
    return fail(`Avanzel couldn't finish that: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function eveningReviewOn(vault: Vault): boolean {
  try {
    return loadTasks(vault).some((task) => task.kind === "evening-review" && task.enabled);
  } catch {
    return false;
  }
}

/** The instructions for this connection: the library as it is now, or only the writing rules when it can't be shown. */
function instructionsFor(access: AgentAccess): string {
  const root = openLibrary(access);
  if (typeof root !== "string") return `${root.content[0]?.text ?? ""} ${WRITING_RULES}`;
  try {
    const vault = new Vault(root);
    return serverInstructions({
      shelves: libraryShelves(root),
      pages: Object.values(vault.shelfCounts()).reduce((sum, n) => sum + n, 0),
      waiting: unfiledAgentNotes(vault),
      eveningReviewOn: eveningReviewOn(vault),
    });
  } catch {
    return WRITING_RULES;
  }
}

/** A library file read only through the outside agents' gate; empty when it isn't there or isn't theirs to read. */
function libraryFile(root: string, rel: "index.md" | "log.md"): string {
  return readableKind(root, rel) === "library" ? readFileSync(join(root, rel), "utf8") : "";
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

/** One MCP server for one connection, with instructions built from the library as it is now. */
export function createAgentServer(access: AgentAccess, version: string): McpServer {
  const server = new McpServer({ name: "avanzel", version }, { instructions: instructionsFor(access) });

  server.registerTool(
    "search",
    {
      title: "Search the library",
      description:
        "Keyword search of the library's pages (ignores case, ё = е). Returns total, offset and hits: path, title, shelf, tags, the matching line and its log entry.",
      inputSchema: {
        query: z.string().describe("Words to look for"),
        limit: z.number().optional().describe("Hits per answer, default 10, at most 50"),
        offset: z.number().optional().describe("Hits to skip, to get the next part"),
        tag: z.string().optional().describe("Only pages with this tag or one below it"),
        shelf: z.string().optional().describe("Only this shelf"),
        include_captures: z.boolean().optional().describe("Also notes in inbox/ and raw/, after the pages"),
      },
      annotations: READ_ONLY,
    },
    ({ query, limit, offset, tag, shelf, include_captures }) =>
      withLibrary(access, (root) => {
        const found = searchLibrary(root, query, { limit, offset, tag, shelf, includeCaptures: include_captures });
        // A capture's words are someone's, not instructions: its title, matching line and log bullet come fenced. Keys go out in
        // snake_case, as every tool's do.
        const hits = found.hits.map(({ log, ...hit }) => {
          const entry = log && { date: log.date, text: log.text, capture_id: log.captureId };
          if (hit.capture === null) return { ...hit, log: entry };
          return {
            ...hit,
            title: hit.title === null ? null : fenced(hit.title),
            line: fenced(hit.line),
            log: entry && { ...entry, text: fenced(entry.text) },
          };
        });
        return say(JSON.stringify({ ...found, hits }));
      }),
  );

  server.registerTool(
    "read_page",
    {
      title: "Read a page",
      description:
        "Read a page or note by its path from search, front matter included. section gives one heading's part; from and count pick lines (with section, from counts from its first line). A cut answer says the from to go on with.",
      inputSchema: {
        path: z.string().describe("Path in the library, such as goals/run.md"),
        section: z.string().optional().describe("A heading's text"),
        from: z.number().optional().describe("First line, from 1"),
        count: z.number().optional().describe("How many lines"),
        max_chars: z.number().optional().describe("Most characters, default 16000"),
      },
      annotations: READ_ONLY,
    },
    ({ path, section, from, count, max_chars }) =>
      withLibrary(access, (root) => {
        const kind = readableKind(root, path);
        if (kind === null) return fail(`No page at ${path.slice(0, PATH_SHOWN)}. Use search to find it.`);
        const part = bound(readFileSync(join(root, path), "utf8"), { section, from, count, maxChars: max_chars, capture: kind === "capture" });
        if ("error" in part) return fail(part.error);
        const text = kind === "capture" ? fenced(part.text) : part.text;
        if (part.continueFrom === null) return say(text);
        const where = [`path: ${JSON.stringify(path)}`, ...(section === undefined ? [] : [`section: ${JSON.stringify(section)}`])];
        return say(`${text}\n\n(Cut here. To read on, call read_page with ${where.join(", ")}, from: ${part.continueFrom}.)`);
      }),
  );

  server.registerTool(
    "library_overview",
    {
      title: "Library overview",
      description: "The shelves with page counts, the tags most used first, and the start of index.md. Read it before you search or remember.",
      annotations: READ_ONLY,
    },
    () =>
      withLibrary(access, (root) => {
        const tags = tagCounts(root);
        const text = libraryFile(root, "index.md");
        let index = text;
        if (text.length > INDEX_CHARS) {
          const head = text.slice(0, INDEX_CHARS);
          index = head.slice(0, head.lastIndexOf("\n") + 1) || head.replace(/[\ud800-\udbff]$/, "");
        }
        return say(
          JSON.stringify({
            shelves: new Vault(root).shelfCounts(),
            tags: tags.slice(0, TOP_TAGS),
            more_tags: Math.max(0, tags.length - TOP_TAGS),
            index,
            ...(index === text ? {} : { index_cut: true }),
          }),
        );
      }),
  );

  server.registerTool(
    "recent_changes",
    {
      title: "Recent changes",
      description: "The latest lines of the library's log: what the librarian filed and changed, oldest first.",
      inputSchema: { limit: z.number().optional().describe("Lines, default 20, at most 100") },
      annotations: READ_ONLY,
    },
    ({ limit }) =>
      withLibrary(access, (root) => {
        const wanted = Math.min(RECENT_MAX, Math.max(1, Math.trunc(limit ?? RECENT_DEFAULT) || RECENT_DEFAULT));
        const lines = libraryFile(root, "log.md")
          .split("\n")
          .map((line) => line.replace(/\r$/, ""))
          .filter((line) => line.startsWith("- "));
        return say(lines.length > 0 ? lines.slice(-wanted).join("\n") : "The log has no entries yet.");
      }),
  );

  server.registerTool(
    "remember",
    {
      title: "Remember",
      description: `Leave a note in the inbox; the librarian files it later. ${REMEMBER_RULES}`,
      inputSchema: {
        text: z.string().describe("What to remember, in your words, up to 10,000 characters"),
        tags: z.array(z.string()).optional().describe("Up to 12: lowercase letters, digits, - and /"),
        title: z.string().optional().describe("Suggested title"),
        shelf: z.string().optional().describe("Suggested shelf"),
        related: z.array(z.string()).optional().describe("Up to 12 names of pages it relates to"),
        supersedes: z.string().optional().describe("Name of a page whose fact this changes"),
        context: z.record(z.string(), z.string()).optional().describe("Where it came from: project, repo, url"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (input) =>
      withLibrary(access, (root) => {
        if (ask(() => access.fromAvanzel(), true) || process.env.AVANZEL_AGENT_RUN === "1") return fail(OWN_RUN);
        const vault = new Vault(root);
        const result = remember(vault, input, server.server.getClientVersion()?.name ?? "an agent", {
          now: access.now?.(),
          shelves: libraryShelves(root),
          eveningReviewOn: eveningReviewOn(vault),
        });
        if (!result.ok) return fail(result.error);
        return say(
          JSON.stringify({
            id: result.id,
            new_tags: result.newTags,
            similar: result.similar,
            when: result.when,
            ...(result.stripped ? { removed: "Invisible characters and HTML comments were removed from the note." } : {}),
          }),
        );
      }),
  );

  return server;
}

/**
 * Serve one agent over stdin and stdout until stdin closes (Avanzel's `--mcp` mode, or `npm run mcp`). Only protocol
 * messages are written to stdout. `io` is for tests.
 */
export async function serveStdio(
  access: AgentAccess,
  version: string,
  io: { stdin: Readable; stdout: Writable } = { stdin: process.stdin, stdout: process.stdout },
): Promise<void> {
  const server = createAgentServer(access, version);
  const ignore = (): void => {};
  io.stdout.on("error", ignore); // a client that went away closes stdin too; that ends the session below
  const ended = new Promise<void>((resolve) => {
    io.stdin.once("end", resolve);
    io.stdin.once("close", resolve);
  });
  await server.connect(new StdioServerTransport(io.stdin, io.stdout));
  await ended;
  await new Promise((resolve) => setImmediate(resolve)); // the answers to the last requests go out first
  await server.close();
  await new Promise<void>((resolve) => io.stdout.write("", () => resolve()));
  io.stdout.off("error", ignore);
}
