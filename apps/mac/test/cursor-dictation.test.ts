import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Target } from "../src/main/cursor-helper.ts";
import { COPY_PROMPT_MS, CursorDictation, type ClipboardSnapshot, type CursorHost } from "../src/main/cursor-dictation.ts";
import type { DictationEntry, DictationHistory } from "../src/main/dictation-history.ts";

const target = (over: { pid?: number; name?: string; bundleId?: string; window?: Target["window"]; element?: Target["element"] } = {}): Target => ({
  app: { name: over.name ?? "Notes", bundleId: over.bundleId ?? "com.apple.Notes", pid: over.pid ?? 100 },
  window: over.window === undefined ? { title: "Shopping list" } : over.window,
  element: over.element === undefined ? { role: "AXTextArea", secure: false, takesText: "yes" } : over.element,
});

const BEFORE: ClipboardSnapshot = { text: "before", html: "<b>before</b>", rtf: null, image: null };
const SAID_AT = new Date(2026, 10, 5, 14, 3, 12);

/** A host that records every call in order and keeps a clipboard of its own, so tests can check what the clipboard ends up holding. */
function stubHost(
  over: {
    targets?: Array<Target | Error>;
    busy?: boolean;
    started?: boolean | (() => Promise<boolean>);
    pasteFails?: boolean;
    browser?: { address?: string; privateWindow?: boolean } | null | Error;
    skip?: { apps: string[]; sites: string[] };
    logEnabled?: boolean;
    historyFails?: boolean;
    logFails?: boolean;
    readFails?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const targets = [...(over.targets ?? [target(), target()])];
  const added: DictationEntry[] = [];
  const written: DictationEntry[] = [];
  const prompts: Array<{ text: string; app: string; reason: string }> = [];
  const said: string[] = [];
  const pasted: Array<string | null> = [];
  const state = { clip: { ...BEFORE } as ClipboardSnapshot };
  let ids = 0;

  const host: CursorHost = {
    helper: {
      async inspect() {
        calls.push("inspect");
        const next = targets.shift();
        if (!next) throw new Error("no target left");
        if (next instanceof Error) throw next;
        return next;
      },
      async paste() {
        calls.push("paste");
        if (over.pasteFails) throw new Error("Accessibility is not granted");
        pasted.push(state.clip.text);
      },
    },
    clipboard: {
      read() {
        calls.push("clipboard.read");
        if (over.readFails) throw new Error("clipboard unreadable");
        return { ...state.clip };
      },
      writeText(text: string) {
        calls.push("clipboard.writeText");
        state.clip = { text, html: null, rtf: null, image: null };
      },
      restore(snapshot: ClipboardSnapshot) {
        calls.push("clipboard.restore");
        state.clip = { ...snapshot };
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
      return over.skip ?? { apps: [], sites: [] };
    },
    logTo() {
      return {
        enabled: over.logEnabled ?? true,
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
    },
    say(line) {
      calls.push(`say:${line}`);
      said.push(line);
    },
    history: {
      add(entry: DictationEntry) {
        calls.push("history.add");
        if (over.historyFails) throw new Error("disk full");
        added.push(entry);
      },
    } as unknown as DictationHistory,
    now: () => SAID_AT,
    newId: () => `id-${++ids}`,
    async wait(ms: number) {
      calls.push(`wait:${ms}`);
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
  it("fixes the target at the second tap, pastes the words, then gives back the clipboard it found", async () => {
    const stub = stubHost();
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls).toEqual([
      "startListening",
      "inspect",
      "browser",
      "stopListening",
      "inspect",
      "clipboard.read",
      "clipboard.writeText",
      "paste",
      "wait:150",
      "clipboard.restore",
      "history.add",
      "log.write",
    ]);
    // The paste saw the words on the clipboard, and afterwards the clipboard holds what it held before, html included.
    expect(stub.pasted).toEqual(["milk and eggs"]);
    expect(stub.state.clip).toEqual(BEFORE);
    expect(stub.prompts).toEqual([]);
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
    expect(stub.state.clip).toEqual(BEFORE);
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
    expect(stub.calls).not.toContain("clipboard.restore");
    expect(stub.prompts).toEqual([{ text: "milk and eggs", app: "Notes", reason: "focus-moved" }]);
    expect(stub.state.clip.text).toBe("milk and eggs");
    expect(stub.added[0]).toMatchObject({ app: "Notes", title: "Shopping list", inserted: false });
    // The text is put on the clipboard before the prompt shows, so a manual paste works as soon as it appears.
    expect(stub.calls.indexOf("clipboard.writeText")).toBeLessThan(stub.calls.indexOf("showCopyPrompt"));
  });

  it("treats another window of the same app as focus moved", async () => {
    const stub = stubHost({ targets: [target(), target({ window: { title: "Recipes" } })] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls).not.toContain("paste");
    expect(stub.prompts[0]).toMatchObject({ reason: "focus-moved", app: "Notes" });
    expect(stub.state.clip.text).toBe("milk and eggs");
  });

  it("refuses to paste where the focused element positively takes no text", async () => {
    const button = { role: "AXButton", secure: false, takesText: "no" as const };
    const stub = stubHost({ targets: [target({ element: button }), target({ element: button })] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls).not.toContain("paste");
    expect(stub.prompts).toEqual([{ text: "milk and eggs", app: "Notes", reason: "failed" }]);
    expect(stub.state.clip.text).toBe("milk and eggs");
    expect(stub.added[0]).toMatchObject({ inserted: false });
  });

  it("decides the refusal on the fresh look, not the one at the second tap", async () => {
    const button = { role: "AXButton", secure: false, takesText: "no" as const };
    const stub = stubHost({ targets: [target({ element: button }), target()] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.pasted).toEqual(["milk and eggs"]);
  });

  it("leaves the text on the clipboard and offers it when the paste can't be sent", async () => {
    const stub = stubHost({ pasteFails: true });
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls.indexOf("clipboard.writeText")).toBeLessThan(stub.calls.indexOf("paste"));
    expect(stub.calls).not.toContain("clipboard.restore");
    expect(stub.calls).not.toContain("wait:150");
    expect(stub.prompts).toEqual([{ text: "milk and eggs", app: "Notes", reason: "failed" }]);
    expect(stub.state.clip.text).toBe("milk and eggs");
    expect(stub.added[0]).toMatchObject({ inserted: false });
  });

  it("offers the text when the app in front can't be read once the words are ready", async () => {
    const stub = stubHost({ targets: [target(), new Error("no app in front")] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls).not.toContain("paste");
    expect(stub.prompts).toEqual([{ text: "milk and eggs", app: "Notes", reason: "failed" }]);
    expect(stub.state.clip.text).toBe("milk and eggs");
    expect(stub.added[0]).toMatchObject({ app: "Notes", inserted: false });
  });

  it("still stops listening when the target can't be read at the second tap, and keeps the words only in the app", async () => {
    const stub = stubHost({ targets: [new Error("no app in front")] });
    await dictate(new CursorDictation(stub.host));

    expect(stub.calls.slice(0, 3)).toEqual(["startListening", "inspect", "stopListening"]);
    expect(stub.calls).not.toContain("paste");
    expect(stub.calls).not.toContain("log.write");
    expect(stub.prompts).toEqual([{ text: "milk and eggs", app: "", reason: "failed" }]);
    expect(stub.state.clip.text).toBe("milk and eggs");
    expect(stub.added).toEqual([
      { id: "id-1", at: stub.added[0]!.at, text: "milk and eggs", app: "", bundleId: "", title: null, site: null, seconds: 2.5, inserted: false },
    ]);
  });

  it("offers the text and returns to idle when the clipboard itself fails", async () => {
    const stub = stubHost({ readFails: true, targets: [target(), target(), target()] });
    const dictation = new CursorDictation(stub.host);
    await expect(dictate(dictation)).resolves.toBeUndefined();

    expect(stub.prompts).toEqual([{ text: "milk and eggs", app: "Notes", reason: "failed" }]);
    expect(stub.added[0]).toMatchObject({ inserted: false });
    await dictation.tap();
    expect(stub.calls.filter((call) => call === "startListening")).toHaveLength(2);
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

  it("pastes and logs even when the history can't be written", async () => {
    const stub = stubHost({ historyFails: true });
    const dictation = new CursorDictation(stub.host);
    await expect(dictate(dictation)).resolves.toBeUndefined();

    expect(stub.pasted).toEqual(["milk and eggs"]);
    expect(stub.written).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith("cursor dictation", expect.any(Error));
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

  it("cancels while the words are being recognised, so they are never pasted", async () => {
    const stub = stubHost({ targets: [target(), target(), target()] });
    const dictation = new CursorDictation(stub.host);
    await dictation.tap();
    await dictation.tap();
    dictation.cancel();
    await dictation.heard({ text: "milk and eggs", seconds: 1 });

    expect(stub.calls).toEqual(["startListening", "inspect", "browser", "stopListening", "say:cancelled"]);
    expect(stub.added).toEqual([]);
    await dictation.tap();
    expect(stub.calls.at(-1)).toBe("startListening");
  });

  it("counts a paste as inserted even when the old clipboard can't be given back", async () => {
    const stub = stubHost();
    stub.host.clipboard.restore = () => {
      throw new Error("pasteboard busy");
    };
    await dictate(new CursorDictation(stub.host));

    expect(stub.pasted).toEqual(["milk and eggs"]);
    expect(stub.prompts).toEqual([]);
    expect(stub.added[0]).toMatchObject({ inserted: true });
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
    expect(stub.calls).toEqual(["startListening", "inspect", "browser", "stopListening"]);
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

    expect(stub.calls).toEqual(["startListening", "inspect", "browser", "stopListening"]);
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
