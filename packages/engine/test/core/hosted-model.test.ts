import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadHosted,
  HOSTED_MODELS,
  hostedDownloadSize,
  hostedMemoryProblem,
  type HostedEngine,
  type HostedModel,
  hostedPaths,
  hostedReady,
  HostedServer,
  removeHosted,
} from "../../src/core/hosted-model.ts";
import { QWEN35_TEMPLATE } from "../../src/core/hosted-templates.ts";
import { defaultSettings } from "../../src/core/config.ts";
import { runHeadless } from "../../src/core/harness.ts";
import { privateHarnesses, HOSTED_HARNESSES } from "../../src/core/private-model.ts";
import { builtin, settingsWith } from "./harness-fixtures.ts";
import { binScripts, useTmp } from "./helpers.ts";

const tmp = useTmp();

/** A stand-in for llama-server: it reads the same flags, answers /health, and wants the key on everything else. */
const STUB = `#!${process.execPath}
const fs = require("node:fs");
const http = require("node:http");
const args = process.argv.slice(2);
const get = (flag) => args[args.indexOf(flag) + 1];
const model = fs.readFileSync(get("-m"), "utf8");
if (model.startsWith("CRASH")) { console.error("error loading model: bad file"); process.exit(3); }
const key = fs.readFileSync(get("--api-key-file"), "utf8");
fs.writeFileSync(get("--api-key-file") + ".args", JSON.stringify(args));
http.createServer((req, res) => {
  if (req.url === "/health") return res.end("ok");
  if (req.headers.authorization !== "Bearer " + key) { res.statusCode = 401; return res.end("no"); }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ models: [get("--alias")] }));
}).listen(Number(get("--port")), "127.0.0.1");
`;

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

function model(content: string, over: Partial<HostedModel> = {}): HostedModel {
  return {
    id: "tiny",
    label: "Tiny",
    licence: "MIT",
    file: { repo: "test/tiny", revision: "abc123", name: "tiny.gguf", size: Buffer.byteLength(content), sha256: sha(content) },
    memory: 4_000_000_000,
    contextWindow: 8_192,
    ...over,
  };
}

/** A folder for the app's hosted files with the stub server in it, as if downloaded. */
function installed(content = "weights"): { dir: string; tiny: HostedModel; binary: string } {
  const dir = join(tmp(), `hosted-${Math.random().toString(36).slice(2)}`);
  const tiny = model(content);
  const binary = join(dir, "llama-server");
  mkdirSync(join(dir, "models", tiny.id), { recursive: true });
  writeFileSync(binary, STUB);
  chmodSync(binary, 0o755);
  writeFileSync(join(dir, "models", tiny.id, tiny.file.name), content);
  return { dir, tiny, binary };
}

const servers: HostedServer[] = [];
const http: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  for (const server of http.splice(0)) await new Promise((resolve) => server.close(resolve));
});

function hosting(dir: string, tiny: HostedModel, binary: string, extra: { idleMs?: number; startMs?: number } = {}): HostedServer {
  const server = new HostedServer(dir, tiny, { binary, ...extra });
  servers.push(server);
  return server;
}

describe("the hosted model's catalog", () => {
  it("lists Qwen3.5-4B with its pinned file, and holds the patched template that lets a second system message through", () => {
    const qwen = HOSTED_MODELS.find((entry) => entry.id === "qwen3.5-4b")!;
    expect(qwen.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(qwen.file.size).toBeGreaterThan(2_000_000_000);
    expect(qwen.licence).toBe("Apache 2.0");
    expect(qwen.chatTemplate).toBe(QWEN35_TEMPLATE);
    expect(QWEN35_TEMPLATE).not.toContain("System message must be at the beginning");
    expect(QWEN35_TEMPLATE).toContain("<|im_start|>system");
  });

  it("works with every agent that takes a private model, since the server speaks all three kinds", () => {
    expect([...HOSTED_HARNESSES].sort()).toEqual([...privateHarnesses("chat"), ...privateHarnesses("messages"), ...privateHarnesses("responses")].sort());
  });
});

describe("what is on this Mac", () => {
  it("counts the bytes a download would fetch, and says ready when the server and the model are whole", () => {
    const { dir, tiny, binary } = installed();
    expect(hostedReady(dir, tiny, { binary })).toBe(true);
    expect(hostedDownloadSize(dir, tiny, { binary })).toBe(0);
    const empty = join(tmp(), "empty");
    const engine: HostedEngine = { tag: "t1", url: "http://x/e.tgz", size: 1000, sha256: "0".repeat(64) };
    expect(hostedReady(empty, tiny, { engine })).toBe(false);
    expect(hostedDownloadSize(empty, tiny, { engine })).toBe(1000 + tiny.file.size);
  });

  it("is not ready with a model file of the wrong size", () => {
    const { dir, tiny, binary } = installed();
    writeFileSync(hostedPaths(dir, tiny, { binary }).file, "short");
    expect(hostedReady(dir, tiny, { binary })).toBe(false);
  });

  it("warns, in plain words, when the Mac has too little memory, and says nothing when it has enough", () => {
    const tiny = model("x");
    expect(hostedMemoryProblem(tiny, 6_000_000_000)).toBe("This Mac has 6 GB of memory and Tiny needs about 4 GB free while it runs. Use your own server instead.");
    expect(hostedMemoryProblem(tiny, 8_000_000_000)).toBeNull();
    expect(hostedMemoryProblem(HOSTED_MODELS[0]!, 8 * 2 ** 30)).toBeNull(); // an 8 GB Mac runs Qwen3.5-4B
  });
});

/** Serves a tarball holding the stub server, and a model file, the way GitHub and Hugging Face would. */
async function origin(content: string, tarball: Buffer): Promise<{ base: string }> {
  const server = createServer((req, res) => {
    if (req.url === "/engine.tgz") return void res.end(tarball);
    if (req.url === "/test/tiny/resolve/abc123/tiny.gguf") return void res.end(content);
    res.statusCode = 404;
    res.end();
  });
  http.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function tarballOf(stub: string): Buffer {
  const src = join(tmp(), `tar-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(src, "llama-t1"), { recursive: true });
  writeFileSync(join(src, "llama-t1", "llama-server"), stub, { mode: 0o755 });
  const file = join(src, "engine.tgz");
  execFileSync("/usr/bin/tar", ["-czf", file, "-C", src, "llama-t1"]);
  return readFileSync(file);
}

describe("downloadHosted", () => {
  it("fetches the server and the model, unpacks the server, reports progress up to the total, and fetches nothing the second time", async () => {
    const content = "pretend weights ".repeat(50);
    const tiny = model(content);
    const tar = tarballOf(STUB);
    const { base } = await origin(content, tar);
    const engine: HostedEngine = { tag: "t1", url: `${base}/engine.tgz`, size: tar.length, sha256: sha(tar) };
    const dir = join(tmp(), "dl");
    const seen: [number, number][] = [];
    const paths = await downloadHosted(dir, tiny, { engine, modelsUrl: base, onProgress: (done, total) => seen.push([done, total]) });
    expect(readFileSync(paths.file, "utf8")).toBe(content);
    expect(existsSync(paths.binary)).toBe(true);
    expect(hostedReady(dir, tiny, { engine })).toBe(true);
    expect(seen.at(-1)).toEqual([tar.length + content.length, tar.length + content.length]);
    expect(seen.every(([done, total]) => done <= total && total === tar.length + content.length)).toBe(true);
    expect(seen.map(([done]) => done)).toEqual([...seen.map(([done]) => done)].sort((a, b) => a - b));
    const again: [number, number][] = [];
    await downloadHosted(dir, tiny, { engine, modelsUrl: base, onProgress: (done, total) => again.push([done, total]) });
    expect(again).toEqual([[0, 0], [0, 0]]);
  });

  it("refuses a server tarball that isn't the pinned one, and leaves nothing that looks installed", async () => {
    const content = "weights";
    const tar = tarballOf(STUB);
    const { base } = await origin(content, tar);
    const engine: HostedEngine = { tag: "t1", url: `${base}/engine.tgz`, size: tar.length, sha256: "f".repeat(64) };
    const dir = join(tmp(), "bad");
    await expect(downloadHosted(dir, model(content), { engine, modelsUrl: base })).rejects.toThrow(/Could not download the model server: what arrived was damaged/);
    expect(existsSync(join(dir, "engine", "t1"))).toBe(false);
    expect(hostedReady(dir, model(content), { engine })).toBe(false);
  });

  it("removeHosted takes the model and the server away", async () => {
    const { dir, tiny, binary } = installed();
    removeHosted(dir, tiny);
    expect(hostedReady(dir, tiny, { binary })).toBe(false);
    expect(existsSync(join(dir, "models", tiny.id))).toBe(false);
  });
});

describe("HostedServer", () => {
  it("starts the server on 127.0.0.1 with a key of its own and the flags that keep it private, and wants that key", async () => {
    const { dir, tiny, binary } = installed();
    const server = hosting(dir, { ...tiny, chatTemplate: "{{ patched }}" }, binary);
    const endpoint = await server.acquire();
    expect(server.running).toBe(true);
    expect(endpoint.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    expect(endpoint.model).toBe("tiny");
    expect(endpoint.contextWindow).toBe(8_192);
    expect(endpoint.key).toMatch(/^avz-[A-Za-z0-9_-]{32}$/);
    const root = endpoint.baseUrl.replace(/\/v1$/, "");
    expect((await fetch(`${root}/v1/models`)).status).toBe(401);
    expect((await fetch(`${root}/v1/models`, { headers: { authorization: `Bearer ${endpoint.key}` } })).status).toBe(200);
    const keyFile = join(dir, "run", "server.key");
    const args = JSON.parse(readFileSync(`${keyFile}.args`, "utf8")) as string[];
    expect(args).toEqual(expect.arrayContaining(["--host", "127.0.0.1", "--api-key-file", keyFile, "--reasoning", "off", "--no-webui", "-c", "8192"]));
    expect(args).not.toContain(endpoint.key); // the key is in a file, not in the process list
    expect(readFileSync(args[args.indexOf("--chat-template-file") + 1]!, "utf8")).toBe("{{ patched }}");
    endpoint.release();
  });

  it("shares one server between runs that overlap, and gives the key out only to those that asked", async () => {
    const { dir, tiny, binary } = installed();
    const server = hosting(dir, tiny, binary);
    const [one, two] = await Promise.all([server.acquire(), server.acquire()]);
    expect(two.baseUrl).toBe(one.baseUrl);
    expect(two.key).toBe(one.key);
    one.release();
    two.release();
  });

  it("stops after the idle time once every run has let it go, and a later run starts it again with a new key", async () => {
    const { dir, tiny, binary } = installed();
    const server = hosting(dir, tiny, binary, { idleMs: 80 });
    const first = await server.acquire();
    const second = await server.acquire();
    first.release();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(server.running).toBe(true); // the second run still holds it
    second.release();
    await vi.waitFor(() => expect(server.running).toBe(false), { timeout: 3000 });
    const again = await server.acquire();
    expect(again.key).not.toBe(first.key);
    again.release();
  });

  it("says why the server stopped when it can't load the model", async () => {
    const { dir, tiny, binary } = installed("CRASH weights");
    const server = hosting(dir, tiny, binary);
    await expect(server.acquire()).rejects.toThrow(/The model server stopped \(code 3\)\. It said: error loading model: bad file/);
    expect(server.running).toBe(false);
  });

  it("says to download the model first when it isn't on this Mac", async () => {
    const { dir, tiny, binary } = installed();
    const server = hosting(dir, { ...tiny, file: { ...tiny.file, size: tiny.file.size + 1 } }, binary);
    await expect(server.acquire()).rejects.toThrow("Tiny isn't downloaded yet. Download it in Settings → Agents.");
  });

  it("stop() ends the server and waits for it", async () => {
    const { dir, tiny, binary } = installed();
    const server = hosting(dir, tiny, binary);
    const endpoint = await server.acquire();
    await server.stop();
    expect(server.running).toBe(false);
    await expect(fetch(`${endpoint.baseUrl}/models`)).rejects.toThrow();
  });
});

describe("a run on the hosted model", () => {
  const printing = 'echo "base=$ANTHROPIC_BASE_URL"; echo "token=$ANTHROPIC_AUTH_TOKEN"; echo "model=$ANTHROPIC_DEFAULT_SONNET_MODEL"';

  it("starts the server, hands its address, model and key to the agent, and lets the server go when the run ends", async () => {
    const { dir, tiny, binary } = installed();
    const server = hosting(dir, tiny, binary, { idleMs: 60_000 });
    let released = 0;
    const provider = {
      acquire: async () => {
        const endpoint = await server.acquire();
        return { ...endpoint, release: () => { released += 1; endpoint.release(); } };
      },
    };
    vi.stubEnv("PATH", binScripts(tmp(), { claude: printing }));
    const settings = { ...defaultSettings().private, enabled: true, source: "hosted" as const };
    const result = await runHeadless(builtin("claude"), "file it", tmp(), { write: false, timeoutSeconds: 30, private: settings, hosted: provider });
    const lines = Object.fromEntries(result.output.split("\n").map((line) => line.split(/=(.*)/s).slice(0, 2) as [string, string]));
    expect(lines.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/); // Claude Code adds /v1/messages itself
    expect(lines.token).toMatch(/^avz-/);
    expect(lines.model).toBe("tiny");
    expect(released).toBe(1);
    expect(server.running).toBe(true); // kept for the next run until its idle time is up
  });

  it("says so, before any agent starts, when no hosted server is available or the agent can't take a private model", async () => {
    vi.stubEnv("PATH", binScripts(tmp(), { claude: "echo ran", gemini: "echo ran" }));
    const settings = { ...defaultSettings().private, enabled: true, source: "hosted" as const };
    await expect(runHeadless(builtin("claude"), "x", tmp(), { write: false, timeoutSeconds: 30, private: settings })).rejects.toThrow(
      "Private model: the hosted model isn't available here.",
    );
    await expect(runHeadless(builtin("gemini"), "x", tmp(), { write: false, timeoutSeconds: 30, private: settings })).rejects.toThrow(
      "Private model: gemini can't run against a private model.",
    );
  });

  it("lets Automatic pick pi first and then the others for a hosted model", async () => {
    const { selectHarness } = await import("../../src/core/harness.ts");
    vi.stubEnv("PATH", binScripts(tmp(), { codex: "exit 0", claude: "exit 0" }));
    const settings = settingsWith({ private: { ...defaultSettings().private, enabled: true, source: "hosted" } });
    expect(selectHarness(settings).name).toBe("claude"); // pi and OpenCode aren't installed: the next that is
  });
});
