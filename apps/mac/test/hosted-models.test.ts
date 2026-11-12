import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultSettings, HOSTED_HARNESSES } from "@avanzel/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { patchedSettings } from "../src/main/dictionary-settings.ts";
import { HostedModels } from "../src/main/hosted.ts";
import { privateInfo } from "../src/main/library-info.ts";
import { HOSTED_AGENTS, type HostedModelInfo } from "../src/shared/ipc.ts";

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const root = () => mkdtempSync(path.join(tmpdir(), "avz-hosted-"));

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/** Serves a server tarball and a model file as GitHub and Hugging Face would, and gives the stub file the models read. */
async function stub(over: { weights?: string; hold?: boolean } = {}): Promise<{ env: NodeJS.ProcessEnv; weights: string; release: () => void }> {
  const weights = over.weights ?? "pretend weights ".repeat(40);
  const src = root();
  mkdirSync(path.join(src, "llama-t1"), { recursive: true });
  writeFileSync(path.join(src, "llama-t1", "llama-server"), "#!/bin/sh\n", { mode: 0o755 });
  execFileSync("/usr/bin/tar", ["-czf", path.join(src, "e.tgz"), "-C", src, "llama-t1"]);
  const tar = (await import("node:fs")).readFileSync(path.join(src, "e.tgz"));
  let release = () => {};
  const gate = over.hold ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve();
  const server: Server = createServer((req, res) => {
    if (req.url === "/e.tgz") return void res.end(tar);
    if (req.url?.endsWith("/tiny.gguf")) {
      res.write(weights.slice(0, 10));
      void gate.then(() => res.end(weights.slice(10)));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise((resolve) => (release(), server.closeAllConnections(), server.close(() => resolve()))));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const file = path.join(root(), "stub.json");
  writeFileSync(
    file,
    JSON.stringify({
      modelsUrl: base,
      engine: { tag: "t1", url: `${base}/e.tgz`, size: tar.length, sha256: sha(tar) },
      model: { file: { repo: "test/tiny", revision: "abc", name: "tiny.gguf", size: Buffer.byteLength(weights), sha256: sha(weights) } },
    }),
  );
  return { env: { AVANZEL_TEST: "1", AVANZEL_HOSTED_STUB: file }, weights, release };
}

const qwen = (models: HostedModels): HostedModelInfo => models.info().find((entry) => entry.id === "qwen3.5-4b")!;

describe("the shared agent list for the hosted model", () => {
  it("is the engine's, so Settings offers the agents the engine runs", () => {
    expect([...HOSTED_AGENTS]).toEqual([...HOSTED_HARNESSES]);
  });
});

describe("HostedModels", () => {
  it("lists Qwen3.5-4B as not downloaded, with the bytes a download fetches and its licence", () => {
    const models = new HostedModels(root(), () => {}, { AVANZEL_TEST: "0" }, () => 16e9);
    const info = qwen(models);
    expect(info).toMatchObject({ label: "Qwen3.5-4B", licence: "Apache 2.0", problem: null });
    expect(info.state.kind).toBe("missing");
    expect(info.state.kind === "missing" && info.state.bytes).toBeGreaterThan(2_700_000_000);
    expect(models.ready("qwen3.5-4b")).toBe(false);
    expect(models.provider("nope")).toBeNull();
  });

  it("says why a Mac with too little memory can't run it", () => {
    const small = new HostedModels(root(), () => {}, {}, () => 4e9);
    expect(qwen(small).problem).toMatch(/^This Mac has 4 GB of memory and Qwen3\.5-4B needs about 5 GB free/);
  });

  it("downloads the server and the model with progress, ends ready, and removes both again", async () => {
    const { env, weights } = await stub();
    const changed = vi.fn();
    const models = new HostedModels(root(), changed, env, () => 16e9);
    expect(qwen(models).state.kind).toBe("missing");
    models.download("qwen3.5-4b");
    expect(qwen(models).state.kind).toBe("downloading");
    await vi.waitFor(() => expect(qwen(models).state.kind).toBe("ready"), { timeout: 5000 });
    expect(models.ready("qwen3.5-4b")).toBe(true);
    expect(changed).toHaveBeenCalled();
    expect(weights.length).toBeGreaterThan(0);
    await models.remove("qwen3.5-4b");
    expect(qwen(models).state.kind).toBe("missing");
  });

  it("shows a download's progress while it runs, and a cancel puts it back to not downloaded", async () => {
    const { env } = await stub({ hold: true });
    const models = new HostedModels(root(), () => {}, env, () => 16e9);
    models.download("qwen3.5-4b");
    await vi.waitFor(() => {
      const state = qwen(models).state;
      expect(state.kind === "downloading" && state.receivedBytes > 0).toBe(true);
    }, { timeout: 5000 });
    models.download("qwen3.5-4b"); // a second press starts nothing more
    models.cancel("qwen3.5-4b");
    await vi.waitFor(() => expect(qwen(models).state.kind).toBe("missing"), { timeout: 5000 });
  });

  it("reports a download that failed in the words of the failure, and tries again from the same place", async () => {
    const { env } = await stub({ weights: "x".repeat(400) });
    const bad = JSON.parse((await import("node:fs")).readFileSync(env.AVANZEL_HOSTED_STUB!, "utf8"));
    bad.model.file.sha256 = "0".repeat(64); // what arrives won't be the pinned file
    writeFileSync(env.AVANZEL_HOSTED_STUB!, JSON.stringify(bad));
    const models = new HostedModels(root(), () => {}, env, () => 16e9);
    models.download("qwen3.5-4b");
    await vi.waitFor(() => expect(qwen(models).state.kind).toBe("error"), { timeout: 5000 });
    const state = qwen(models).state;
    expect(state.kind === "error" && state.message).toMatch(/Could not download tiny\.gguf: what arrived was damaged/);
  });
});

describe("what Settings says is wrong with a private model on this Mac", () => {
  const on = patchedSettings(defaultSettings(), { private: { enabled: true, source: "hosted" } });
  const info = (state: HostedModelInfo["state"], problem: string | null = null): HostedModelInfo[] => [
    { id: "qwen3.5-4b", label: "Qwen3.5-4B", licence: "Apache 2.0", memoryBytes: 5e9, problem, state },
  ];

  it("says nothing when the model is downloaded and the agent can run it", () => {
    expect(privateInfo(on, "pi", info({ kind: "ready" })).privateProblem).toBeNull();
    expect(privateInfo(on, "claude", info({ kind: "ready" })).privateProblem).toBeNull();
  });

  it("says to download it first, in plain words", () => {
    expect(privateInfo(on, "pi", info({ kind: "missing", bytes: 1 })).privateProblem).toBe("Qwen3.5-4B isn't downloaded yet.");
    expect(privateInfo(on, "pi", info({ kind: "downloading", receivedBytes: 1, totalBytes: 2 })).privateProblem).toBe("Qwen3.5-4B isn't downloaded yet.");
  });

  it("names an agent that can't run it, and a Mac that has too little memory", () => {
    expect(privateInfo(on, "gemini", info({ kind: "ready" })).privateProblem).toBe("This agent can't run a model on this Mac. Use pi, OpenCode, Claude Code or Codex.");
    expect(privateInfo(on, "pi", info({ kind: "ready" }, "This Mac has 4 GB of memory.")).privateProblem).toBe("This Mac has 4 GB of memory.");
  });
});
