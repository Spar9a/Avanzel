import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Target } from "../src/main/cursor-helper.ts";
import { COPY_PROMPT_MS, CursorDictation, type CursorHost } from "../src/main/cursor-dictation.ts";
import type { DictationEntry, DictationHistory } from "../src/main/dictation-history.ts";

const target = (over: { pid?: number; name?: string; bundleId?: string; window?: Target["window"]; element?: Target["element"] } = {}): Target => ({
  app: { name: over.name ?? "Notes", bundleId: over.bundleId ?? "com.apple.Notes", pid: over.pid ?? 100 },
  window: over.window === undefined ? { title: "Shopping list" } : over.window,
  element: over.element === undefined ? { role: "AXTextArea", secure: false, takesText: "yes" } : over.element,
});

/** What the person had on the clipboard. The helper borrows the clipboard for a paste and gives it back itself, so the host's stays as it was. */
const BEFORE = "before";
const SAID_AT = new Date(2026, 10, 5, 14, 3, 12);

/** A host that records every call in order and keeps a clipboard of its own, so tests can check what the clipboard ends up holding. */
function stubHost(
  over: {
    targets?: Array<Target | Error>;
    /** What the helper says, in turn, when asked whether the window is still the kept one; null (can't tell) once these run out. */
    same?: Array<boolean | null | Error>;
    busy?: boolean;
    started?: boolean | (() => Promise<boolean>);
    pasteFails?: boolean;
    browser?: { address?: string; privateWindow?: boolean } | null | Error;
    skip?: { apps: string[]; sites: string[] };
    logEnabled?: boolean;
    logLibrary?: string;
    historyFails?: boolean;
    historyRefuses?: boolean;
    logFails?: boolean;
    writeFails?: boolean;
    promptFails?: boolean;
    skipFails?: boolean;
    newIdFails?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const targets = [...(over.targets ?? [target(), target()])];
  const same = [...(over.same ?? [])];
  const added: DictationEntry[] = [];
  const written: DictationEntry[] = [];
  const prompts: Array<{ text: string; app: string; reason: string }> = [];
  const said: string[] = [];
  const pasted: Array<string | undefined> = [];
  const state = { clip: BEFORE, now: SAID_AT };
  let ids = 0;

  const host: CursorHost = {
    helper: {
      async inspect(keep?: boolean) {
        calls.push(keep ? "inspect:keep" : "inspect");
        const next = targets.shift();
        if (!next) throw new Error("no target left");
        if (next instanceof Error) throw next;
        return next;
      },
      async sameWindow() {
        calls.push("sameWindow");
        const next = same.shift() ?? null;
        if (next instanceof Error) throw next;
        return next;
      },
      async paste(text?: string) {
        calls.push("paste");
        if (over.pasteFails) throw new Error("Accessibility is not granted");
        pasted.push(text);
        return { restored: true };
      },
    },
    clipboard: {
      writeText(text: string) {
        calls.push("clipboard.writeText");
        if (over.writeFails) throw new Error("clipboard refused");
        state.clip = text;
      },
    },
    async startListening() {
      calls.push("startListening");
      const started = over.started ?? true;
      return typeof started === "function" ? started() : started;
    },
    stopListening() {
      calls.push("stopListening");
    },
    cancelListening() {
      calls.push("cancelListening");
    },
    busy() {
      return over.busy ?? false;
    },
    async browser() {
      calls.push("browser");
      const browser = over.browser === undefined ? null : over.browser;
      if (browser instanceof Error) throw browser;
      return browser;
    },
    skip() {
      if (over.skipFails) throw new Error("settings unreadable");
      return over.skip ?? { apps: [], sites: [] };
    },
    logTo() {
      return {
        enabled: over.logEnabled ?? true,
        ...(over.logLibrary !== undefined ? { library: over.logLibrary } : {}),
        write(entry: DictationEntry) {
          calls.push("log.write");
          if (over.logFails) throw new Error("library is locked");
          written.push(entry);
        },
      };
    },
    showCopyPrompt(p) {
      calls.push("showCopyPrompt");
      prompts.push(p);
      if (over.promptFails) throw new Error("capsule window gone");
    },
    say(line) {
      calls.push(`say:${line}`);
      said.push(line);
    },
    history: {
      add(entry: DictationEntry) {
        calls.push("history.add");
        if (over.historyFails) throw new Error("disk full");
        if (over.historyRefuses) return false;
        added.push(entry);
      },
    } as unknown as DictationHistory,
    now: () => state.now,
    newId: () => {
      if (over.newIdFails) throw new Error("no ids left");
      return `id-${++ids}`;
    },
  };
  return { host, calls, added, written, prompts, said, pasted, state };
}

/** Two taps then the words: one whole dictation. */
async function dictate(dictation: CursorDictation, words: { text: string; heard?: string; seconds: number } = { text: "milk and eggs", seconds: 2.5 }) {
  await dictation.tap();
  await dictation.tap();
  await dictation.heard(words);
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
});

describe("a dictation that pastes", () => {
  it("fixes the target at the second tap, keeping its window, and hands the words to the helper's paste; the app's clipboard is never touched", async () => {
    const stub = stubHost({ same: [true] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls).toEqual([
      "startListening",
      "inspect:keep",
      "browser",
      "stopListening",
      "inspect",
      "sameWindow",
      "paste",
      "history.add",
      "log.write",
    ]);
    // The helper got the words and borrows the clipboard itself; the host's clipboard still holds what the person had.
    expect(stub.pasted).toEqual(["milk and eggs"]);
    expect(stub.state.clip).toBe(BEFORE);
    expect(stub.prompts).toEqual([]);
  });

  it("puts the words on an asynchronous clipboard before showing the copy prompt", async () => {
    const stub = stubHost({ targets: [target({ pid: 100 }), target({ pid: 200 })] });
    const { clipboard } = stub.host;
    stub.host.clipboard = { writeText: (text) => new Promise<void>((resolve) => setTimeout(() => resolve(clipboard.writeText(text) as void), 5)) };
    await dictate(new CursorDictation(stub.host));
    expect(stub.state.clip).toBe("milk and eggs");
    expect(stub.calls.indexOf("clipboard.writeText")).toBeLessThan(stub.calls.indexOf("showCopyPrompt"));
  });

  it("keeps a whole entry: inserted, the app, its window title, and how long it was", async () => {
    const stub = stubHost();
    await dictate(new CursorDictation(stub.host));

    expect(stub.added).toHaveLength(1);
    const entry = stub.added[0]!;
    expect(entry).toEqual({
      id: "id-1",
      at: entry.at,
      text: "milk and eggs",
      app: "Notes",
      bundleId: "com.apple.Notes",
      title: "Shopping list",
      site: null,
      seconds: 2.5,
      inserted: true,
    });
    expect("heard" in entry).toBe(false);
    // Local time with its offset, naming the moment the dictation began.
    expect(entry.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    expect(entry.at.startsWith("2026-11-05T14:03:12")).toBe(true);
    expect(Date.parse(entry.at)).toBe(SAID_AT.getTime());
    expect(stub.written).toEqual([entry]);
  });

  it("counts two windows that both have no title as the same window", async () => {
    const stub = stubHost({ targets: [target({ window: null }), target({ window: null })] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.pasted).toEqual(["milk and eggs"]);
    expect(stub.added[0]).toMatchObject({ inserted: true, title: null });
  });

  it("pastes when Accessibility can't tell whether the element takes text", async () => {
    const unknown = { role: null, secure: false, takesText: "unknown" as const };
    const stub = stubHost({ targets: [target({ element: unknown }), target({ element: null })] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.pasted).toEqual(["milk and eggs"]);
    expect(stub.state.clip).toBe(BEFORE);
  });

  it("records the site of a browser tab, by domain only", async () => {
    const chrome = target({ name: "Google Chrome", bundleId: "com.google.Chrome", window: { title: "Inbox" } });
    const stub = stubHost({ targets: [chrome, chrome], browser: { address: "https://www.Example.com/mail?token=secret" } });
    await dictate(new CursorDictation(stub.host));

    expect(stub.added[0]).toMatchObject({ app: "Google Chrome", site: "example.com", inserted: true });
  });

  it("keeps what was heard before the dictionary changed it, and only then", async () => {
    const changed = stubHost();
    await dictate(new CursorDictation(changed.host), { text: "Ask Avanzel", heard: "ask of answer", seconds: 1 });
    expect(changed.added[0]).toMatchObject({ text: "Ask Avanzel", heard: "ask of answer" });
    expect(changed.written[0]).toMatchObject({ heard: "ask of answer" });

    const unchanged = stubHost();
    await dictate(new CursorDictation(unchanged.host), { text: "milk", heard: "milk", seconds: 1 });
    expect("heard" in unchanged.added[0]!).toBe(false);
  });

  it("keeps a duration that is a number even when the recorder gave none", async () => {
    const stub = stubHost();
    await dictate(new CursorDictation(stub.host), { text: "milk", seconds: Number.NaN });
    expect(stub.added[0]!.seconds).toBe(0);
  });
});

describe("a dictation that can't paste", () => {
  it("pastes nothing when another app has focus, and offers the text meant for the first one", async () => {
    const stub = stubHost({ targets: [target(), target({ pid: 200, name: "Slack", bundleId: "com.tinyspeck.slackmacgap" })] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls).not.toContain("paste");
    expect(stub.prompts).toEqual([{ text: "milk and eggs", app: "Notes", reason: "focus-moved" }]);
    expect(stub.state.clip).toBe("milk and eggs");
    expect(stub.added[0]).toMatchObject({ app: "Notes", title: "Shopping list", inserted: false });
    // The text is put on the clipboard before the prompt shows, so a manual paste works as soon as it appears.
    expect(stub.calls.indexOf("clipboard.writeText")).toBeLessThan(stub.calls.indexOf("showCopyPrompt"));
  });

  it("treats another app as focus moved even when the helper would call the window the same", async () => {
    const stub = stubHost({ targets: [target(), target({ pid: 200 })], same: [true] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls).not.toContain("paste");
    expect(stub.prompts[0]).toMatchObject({ reason: "focus-moved", app: "Notes" });
  });

  it("treats another window of the same app with the same title as focus moved, when the helper says it is another window", async () => {
    const stub = stubHost({ targets: [target(), target()], same: [false] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls).not.toContain("paste");
    expect(stub.prompts).toEqual([{ text: "milk and eggs", app: "Notes", reason: "focus-moved" }]);
    expect(stub.state.clip).toBe("milk and eggs");
    expect(stub.added[0]).toMatchObject({ inserted: false });
  });

  it("pastes into the same window whose title changed by itself, when the helper says it is the same window", async () => {
    const stub = stubHost({ targets: [target({ window: { title: "Inbox (3)" } }), target({ window: { title: "Inbox (4)" } })], same: [true] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.pasted).toEqual(["milk and eggs"]);
    expect(stub.prompts).toEqual([]);
    // The history names the window as it was when the person tapped.
    expect(stub.added[0]).toMatchObject({ title: "Inbox (3)", inserted: true });
  });

  it("falls back to the titles when the helper can't tell: another title is another window", async () => {
    const stub = stubHost({ targets: [target(), target({ window: { title: "Recipes" } })], same: [null] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls).not.toContain("paste");
    expect(stub.prompts[0]).toMatchObject({ reason: "focus-moved", app: "Notes" });
    expect(stub.state.clip).toBe("milk and eggs");
  });

  it("falls back to the titles when the helper can't tell: the same title pastes", async () => {
    const stub = stubHost({ targets: [target(), target()], same: [null] });
    await dictate(new CursorDictation(stub.host));
    expect(stub.pasted).toEqual(["milk and eggs"]);
  });

  it("falls back to the titles when asking the helper fails", async () => {
    const moved = stubHost({ targets: [target(), target({ window: { title: "Recipes" } })], same: [new Error("helper gone")] });
    await dictate(new CursorDictation(moved.host));
    expect(moved.calls).not.toContain("paste");
    expect(moved.prompts[0]).toMatchObject({ reason: "focus-moved" });

    const stayed = stubHost({ targets: [target(), target()], same: [new Error("helper gone")] });
    await dictate(new CursorDictation(stayed.host));
    expect(stayed.pasted).toEqual(["milk and eggs"]);
  });

  it("refuses to paste where the focused element positively takes no text", async () => {
    const button = { role: "AXButton", secure: false, takesText: "no" as const };
    const stub = stubHost({ targets: [target({ element: button }), target({ element: button })] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls).not.toContain("paste");
    expect(stub.prompts).toEqual([{ text: "milk and eggs", app: "Notes", reason: "failed" }]);
    expect(stub.state.clip).toBe("milk and eggs");
    expect(stub.added[0]).toMatchObject({ inserted: false });
  });

  it("decides the refusal on the fresh look, not the one at the second tap", async () => {
    const button = { role: "AXButton", secure: false, takesText: "no" as const };
    const stub = stubHost({ targets: [target({ element: button }), target()] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.pasted).toEqual(["milk and eggs"]);
  });

  it("puts the text on the clipboard and offers it when the helper's paste fails (the helper gave its clipboard back first)", async () => {
    const stub = stubHost({ pasteFails: true });
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls.indexOf("paste")).toBeLessThan(stub.calls.indexOf("clipboard.writeText"));
    expect(stub.calls.indexOf("clipboard.writeText")).toBeLessThan(stub.calls.indexOf("showCopyPrompt"));
    expect(stub.prompts).toEqual([{ text: "milk and eggs", app: "Notes", reason: "failed" }]);
    expect(stub.state.clip).toBe("milk and eggs");
    expect(stub.added[0]).toMatchObject({ inserted: false });
  });

  it("offers the text when the app in front can't be read once the words are ready", async () => {
    const stub = stubHost({ targets: [target(), new Error("no app in front")] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls).not.toContain("paste");
    expect(stub.prompts).toEqual([{ text: "milk and eggs", app: "Notes", reason: "failed" }]);
    expect(stub.state.clip).toBe("milk and eggs");
    expect(stub.added[0]).toMatchObject({ app: "Notes", inserted: false });
  });

  it("still stops listening when the target can't be read at the second tap, and keeps the words only in the app", async () => {
    const stub = stubHost({ targets: [new Error("no app in front")] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls.slice(0, 3)).toEqual(["startListening", "inspect:keep", "stopListening"]);
    expect(stub.calls).not.toContain("paste");
    expect(stub.calls).not.toContain("log.write");
    expect(stub.prompts).toEqual([{ text: "milk and eggs", app: "", reason: "failed" }]);
    expect(stub.state.clip).toBe("milk and eggs");
    expect(stub.added).toEqual([
      { id: "id-1", at: stub.added[0]!.at, text: "milk and eggs", app: "", bundleId: "", title: null, site: null, seconds: 2.5, inserted: false },
    ]);
  });

  it("still offers the text, and returns to idle, when the clipboard refuses it", async () => {
    const stub = stubHost({ writeFails: true, targets: [target(), target({ pid: 200 }), target()] });
    const dictation = new CursorDictation(stub.host);
    await expect(dictate(dictation)).resolves.toBeUndefined();

    expect(stub.prompts).toEqual([{ text: "milk and eggs", app: "Notes", reason: "focus-moved" }]);
    expect(stub.added[0]).toMatchObject({ inserted: false });
    await dictation.tap();
    expect(stub.calls.filter((call) => call === "startListening")).toHaveLength(2);
  });
});

describe("the time limit", () => {
  it("ends the dictation without asking where the cursor is: nothing is pasted, the words are offered and kept in the app's history only", async () => {
    const stub = stubHost({ targets: [target(), target()], same: [true] });
    const dictation = new CursorDictation(stub.host);
    await dictation.tap();
    dictation.timeUp();
    expect(dictation.idle()).toBe(false); // its words are on their way
    await dictation.heard({ text: "ten minutes of room noise", seconds: 600 });

    expect(stub.calls).toEqual(["startListening", "stopListening", "clipboard.writeText", "showCopyPrompt", "history.add"]);
    expect(stub.pasted).toEqual([]);
    expect(stub.prompts).toEqual([{ text: "ten minutes of room noise", app: "", reason: "failed" }]);
    expect(stub.state.clip).toBe("ten minutes of room noise");
    expect(stub.added).toEqual([expect.objectContaining({ app: "", bundleId: "", title: null, inserted: false, seconds: 600 })]);
    expect(stub.written).toEqual([]);
    expect(dictation.idle()).toBe(true);
  });

  it("ignores a tap while the timed-out dictation's words are made, then dictates normally", async () => {
    const stub = stubHost({ targets: [target(), target()] });
    const dictation = new CursorDictation(stub.host);
    await dictation.tap();
    dictation.timeUp();
    await dictation.tap();
    expect(stub.calls).toEqual(["startListening", "stopListening"]);
    await dictation.heard({ text: "noise", seconds: 600 });
    await dictate(dictation);
    expect(stub.pasted).toEqual(["milk and eggs"]);
  });

  it("does nothing when no dictation listens, or after the second tap has ended it", async () => {
    const stub = stubHost();
    const dictation = new CursorDictation(stub.host);
    dictation.timeUp();
    expect(stub.calls).toEqual([]);
    await dictation.tap();
    await dictation.tap();
    dictation.timeUp();
    await dictation.heard({ text: "milk and eggs", seconds: 2 });
    expect(stub.calls.filter((call) => call === "stopListening")).toHaveLength(1);
    expect(stub.pasted).toEqual(["milk and eggs"]);
  });

  it("leaves a second tap whose target is being read to end the dictation as a tap", async () => {
    let answer!: (target: Target) => void;
    const stub = stubHost();
    stub.host.helper.inspect = () => new Promise<Target>((resolve) => (answer = resolve));
    const dictation = new CursorDictation(stub.host);
    await dictation.tap();
    const second = dictation.tap();
    dictation.timeUp();
    answer(target());
    await second;
    expect(stub.calls).toEqual(["startListening", "browser", "stopListening"]);
  });
});

describe("what is stored", () => {
  it("pastes into a password field but keeps it nowhere", async () => {
    const secure = { role: "AXSecureTextField", secure: true, takesText: "yes" as const };
    const stub = stubHost({ targets: [target({ element: secure }), target({ element: secure })] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.pasted).toEqual(["milk and eggs"]);
    expect(stub.state.clip).toEqual(BEFORE);
    expect(stub.calls).not.toContain("history.add");
    expect(stub.calls).not.toContain("log.write");
  });

  it("pastes into a skipped app but keeps it nowhere", async () => {
    const vault = target({ name: "1Password", bundleId: "com.1password.1password" });
    const stub = stubHost({ targets: [vault, vault], skip: { apps: ["com.1password.1password"], sites: [] } });
    await dictate(new CursorDictation(stub.host));

    expect(stub.pasted).toEqual(["milk and eggs"]);
    expect(stub.calls).not.toContain("history.add");
    expect(stub.calls).not.toContain("log.write");
  });

  it("keeps nothing from a private window or a skipped site", async () => {
    const chrome = target({ name: "Google Chrome", bundleId: "com.google.Chrome" });
    const incognito = stubHost({ targets: [chrome, chrome], browser: { address: "https://example.com", privateWindow: true } });
    await dictate(new CursorDictation(incognito.host));
    expect(incognito.pasted).toEqual(["milk and eggs"]);
    expect(incognito.calls).not.toContain("history.add");

    const bank = stubHost({ targets: [chrome, chrome], browser: { address: "https://my.bank.com/login" }, skip: { apps: [], sites: ["bank.com"] } });
    await dictate(new CursorDictation(bank.host));
    expect(bank.pasted).toEqual(["milk and eggs"]);
    expect(bank.calls).not.toContain("history.add");
    expect(bank.calls).not.toContain("log.write");
  });

  it("keeps nothing from a browser whose window can't be asked about, since it might be private", async () => {
    const chrome = target({ name: "Google Chrome", bundleId: "com.google.Chrome" });
    const stub = stubHost({ targets: [chrome, chrome], browser: new Error("AppleScript timed out") });
    await dictate(new CursorDictation(stub.host));

    expect(stub.pasted).toEqual(["milk and eggs"]);
    expect(stub.calls).not.toContain("history.add");
    expect(stub.calls).not.toContain("log.write");
  });

  it("writes nothing to the library when the log is off, but keeps the history", async () => {
    const stub = stubHost({ logEnabled: false });
    await dictate(new CursorDictation(stub.host));

    expect(stub.added).toHaveLength(1);
    expect(stub.calls).not.toContain("log.write");
  });

  it("pastes when the history can't be written, but then writes nothing to the library, where it could never be forgotten from the app", async () => {
    const stub = stubHost({ historyFails: true });
    const dictation = new CursorDictation(stub.host);
    await expect(dictate(dictation)).resolves.toBeUndefined();

    expect(stub.pasted).toEqual(["milk and eggs"]);
    expect(stub.calls).not.toContain("log.write");
    expect(errors).toHaveBeenCalledWith("cursor dictation", expect.any(Error));

    // A history that refuses without throwing (it says so with false) is the same.
    const refusing = stubHost({ historyRefuses: true });
    await dictate(new CursorDictation(refusing.host));
    expect(refusing.pasted).toEqual(["milk and eggs"]);
    expect(refusing.calls).toContain("history.add");
    expect(refusing.calls).not.toContain("log.write");
  });

  it("is idle only before a dictation starts and after its words are kept", async () => {
    const stub = stubHost();
    const dictation = new CursorDictation(stub.host);
    expect(dictation.idle()).toBe(true);
    await dictation.tap();
    expect(dictation.idle()).toBe(false);
    await dictation.tap();
    expect(dictation.idle()).toBe(false);
    const words = dictation.heard({ text: "milk and eggs", seconds: 2.5 });
    expect(dictation.idle()).toBe(false); // pasting and keeping
    await words;
    expect(stub.added).toHaveLength(1);
    expect(dictation.idle()).toBe(true);
  });

  it("marks the entry with the library the log writes to, before the history keeps it, and not when the log is off", async () => {
    const logged = stubHost({ logLibrary: "/Users/someone/Avanzel" });
    await dictate(new CursorDictation(logged.host));
    expect(logged.added[0]?.library).toBe("/Users/someone/Avanzel");
    expect(logged.written[0]?.library).toBe("/Users/someone/Avanzel");

    const off = stubHost({ logEnabled: false, logLibrary: "/Users/someone/Avanzel" });
    await dictate(new CursorDictation(off.host));
    expect("library" in (off.added[0] as DictationEntry)).toBe(false);
  });

  it("pastes even when the library log can't be written, and can dictate again", async () => {
    const stub = stubHost({ logFails: true, targets: [target(), target(), target()] });
    const dictation = new CursorDictation(stub.host);
    await expect(dictate(dictation)).resolves.toBeUndefined();

    expect(stub.pasted).toEqual(["milk and eggs"]);
    expect(stub.added).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith("cursor dictation", expect.any(Error));
    await dictation.tap();
    expect(stub.calls.at(-1)).toBe("startListening");
  });
});

describe("taps, cancels and empty words", () => {
  it("says nothing was heard, and pastes and keeps nothing, for empty words", async () => {
    const stub = stubHost({ targets: [target(), target(), target()] });
    const dictation = new CursorDictation(stub.host);
    await dictate(dictation, { text: "  \n ", seconds: 1 });

    expect(stub.said).toEqual(["nothing-heard"]);
    expect(stub.calls).not.toContain("paste");
    expect(stub.calls).not.toContain("clipboard.writeText");
    expect(stub.calls).not.toContain("history.add");
    expect(stub.calls).not.toContain("log.write");
    expect(stub.state.clip).toEqual(BEFORE);
    // Back to idle: the next tap starts listening again.
    await dictation.tap();
    expect(stub.calls.at(-1)).toBe("startListening");
  });

  it("refuses to start while a thought or a call is running", async () => {
    const stub = stubHost({ busy: true });
    await new CursorDictation(stub.host).tap();

    expect(stub.said).toEqual(["refused"]);
    expect(stub.calls).not.toContain("startListening");
  });

  it("stays idle when the microphone could not be had", async () => {
    const stub = stubHost({ started: false });
    const dictation = new CursorDictation(stub.host);
    await dictation.tap();
    await dictation.tap();

    expect(stub.calls).toEqual(["startListening", "startListening"]);
  });

  it("cancels while listening, and ignores words that arrive afterwards", async () => {
    const stub = stubHost({ targets: [target(), target(), target()] });
    const dictation = new CursorDictation(stub.host);
    await dictation.tap();
    dictation.cancel();
    await dictation.heard({ text: "milk and eggs", seconds: 1 });

    expect(stub.calls).toEqual(["startListening", "cancelListening", "say:cancelled"]);
    expect(stub.state.clip).toEqual(BEFORE);
    expect(stub.added).toEqual([]);
    await dictation.tap();
    expect(stub.calls.at(-1)).toBe("startListening");
  });

  it("cancels while the words are being recognised: the host drops the recognition, and late words are never pasted", async () => {
    const stub = stubHost({ targets: [target(), target(), target()] });
    const dictation = new CursorDictation(stub.host);
    await dictation.tap();
    await dictation.tap();
    dictation.cancel();
    await dictation.heard({ text: "milk and eggs", seconds: 1 });

    expect(stub.calls).toEqual(["startListening", "inspect:keep", "browser", "stopListening", "cancelListening", "say:cancelled"]);
    expect(stub.pasted).toEqual([]);
    expect(stub.added).toEqual([]);
    expect(stub.state.clip).toEqual(BEFORE);
    // The late words drained the cancelled dictation: the next tap starts a new one.
    await dictation.tap();
    expect(stub.calls.at(-1)).toBe("startListening");
  });

  it("ignores taps after a cancel while recognising until the late words come, then dictates normally", async () => {
    const slack = target({ pid: 200, name: "Slack", bundleId: "com.tinyspeck.slackmacgap", window: { title: "general" } });
    const stub = stubHost({ targets: [target(), slack, slack] });
    const dictation = new CursorDictation(stub.host);
    await dictation.tap();
    await dictation.tap();
    dictation.cancel();
    const before = stub.calls.length;
    await dictation.tap();
    await dictation.tap();
    expect(stub.calls.length).toBe(before);

    // The cancelled dictation's words are dropped: nothing pasted, nothing kept, the clipboard untouched.
    await dictation.heard({ text: "old words", seconds: 1 });
    expect(stub.pasted).toEqual([]);
    expect(stub.added).toEqual([]);
    expect(stub.prompts).toEqual([]);
    expect(stub.state.clip).toEqual(BEFORE);

    await dictate(dictation, { text: "new words", seconds: 2 });
    expect(stub.pasted).toEqual(["new words"]);
    expect(stub.added).toHaveLength(1);
    expect(stub.added[0]).toMatchObject({ text: "new words", app: "Slack", title: "general", inserted: true });
  });

  it("lets a new dictation start ten seconds after a cancel while recognising, when no late words came", async () => {
    const stub = stubHost();
    const dictation = new CursorDictation(stub.host);
    await dictation.tap();
    await dictation.tap();
    dictation.cancel();

    stub.state.now = new Date(SAID_AT.getTime() + 9_999);
    await dictation.tap();
    expect(stub.calls.filter((call) => call === "startListening")).toHaveLength(1);

    stub.state.now = new Date(SAID_AT.getTime() + 10_000);
    await dictation.tap();
    expect(stub.calls.filter((call) => call === "startListening")).toHaveLength(2);
  });

  it("counts a paste as inserted when the helper left the clipboard alone (someone copied meanwhile), and touches it no further", async () => {
    const stub = stubHost();
    stub.host.helper.paste = async (text?: string) => {
      stub.calls.push("paste");
      stub.pasted.push(text);
      return { restored: false };
    };
    await dictate(new CursorDictation(stub.host));

    expect(stub.pasted).toEqual(["milk and eggs"]);
    expect(stub.calls).not.toContain("clipboard.writeText");
    expect(stub.prompts).toEqual([]);
    expect(stub.added[0]).toMatchObject({ inserted: true });
  });

  it("keeps the history entry when the copy prompt can't be shown", async () => {
    const moved = stubHost({ promptFails: true, targets: [target(), target({ pid: 200 })] });
    await dictate(new CursorDictation(moved.host));
    expect(moved.state.clip).toBe("milk and eggs");
    expect(moved.added).toHaveLength(1);
    expect(moved.added[0]).toMatchObject({ app: "Notes", inserted: false });
    expect(moved.written).toHaveLength(1);

    const pasteFailed = stubHost({ promptFails: true, pasteFails: true });
    await dictate(new CursorDictation(pasteFailed.host));
    expect(pasteFailed.prompts).toHaveLength(1);
    expect(pasteFailed.added[0]).toMatchObject({ inserted: false });

    const unknown = stubHost({ promptFails: true, targets: [new Error("no app in front")] });
    await dictate(new CursorDictation(unknown.host));
    expect(unknown.added[0]).toMatchObject({ app: "", inserted: false });
    expect(unknown.written).toEqual([]);
  });

  it("still applies the privacy rule when the prompt fails: a password field's words are kept nowhere", async () => {
    const secure = { role: "AXSecureTextField", secure: true, takesText: "yes" as const };
    const stub = stubHost({ promptFails: true, targets: [target({ element: secure }), target({ element: secure, pid: 200 })] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.prompts).toHaveLength(1);
    expect(stub.added).toEqual([]);
    expect(stub.written).toEqual([]);
  });

  it("keeps the entry with an id of its own when the host can't give one", async () => {
    const stub = stubHost({ newIdFails: true });
    await dictate(new CursorDictation(stub.host));

    expect(stub.added).toHaveLength(1);
    expect(stub.added[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps nothing when the skip list can't be read, but still pastes", async () => {
    const stub = stubHost({ skipFails: true });
    await dictate(new CursorDictation(stub.host));

    expect(stub.pasted).toEqual(["milk and eggs"]);
    expect(stub.state.clip).toEqual(BEFORE);
    expect(stub.added).toEqual([]);
    expect(stub.written).toEqual([]);
  });

  it("does nothing when cancelled while idle", () => {
    const stub = stubHost();
    new CursorDictation(stub.host).cancel();
    expect(stub.calls).toEqual([]);
  });

  it("ignores words when no dictation is waiting for them", async () => {
    const stub = stubHost();
    const dictation = new CursorDictation(stub.host);
    await dictation.heard({ text: "milk", seconds: 1 });
    await dictation.tap();
    await dictation.heard({ text: "milk", seconds: 1 });

    expect(stub.calls).toEqual(["startListening"]);
  });

  it("ignores a tap while the words are still being recognised", async () => {
    const stub = stubHost({ targets: [target(), target(), target()] });
    const dictation = new CursorDictation(stub.host);
    await dictation.tap();
    await dictation.tap();
    await dictation.tap();
    await dictation.heard({ text: "milk and eggs", seconds: 1 });

    expect(stub.calls.filter((call) => call === "stopListening")).toHaveLength(1);
    expect(stub.calls.filter((call) => call === "startListening")).toHaveLength(1);
    expect(stub.pasted).toEqual(["milk and eggs"]);
  });

  it("handles one set of words once, even if they arrive twice", async () => {
    const stub = stubHost({ targets: [target(), target(), target()] });
    const dictation = new CursorDictation(stub.host);
    await dictation.tap();
    await dictation.tap();
    await Promise.all([dictation.heard({ text: "milk", seconds: 1 }), dictation.heard({ text: "milk", seconds: 1 })]);

    expect(stub.pasted).toEqual(["milk"]);
    expect(stub.added).toHaveLength(1);
  });

  it("ignores a tap that comes while the microphone is still starting", async () => {
    let open!: (started: boolean) => void;
    const stub = stubHost({ started: () => new Promise<boolean>((resolve) => (open = resolve)) });
    const dictation = new CursorDictation(stub.host);
    const first = dictation.tap();
    await dictation.tap();
    open(true);
    await first;

    expect(stub.calls).toEqual(["startListening"]);
    // The first tap's recording is running: the next tap ends it.
    await dictation.tap();
    expect(stub.calls).toEqual(["startListening", "inspect:keep", "browser", "stopListening"]);
  });

  it("drops a recording cancelled while the microphone was starting", async () => {
    let open!: (started: boolean) => void;
    const stub = stubHost({ started: () => new Promise<boolean>((resolve) => (open = resolve)) });
    const dictation = new CursorDictation(stub.host);
    const first = dictation.tap();
    dictation.cancel();
    open(true);
    await first;

    expect(stub.calls).toEqual(["startListening", "say:cancelled", "cancelListening"]);
    await dictation.heard({ text: "milk", seconds: 1 });
    expect(stub.pasted).toEqual([]);
  });

  it("ignores a tap while the target is being read, so one dictation stops once", async () => {
    const stub = stubHost();
    const dictation = new CursorDictation(stub.host);
    await dictation.tap();
    await Promise.all([dictation.tap(), dictation.tap()]);

    expect(stub.calls).toEqual(["startListening", "inspect:keep", "browser", "stopListening"]);
  });

  it("can dictate twice in a row", async () => {
    const stub = stubHost({ targets: [target(), target(), target(), target()] });
    const dictation = new CursorDictation(stub.host);
    await dictate(dictation, { text: "one", seconds: 1 });
    await dictate(dictation, { text: "two", seconds: 1 });

    expect(stub.pasted).toEqual(["one", "two"]);
    expect(stub.added.map((entry) => entry.id)).toEqual(["id-1", "id-2"]);
    expect(stub.state.clip).toEqual(BEFORE);
  });
});

describe("the copy prompt", () => {
  it("is shown for about five seconds", () => {
    expect(COPY_PROMPT_MS).toBe(5000);
  });
});
