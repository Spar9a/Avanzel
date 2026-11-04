// One dictation at the cursor, from the first tap of the key to the words pasted into the app in front. This file only
// orchestrates: the microphone, the clipboard, the native helper and the capsule are all behind CursorHost, which the
// controller implements, so the whole flow can be tested without Electron or a Mac.
import { randomUUID } from "node:crypto";
import type { CursorHelper, Target } from "./cursor-helper.ts";
import { storagePolicy } from "./cursor-policy.ts";
import type { DictationEntry, DictationHistory } from "./dictation-history.ts";

export interface ClipboardSnapshot {
  text: string | null;
  html: string | null;
  rtf: string | null;
  image: Buffer | null;
}

export interface CursorHost {
  helper: Pick<CursorHelper, "inspect" | "paste">;
  clipboard: { read(): ClipboardSnapshot; writeText(text: string): void; restore(s: ClipboardSnapshot): void };
  /** Starts the capsule's microphone as a cursor recording; false when something else holds it (it has said why). */
  startListening(): Promise<boolean>;
  /** Asks for the audio; it arrives at `heard`. */
  stopListening(): void;
  /**
   * Drops the recording. Called after `stopListening()` too (Esc while the words are being recognised): then it ALSO drops
   * the recognition still in flight, so `heard` does not arrive for it.
   */
  cancelListening(): void;
  /** A thought or a call is running. */
  busy(): boolean;
  browser(target: Target): Promise<{ address?: string; privateWindow?: boolean } | null>;
  skip(): { apps: string[]; sites: string[] };
  logTo(): { enabled: boolean; write(entry: DictationEntry): void };
  showCopyPrompt(p: { text: string; app: string; reason: "failed" | "focus-moved" }): void;
  say(line: "refused" | "nothing-heard" | "cancelled"): void;
  history: DictationHistory;
  now(): Date;
  newId(): string;
  /** Resolves after `ms`; the pause between the paste and giving the clipboard back. */
  wait(ms: number): Promise<void>;
}

/** How long the copy prompt stays up when the words could not be pasted. */
export const COPY_PROMPT_MS = 5000;

/** The paste keystroke is read by the app in front some time after it is sent, so the clipboard is given back only after this. */
const RESTORE_AFTER_MS = 150;

/** How long taps are refused after a cancel while recognising, waiting for that recognition's late words to drain. */
const DRAIN_MS = 10_000;

type State = "idle" | "listening" | "transcribing";

/** What a browser said about its front window, or that it could not be asked. */
type BrowserLook = { ok: true; value: { address?: string; privateWindow?: boolean } | null } | { ok: false };

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * "2026-11-05T14:03:12+04:00": local time with its UTC offset, as the history keeps `at`. The engine's `isoLocal` writes
 * the same thing but is not exported from `@avanzel/engine`, and this task may not change the engine.
 */
function isoLocal(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const minutes = Math.abs(offset);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${day}T${time}${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

const sameTarget = (fixed: Target, fresh: Target): boolean =>
  fixed.app.pid === fresh.app.pid && (fixed.window?.title ?? null) === (fresh.window?.title ?? null);

export class CursorDictation {
  private state: State = "idle";
  /** Bumped by every start and cancel, so an await that finishes after its dictation was cancelled can tell. */
  private session = 0;
  /** The microphone is being asked for: a second tap now would start a second recording. */
  private starting = false;
  /** The target is being read at the second tap: a third tap now would stop the recording twice. */
  private fixing = false;
  /** The words are being pasted and kept: a second delivery of the same words would paste them twice. */
  private delivering = false;
  private startedAt: Date | null = null;
  /** The target fixed at the second tap; null when it could not be read. */
  private target: Target | null = null;
  private browserLook: Promise<BrowserLook> = Promise.resolve({ ok: true, value: null });
  /**
   * Set when a dictation was cancelled while its words were being recognised. `heard()` carries no id, so late words from
   * that recognition could not be told from the next dictation's. The rule: until the host calls `heard()` once more (those
   * late words, which are dropped) or DRAIN_MS pass by `host.now()`, taps are ignored, so no new dictation can be waiting
   * for words when the stale ones arrive. The host's `cancelListening()` should already stop them; this is the guard if not.
   */
  private cancelledAt: Date | null = null;

  constructor(private readonly host: CursorHost) {}

  /** One tap of the key. */
  async tap(): Promise<void> {
    if (this.starting || this.fixing) return;
    if (this.cancelledAt) {
      if (this.host.now().getTime() - this.cancelledAt.getTime() < DRAIN_MS) return;
      this.cancelledAt = null;
    }
    if (this.state === "idle") return this.begin();
    if (this.state === "listening") return this.fix();
    // While transcribing the words are on their way; a tap now must not start a recording that would compete for the clipboard.
  }

  /** Esc: drops the recording and inserts nothing. Words already being pasted are not taken back. */
  cancel(): void {
    if (this.delivering) return;
    if (this.state === "listening") {
      this.session += 1;
      this.state = "idle";
      this.host.cancelListening();
      this.host.say("cancelled");
      return;
    }
    if (this.starting) {
      // The microphone is not on yet; begin() turns it off again once it is, seeing the session has moved on.
      this.session += 1;
      this.host.say("cancelled");
      return;
    }
    if (this.state === "transcribing") {
      // The recording has already stopped, so the host is asked to drop the recognition too, and the class waits for any
      // words that still come (see cancelledAt). This is also the way out for a host whose recognition failed and will
      // never call heard(): the drain ends by time.
      this.session += 1;
      this.state = "idle";
      this.target = null;
      this.cancelledAt = this.host.now();
      this.host.cancelListening();
      this.host.say("cancelled");
    }
  }

  /** The audio is in and recognised: `{ text, heard?, seconds }` (text may be empty). */
  async heard(words: { text: string; heard?: string; seconds: number }): Promise<void> {
    if (this.cancelledAt) {
      // These are the cancelled dictation's late words: no tap could start a new one while cancelledAt was set.
      this.cancelledAt = null;
      return;
    }
    if (this.state !== "transcribing" || this.delivering) return;
    this.delivering = true;
    const fixed = this.target;
    const browserLook = this.browserLook;
    const at = this.startedAt ?? this.host.now();
    try {
      if (!words.text.trim()) {
        this.host.say("nothing-heard");
        return;
      }
      if (!fixed) {
        // Nothing says where the words were meant to go, so they are offered rather than pasted into whatever is in front.
        this.offer(words.text, "");
        this.keepUnknown(words, at);
        return;
      }
      let inserted = false;
      try {
        inserted = await this.deliver(words.text, fixed);
      } catch (error) {
        console.error("cursor dictation", error);
        this.offer(words.text, fixed.app.name);
      }
      await this.keep(words, at, fixed, browserLook, inserted);
    } catch (error) {
      console.error("cursor dictation", error);
    } finally {
      // Whatever happened, the next tap must be able to start a new dictation.
      this.delivering = false;
      this.state = "idle";
      this.target = null;
      this.startedAt = null;
    }
  }

  private async begin(): Promise<void> {
    if (this.host.busy()) {
      this.host.say("refused");
      return;
    }
    this.starting = true;
    const session = ++this.session;
    let started = false;
    try {
      started = await this.host.startListening();
    } catch (error) {
      console.error("cursor dictation", error);
    } finally {
      this.starting = false;
    }
    if (!started) return;
    if (session !== this.session) {
      // Cancelled while the microphone was starting; it has already been said.
      this.host.cancelListening();
      return;
    }
    this.state = "listening";
    this.startedAt = this.host.now();
  }

  private async fix(): Promise<void> {
    this.fixing = true;
    const session = this.session;
    let target: Target | null = null;
    try {
      target = await this.host.helper.inspect();
    } catch (error) {
      // An unknown target still ends the recording; the words will be offered, not pasted.
      console.error("cursor dictation", error);
    } finally {
      this.fixing = false;
    }
    if (session !== this.session || this.state !== "listening") return;
    this.target = target;
    // The browser is asked now, not when the words are ready, because the tab in front then may not be the one spoken to.
    // It is not awaited, so asking a browser doesn't hold up the end of the recording.
    this.browserLook = target
      ? this.host.browser(target).then(
          (value): BrowserLook => ({ ok: true, value }),
          (error): BrowserLook => {
            console.error("cursor dictation", error);
            return { ok: false };
          },
        )
      : Promise.resolve({ ok: true, value: null });
    this.state = "transcribing";
    try {
      this.host.stopListening();
    } catch (error) {
      // No words will ever come for a recording that couldn't be stopped, so waiting for them would stick here for good.
      console.error("cursor dictation", error);
      this.state = "idle";
      this.target = null;
    }
  }

  /** Pastes the words if the target fixed at the second tap still has focus and may take text; true when the paste went. */
  private async deliver(text: string, fixed: Target): Promise<boolean> {
    let fresh: Target;
    try {
      fresh = await this.host.helper.inspect();
    } catch (error) {
      console.error("cursor dictation", error);
      this.offer(text, fixed.app.name);
      return false;
    }
    if (!sameTarget(fixed, fresh)) {
      this.offer(text, fixed.app.name, "focus-moved");
      return false;
    }
    // Accessibility is trusted to refuse, never to approve: only a positive "no" stops the paste.
    if (fresh.element?.takesText === "no") {
      this.offer(text, fixed.app.name);
      return false;
    }
    const snapshot = this.host.clipboard.read();
    this.host.clipboard.writeText(text);
    try {
      await this.host.helper.paste();
    } catch (error) {
      // The clipboard is not given back: the words stay on it so a manual paste still works.
      console.error("cursor dictation", error);
      this.prompt(text, fixed.app.name, "failed");
      return false;
    }
    // The words are already in the app, so whatever fails from here the clipboard is given back and the paste counts.
    try {
      await this.host.wait(RESTORE_AFTER_MS);
    } catch (error) {
      console.error("cursor dictation", error);
    } finally {
      try {
        this.host.clipboard.restore(snapshot);
      } catch (error) {
        console.error("cursor dictation", error);
      }
    }
    return true;
  }

  /** Shows the copy prompt; a prompt that fails is logged, so it can't cost the dictation its history entry. */
  private prompt(text: string, app: string, reason: "failed" | "focus-moved"): void {
    try {
      this.host.showCopyPrompt({ text, app, reason });
    } catch (error) {
      console.error("cursor dictation", error);
    }
  }

  /** Puts the words on the clipboard and shows the copy prompt, so either a manual paste or the Copy button works. */
  private offer(text: string, app: string, reason: "failed" | "focus-moved" = "failed"): void {
    try {
      this.host.clipboard.writeText(text);
    } catch (error) {
      // The prompt's Copy button is still there when the clipboard refused the words.
      console.error("cursor dictation", error);
    }
    this.prompt(text, app, reason);
  }

  /** Keeps the dictation in the history and the library log, as the storage policy for the fixed target allows. */
  private async keep(
    words: { text: string; heard?: string; seconds: number },
    at: Date,
    fixed: Target,
    browserLook: Promise<BrowserLook>,
    inserted: boolean,
  ): Promise<void> {
    const look = await browserLook;
    // A browser that couldn't be asked might have had a private window in front, so nothing is kept.
    if (!look.ok) return;
    let skip: { apps: string[]; sites: string[] };
    try {
      skip = this.host.skip();
    } catch (error) {
      // Without the person's skip list the privacy rule can't be applied, and keeping too much is the worse mistake.
      console.error("cursor dictation", error);
      return;
    }
    const policy = storagePolicy(fixed, look.value, skip);
    if (!policy.store) return;
    const entry = this.entry(words, at, {
      app: fixed.app.name,
      bundleId: fixed.app.bundleId,
      title: fixed.window?.title ?? null,
      site: policy.site,
      inserted,
    });
    this.addToHistory(entry);
    try {
      const log = this.host.logTo();
      if (log.enabled) log.write(entry);
    } catch (error) {
      console.error("cursor dictation", error);
    }
  }

  /** Keeps words whose target was never known in the app's history only: an unknown app might be a password manager, and the library is read by an agent. */
  private keepUnknown(words: { text: string; heard?: string; seconds: number }, at: Date): void {
    this.addToHistory(this.entry(words, at, { app: "", bundleId: "", title: null, site: null, inserted: false }));
  }

  private addToHistory(entry: DictationEntry): void {
    try {
      this.host.history.add(entry);
    } catch (error) {
      console.error("cursor dictation", error);
    }
  }

  /** The host's id for a new entry, or a random one if it has none to give, so a failing id source doesn't lose the entry. */
  private id(): string {
    try {
      return this.host.newId();
    } catch (error) {
      console.error("cursor dictation", error);
      return randomUUID();
    }
  }

  /** A whole entry: the history's reader drops one with a missing or non-finite field, so every field is filled here. */
  private entry(
    words: { text: string; heard?: string; seconds: number },
    at: Date,
    where: Pick<DictationEntry, "app" | "bundleId" | "title" | "site" | "inserted">,
  ): DictationEntry {
    const entry: DictationEntry = {
      id: this.id(),
      at: isoLocal(at),
      text: words.text,
      app: where.app,
      bundleId: where.bundleId,
      title: where.title,
      site: where.site,
      seconds: Number.isFinite(words.seconds) ? words.seconds : 0,
      inserted: where.inserted,
    };
    // `heard` is kept only when the dictionary changed something, as the history and the day file promise.
    if (typeof words.heard === "string" && words.heard !== words.text) entry.heard = words.heard;
    return entry;
  }
}
