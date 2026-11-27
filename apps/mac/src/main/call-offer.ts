// When to offer call notes: MicWatch reports who holds the microphone, and CallOffer decides which app, if any, to ask about now.
// It is pure timing and bookkeeping; what the question looks like and what "Take notes" does belong to the host.
import type { MicHolder } from "./mic-watch.ts";

/** How long an app must hold the microphone before it is worth a question: shorter holds are dictation, a test or a ping. */
export const HOLD_MS = 5_000;
/** A gap shorter than this is a hiccup in the report, not the app letting go, so the hold carries on. */
export const BLIP_MS = 1_000;
/** How long an app must stay off the microphone before it is forgotten, which also ends a "Not now" for it. */
export const RELEASE_MS = 10_000;

/** Daemons that stand for an app, from the Task 1 check only (bundle → the app's name). */
export const DAEMON_APPS: Readonly<Record<string, string>> = {};

/** The app a question is about: `pid` is its outermost process (a daemon's own pid for a daemon), `path` its bundle if known. */
export interface OfferedApp {
  pid: number;
  name: string;
  path: string | null;
}

/** What CallOffer needs from the rest of the app, so the decision can be tested without a capsule or a call. */
export interface OfferHost {
  /** Avanzel's own process ids: its dictation and calls hold the microphone too, and are never worth a question. */
  ownPids(): ReadonlySet<number>;
  /** The setting is on, the library is open, call notes could start and the capsule is hidden. */
  canAsk(): boolean;
  /** A call is running or ending (`CallNotes.phase !== "idle"`). */
  callRunning(): boolean;
  /** Show the question about this app. */
  ask(app: OfferedApp): void;
  /** The asked app let go of the microphone, or a call began, while the question shows: take it down. */
  withdraw(): void;
  /** The person chose Take notes for this app. */
  take(app: OfferedApp): void;
}

interface Entry {
  app: OfferedApp;
  /** When this hold began; moved forward when the app came back after a gap of `BLIP_MS` or more. */
  since: number;
  /** When the app was last seen letting go, while it hasn't come back. */
  goneAt: number | null;
  /** Asked and answered, or present during a call: not asked about again until the app has let go for `RELEASE_MS`. */
  answered: boolean;
  /** Deletes the entry `RELEASE_MS` after it let go. */
  release: NodeJS.Timeout | null;
}

/**
 * Turns the microphone holders into one question at a time: an app that has held the microphone for `HOLD_MS`, while no call is
 * running and the capsule is free, is offered call notes. Answering "Not now", or a call starting while the app is there, keeps
 * it quiet until the app has let go for `RELEASE_MS`. `asking` is always cleared before the host is called, so a host that
 * answers from inside `ask` or `withdraw` can't confuse it.
 */
export class CallOffer {
  private readonly entries = new Map<number, Entry>();
  private askingKey: number | null = null;
  private asked: OfferedApp | null = null;
  private timer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(private readonly host: OfferHost) {}

  /** The app the open question is about, or null when nothing is being asked. */
  get asking(): OfferedApp | null {
    return this.asked;
  }

  /** The latest set of holders from MicWatch: updates what is held and gone, then decides whether to ask. */
  holders(list: readonly MicHolder[]): void {
    if (this.disposed) return;
    const now = Date.now();
    const own = this.host.ownPids();
    const present = new Map<number, OfferedApp>();
    for (const holder of list) {
      if (own.has(holder.pid) || (holder.appPid !== null && own.has(holder.appPid))) continue;
      if (holder.app !== null && holder.appPid !== null) {
        if (!present.has(holder.appPid)) present.set(holder.appPid, { pid: holder.appPid, name: holder.app, path: holder.path });
      } else if (holder.app === null && holder.bundle !== null && Object.hasOwn(DAEMON_APPS, holder.bundle)) {
        const name = DAEMON_APPS[holder.bundle];
        if (name !== undefined && !present.has(-holder.pid)) present.set(-holder.pid, { pid: holder.pid, name, path: holder.path });
      }
    }
    for (const [key, app] of present) {
      const entry = this.entries.get(key);
      if (!entry) {
        this.entries.set(key, { app, since: now, goneAt: null, answered: false, release: null });
        continue;
      }
      if (entry.goneAt !== null && now - entry.goneAt >= BLIP_MS) entry.since = now;
      entry.goneAt = null;
      entry.app = app;
      if (entry.release) clearTimeout(entry.release);
      entry.release = null;
    }
    for (const [key, entry] of this.entries) {
      if (present.has(key) || entry.goneAt !== null) continue;
      entry.goneAt = now;
      entry.release = setTimeout(() => this.forget(key), RELEASE_MS);
    }
    this.decide();
  }

  /** Looks again, for when something the decision waits on changed: the capsule freed up, a call ended, or a hold reached 5 s. */
  recheck(): void {
    if (this.disposed) return;
    this.decide();
  }

  /** The person's answer: Take notes (`true`) starts the call notes, Not now (`false`, or the question timing out) stays quiet. */
  answer(take: boolean): void {
    const entry = this.takeAsked();
    if (!entry) return;
    entry.answered = true;
    if (take) this.host.take(entry.app);
  }

  /** The question was taken down for another thing on the capsule: the app stays unanswered and is asked again on a recheck. */
  gaveWay(): void {
    this.takeAsked();
  }

  /** Stops all timers; nothing is asked or decided afterwards. */
  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const entry of this.entries.values()) if (entry.release) clearTimeout(entry.release);
    this.entries.clear();
    this.askingKey = null;
    this.asked = null;
  }

  /** Clears `asking` and returns the entry it was about, or null when nothing is asked. */
  private takeAsked(): Entry | null {
    if (this.askingKey === null) return null;
    const entry = this.entries.get(this.askingKey) ?? null;
    this.askingKey = null;
    this.asked = null;
    return entry;
  }

  /** An entry that stayed off the microphone for `RELEASE_MS`; withdraws the question if it was the one asked. */
  private forget(key: number): void {
    if (this.disposed) return;
    this.entries.delete(key);
    if (this.askingKey === key) {
      this.askingKey = null;
      this.asked = null;
      this.host.withdraw();
    }
    this.decide();
  }

  private decide(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const now = Date.now();
    if (this.host.callRunning()) {
      for (const entry of this.entries.values()) if (entry.goneAt === null) entry.answered = true;
      if (this.askingKey !== null) {
        this.askingKey = null;
        this.asked = null;
        this.host.withdraw();
      }
    } else if (this.askingKey === null && this.host.canAsk()) {
      for (const [key, entry] of this.entries) {
        if (entry.goneAt !== null || entry.answered || now - entry.since < HOLD_MS) continue;
        this.askingKey = key;
        this.asked = entry.app;
        this.host.ask(entry.app);
        break;
      }
    }
    let next = Infinity;
    for (const entry of this.entries.values()) {
      if (entry.goneAt === null && !entry.answered && entry.since + HOLD_MS > now) next = Math.min(next, entry.since + HOLD_MS - now);
    }
    if (next !== Infinity && !this.disposed) {
      // A host that called `recheck` from inside `ask` or `withdraw` has already set one.
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.recheck(), next);
    }
  }
}
