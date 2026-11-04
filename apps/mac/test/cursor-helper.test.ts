import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CursorHelper } from "../src/main/cursor-helper.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-cursor-"));
const realBinaryPath = CursorHelper.binaryPath;
const realClipboard = CursorHelper.fakeClipboardText;
const helpers: CursorHelper[] = [];

afterEach(async () => {
  delete process.env.AVANZEL_FAKE_CURSOR;
  CursorHelper.binaryPath = realBinaryPath;
  CursorHelper.fakeClipboardText = realClipboard;
  vi.useRealTimers();
  await Promise.all(helpers.splice(0).map((helper) => helper.stop()));
});

/**
 * A stand-in for avanzel-cursor: a node script that has `send(object)` to write a line to stdout and calls your `handle(command)` for
 * each line that arrives on stdin. `body` defines `handle`.
 */
function stub(body: string): void {
  const file = path.join(tmp(), "avanzel-cursor");
  writeFileSync(
    file,
    `#!${process.execPath}
const send = (object) => process.stdout.write(JSON.stringify(object) + "\\n");
const reply = (command, fields) => send({ id: command.id, ok: true, ...fields });
let handle = () => {};
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  try { handle(JSON.parse(line)); } catch {}
});
${body}
`,
  );
  chmodSync(file, 0o755);
  CursorHelper.binaryPath = () => file;
}

function make(): { helper: CursorHelper; taps: () => number; problems: string[]; tapped: Promise<void> } {
  let count = 0;
  const problems: string[] = [];
  let firstTap!: () => void;
  const tapped = new Promise<void>((resolve) => (firstTap = resolve));
  const helper = new CursorHelper({
    onTap: () => {
      count += 1;
      firstTap();
    },
    onProblem: (message) => problems.push(message),
  });
  helpers.push(helper);
  return { helper, taps: () => count, problems, tapped };
}

const front = (name: string | null) => ({
  app: { name, bundleId: name === null ? null : `com.example.${name}`, pid: 7 },
  window: { title: "Notes" },
  element: { role: "AXTextArea", secure: false, takesText: "yes" },
});

describe("CursorHelper with a stand-in binary", () => {
  it("is not available when the binary is missing", () => {
    CursorHelper.binaryPath = () => path.join(tmp(), "nope");
    expect(CursorHelper.available()).toBe(false);
  });

  it("is available when the binary exists on a Mac (the Mac running the tests is one)", () => {
    stub("");
    expect(CursorHelper.available()).toBe(process.platform === "darwin");
  });

  it("calls onTap once for a press and release, and asks the helper to watch the chosen key", async () => {
    const log = path.join(tmp(), "log.txt");
    stub(`
const fs = require("node:fs");
handle = (command) => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(command) + "\\n");
  if (command.cmd === "watch") {
    reply(command, {});
    send({ event: "modifier", key: command.key, down: true });
    send({ event: "modifier", key: command.key, down: false });
  } else {
    reply(command, { accessibility: true, inputMonitoring: true });
  }
};
send({ event: "ready", accessibility: true, inputMonitoring: true });`);
    const { helper, taps, problems, tapped } = make();
    helper.start("left-option");
    await tapped;
    // The helper writes in order, so once this is answered everything it said before has been heard.
    await helper.permissions(false);
    expect(taps()).toBe(1);
    expect(problems).toEqual([]);
    const commands = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(commands[0]).toMatchObject({ cmd: "watch", key: "left-option" });
  });

  it("does not count a key struck while the modifier is held", async () => {
    stub(`
handle = (command) => {
  reply(command, { accessibility: true, inputMonitoring: true });
  if (command.cmd === "watch") {
    send({ event: "modifier", key: command.key, down: true });
    send({ event: "key" });
    send({ event: "modifier", key: command.key, down: false });
  }
};`);
    const { helper, taps } = make();
    helper.start("right-option");
    await helper.permissions(false);
    expect(taps()).toBe(0);
  });

  it("answers inspect with the reply to its own request, ignoring lines that are not JSON", async () => {
    stub(`
handle = (command) => {
  process.stdout.write("this is not json\\n");
  reply(command, ${JSON.stringify(front("Notes"))});
};`);
    const { helper } = make();
    helper.start("right-option");
    await expect(helper.inspect()).resolves.toEqual({
      app: { name: "Notes", bundleId: "com.example.Notes", pid: 7 },
      window: { title: "Notes" },
      element: { role: "AXTextArea", secure: false, takesText: "yes" },
    });
  });

  it("keeps what the helper could not read as nulls, and gives an app with no name or bundle id empty strings", async () => {
    stub(`
handle = (command) => {
  if (command.cmd === "inspect") reply(command, { app: { name: null, bundleId: null, pid: 9 }, window: null, element: null });
  else reply(command, {});
};`);
    const { helper } = make();
    helper.start("right-option");
    await expect(helper.inspect()).resolves.toEqual({ app: { name: "", bundleId: "", pid: 9 }, window: null, element: null });
  });

  it("keeps an element with no role", async () => {
    stub(`
handle = (command) => {
  if (command.cmd === "inspect") reply(command, { app: { name: "A", bundleId: "a", pid: 1 }, window: null, element: { role: null, secure: false, takesText: "no" } });
  else reply(command, {});
};`);
    const { helper } = make();
    helper.start("right-option");
    const target = await helper.inspect();
    expect(target.element).toEqual({ role: null, secure: false, takesText: "no" });
  });

  it("gives each of two requests in flight its own reply, even when the replies come in the other order", async () => {
    stub(`
let held = null;
handle = (command) => {
  if (command.cmd !== "permissions") return reply(command, {});
  if (held === null) { held = command; return; }
  reply(command, { accessibility: command.prompt, inputMonitoring: false });
  reply(held, { accessibility: held.prompt, inputMonitoring: true });
};`);
    const { helper } = make();
    helper.start("right-option");
    const first = helper.permissions(false);
    const second = helper.permissions(true);
    await expect(second).resolves.toEqual({ accessibility: true, inputMonitoring: false });
    await expect(first).resolves.toEqual({ accessibility: false, inputMonitoring: true });
  });

  it("rejects a request the helper refuses with the helper's message", async () => {
    stub(`
handle = (command) => {
  if (command.cmd === "paste") send({ id: command.id, ok: false, message: "Accessibility is off for Avanzel." });
  else reply(command, {});
};`);
    const { helper } = make();
    helper.start("right-option");
    await expect(helper.paste()).rejects.toThrow("Accessibility is off for Avanzel.");
  });

  it("rejects inspect when no app is in front", async () => {
    stub(`
handle = (command) => {
  if (command.cmd === "inspect") send({ id: command.id, ok: false, message: "No app is in front." });
  else reply(command, {});
};`);
    const { helper } = make();
    helper.start("right-option");
    await expect(helper.inspect()).rejects.toThrow("No app is in front.");
  });

  it("resolves paste when the helper says it was sent", async () => {
    stub(`handle = (command) => reply(command, {});`);
    const { helper } = make();
    helper.start("right-option");
    await expect(helper.paste()).resolves.toBeUndefined();
  });

  it("reports a watch it cannot do as a problem, keeps running, and watches again on the next setKey", async () => {
    stub(`
let watches = 0;
handle = (command) => {
  if (command.cmd === "watch") {
    watches += 1;
    if (watches === 1) send({ id: command.id, ok: false, message: "Avanzel needs Input Monitoring to see your key." });
    else reply(command, {});
  } else {
    reply(command, { accessibility: true, inputMonitoring: watches > 1, watches });
  }
};`);
    const { helper, problems } = make();
    helper.start("right-option");
    await expect(helper.permissions(false)).resolves.toEqual({ accessibility: true, inputMonitoring: false });
    expect(problems).toEqual(["Avanzel needs Input Monitoring to see your key."]);
    helper.setKey("right-command");
    await expect(helper.permissions(false)).resolves.toEqual({ accessibility: true, inputMonitoring: true });
    expect(problems).toHaveLength(1);
  });

  it("sends the new key when setKey is called while running", async () => {
    const log = path.join(tmp(), "keys.txt");
    stub(`
const fs = require("node:fs");
handle = (command) => {
  if (command.cmd === "watch") fs.appendFileSync(${JSON.stringify(log)}, command.key + "\\n");
  reply(command, { accessibility: true, inputMonitoring: true });
};`);
    const { helper } = make();
    helper.start("right-option");
    helper.setKey("right-control");
    await helper.permissions(false);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["right-option", "right-control"]);
  });

  it("rejects a waiting request and calls onProblem when the helper exits", async () => {
    stub(`
handle = (command) => {
  if (command.cmd === "inspect") process.exit(3);
  else reply(command, {});
};`);
    const { helper, problems } = make();
    helper.start("right-option");
    await expect(helper.inspect()).rejects.toThrow(/stopped/i);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/stopped/i);
  });

  it("calls onProblem when the binary cannot start", async () => {
    CursorHelper.binaryPath = () => path.join(tmp(), "missing");
    const { helper, problems } = make();
    helper.start("right-option");
    await expect(helper.inspect()).rejects.toThrow();
    expect(problems.length).toBeGreaterThan(0);
  });

  it("rejects a request the helper never answers after three seconds", async () => {
    stub(`handle = () => {};`);
    const { helper } = make();
    helper.start("right-option");
    // Only the timers are faked; the child process and its pipes run for real.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const waiting = helper.inspect();
    const outcome = expect(waiting).rejects.toThrow(/didn't answer/i);
    await vi.advanceTimersByTimeAsync(3_000);
    await outcome;
  });

  it("ends the child on stop(), and says nothing about it", async () => {
    const pidFile = path.join(tmp(), "pid.txt");
    stub(`
require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
handle = (command) => reply(command, { accessibility: true, inputMonitoring: true });`);
    const { helper, problems } = make();
    helper.start("right-option");
    await helper.permissions(false);
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).not.toThrow();
    await helper.stop();
    expect(() => process.kill(pid, 0)).toThrow();
    expect(problems).toEqual([]);
    await expect(helper.inspect()).rejects.toThrow();
  });

  it("starts the helper for a request made before start()", async () => {
    stub(`handle = (command) => reply(command, { accessibility: false, inputMonitoring: true });`);
    const { helper, problems } = make();
    await expect(helper.permissions(false)).resolves.toEqual({ accessibility: false, inputMonitoring: true });
    expect(problems).toEqual([]);
  });

  it("starts the helper again for a request after it crashed, and answers it", async () => {
    const marker = path.join(tmp(), "crashed");
    const pidFile = path.join(tmp(), "pid.txt");
    stub(`
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(pidFile)}, process.pid + "\\n");
handle = (command) => {
  if (command.cmd === "inspect" && !fs.existsSync(${JSON.stringify(marker)})) {
    fs.writeFileSync(${JSON.stringify(marker)}, "x");
    process.exit(3);
  }
  reply(command, ${JSON.stringify(front("Notes"))});
};`);
    const { helper, problems } = make();
    helper.start("right-option");
    await expect(helper.inspect()).rejects.toThrow(/stopped/i);
    expect(problems).toHaveLength(1);
    expect((await helper.inspect()).app.name).toBe("Notes");
    expect(problems).toHaveLength(1);
    expect(new Set(readFileSync(pidFile, "utf8").trim().split("\n")).size).toBe(2);
  });

  it("gives a fresh helper to a start() right after stop(), with no problem reported for the one that ended", async () => {
    const pidFile = path.join(tmp(), "pid.txt");
    const log = path.join(tmp(), "log.txt");
    stub(`
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(pidFile)}, process.pid + "\\n");
handle = (command) => {
  fs.appendFileSync(${JSON.stringify(log)}, process.pid + " " + command.cmd + "\\n");
  reply(command, { accessibility: true, inputMonitoring: true });
};`);
    const { helper, problems } = make();
    helper.start("right-option");
    await helper.permissions(false);
    const stopped = helper.stop();
    helper.start("right-option");
    await stopped;
    await expect(helper.permissions(false)).resolves.toEqual({ accessibility: true, inputMonitoring: true });
    // Let the old helper's ending be heard if it was going to be.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(problems).toEqual([]);
    const pids = readFileSync(pidFile, "utf8").trim().split("\n");
    expect(new Set(pids).size).toBe(2);
    // The new helper was the one to watch and to answer; the old one got nothing after stop().
    const lines = readFileSync(log, "utf8").trim().split("\n");
    expect(lines.filter((line) => line.startsWith(`${pids[1]} `)).map((line) => line.split(" ")[1])).toEqual(["watch", "permissions"]);
  });

  it("fails each request, and calls onProblem once for each, when the helper exits every time it starts", async () => {
    stub(`process.exit(1);`);
    const { helper, problems } = make();
    for (const round of [1, 2, 3]) {
      await expect(helper.permissions(false)).rejects.toThrow(/stopped/i);
      expect(problems).toHaveLength(round);
    }
  });
});

describe("CursorHelper with the fake helper", () => {
  /** A binaryPath that counts how often something asks to run the real helper. */
  function realHelperWatch(): { spawns: () => number } {
    let spawns = 0;
    CursorHelper.binaryPath = () => {
      spawns += 1;
      return path.join(tmp(), "never-run");
    };
    return { spawns: () => spawns };
  }

  it("answers permissions before start() from the script, and never runs the real helper", async () => {
    const script = path.join(tmp(), "fake.json");
    writeFileSync(script, JSON.stringify({ permissions: { accessibility: false, inputMonitoring: true } }));
    process.env.AVANZEL_FAKE_CURSOR = script;
    const real = realHelperWatch();
    const { helper, problems } = make();
    await expect(helper.permissions(false)).resolves.toEqual({ accessibility: false, inputMonitoring: true });
    expect(real.spawns()).toBe(0);
    expect(problems).toEqual([]);
  });

  it("still fires the scripted taps when start() comes after a request", async () => {
    const script = path.join(tmp(), "fake.json");
    writeFileSync(script, JSON.stringify({ taps: [5] }));
    process.env.AVANZEL_FAKE_CURSOR = script;
    const { helper, tapped } = make();
    await helper.permissions(false);
    helper.start("right-option");
    await tapped;
  });

  it("rejects every request, and runs nothing real, when the script cannot be read", async () => {
    process.env.AVANZEL_FAKE_CURSOR = path.join(tmp(), "missing.json");
    const real = realHelperWatch();
    const { helper, problems } = make();
    await expect(helper.permissions(false)).rejects.toThrow(/script couldn't be read/);
    await expect(helper.inspect()).rejects.toThrow(/script couldn't be read/);
    await expect(helper.paste()).rejects.toThrow(/script couldn't be read/);
    helper.start("right-option");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/script couldn't be read/);
    expect(real.spawns()).toBe(0);
  });

  it("rejects when the script is not JSON, and runs nothing real", async () => {
    const script = path.join(tmp(), "fake.json");
    writeFileSync(script, "not json");
    process.env.AVANZEL_FAKE_CURSOR = script;
    const real = realHelperWatch();
    const { helper } = make();
    await expect(helper.inspect()).rejects.toThrow(/script couldn't be read/);
    expect(real.spawns()).toBe(0);
  });

  it("fires the scripted taps, returns the scripted targets (the last repeats) and appends the clipboard on paste", async () => {
    const dir = tmp();
    const pasteOut = path.join(dir, "pasted.txt");
    const first = front("Notes");
    const second = front("Mail");
    const script = path.join(dir, "fake.json");
    writeFileSync(
      script,
      JSON.stringify({ targets: [first, second], taps: [10, 30], permissions: { accessibility: true, inputMonitoring: false }, pasteOut }),
    );
    process.env.AVANZEL_FAKE_CURSOR = script;
    CursorHelper.fakeClipboardText = () => "hello";
    expect(CursorHelper.available()).toBe(true);

    let taps = 0;
    let secondTap!: () => void;
    const twoTaps = new Promise<void>((resolve) => (secondTap = resolve));
    const helper = new CursorHelper({
      onTap: () => {
        taps += 1;
        if (taps === 2) secondTap();
      },
      onProblem: () => undefined,
    });
    helpers.push(helper);
    helper.start("right-option");
    await twoTaps;

    expect((await helper.inspect()).app.name).toBe("Notes");
    expect((await helper.inspect()).app.name).toBe("Mail");
    expect((await helper.inspect()).app.name).toBe("Mail");
    await expect(helper.permissions(true)).resolves.toEqual({ accessibility: true, inputMonitoring: false });
    await helper.paste();
    await helper.paste();
    expect(readFileSync(pasteOut, "utf8")).toBe("hellohello");
    expect(taps).toBe(2);
  });
});
