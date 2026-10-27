// Avanzel's five quiet sounds, made with WebAudio: no files to load, and no sound until the first one plays. They are stand-ins, the synth
// of the UX prototypes (reports/Avanzel UX prototypes/first-run.html:503-511), until the owner's recordings replace them (spec §11).
// Sounds are off by default and each has a visual twin (spec §4.6): each is under 0.6 s and quiet, no layer peaks over 0.35, and the
// Stamp's two layers together peak at 0.48. A window plays one with `playSound`; the capsule's page plays what main sends it
// (`capsule:sound`), and main decides when, and whether the setting allows it (controller.ts, `sound`). A page holds one AudioContext,
// which holds the audio device open while it runs: the capsule's is made ahead of its first Tick (`prepareSounds`, when main says sounds
// are on) and closed when they go off (`releaseSounds`). After 30 s with nothing played it is suspended, which lets the device go, and
// with it the Mac sleep (`QUIET_MS`); the next sound wakes it, and so does a recording's start (`wakeSounds`). Setup and Settings play
// sounds of their own, outside main's gate: Preview sounds (`previewSounds`) plays four of them whatever the setting, and switching sounds
// on plays the Stamp (`soundsSwitched`). Each asks main right before it plays (`MayPlay`), and main says no while a recording runs.
import type { SoundName } from "../../shared/ipc.ts";

/** What of an `AudioContext` the sounds use. The page's own is one, and a fake stands in for it in the tests. */
export type AudioContextLike = Pick<
  AudioContext,
  "currentTime" | "sampleRate" | "state" | "destination" | "resume" | "suspend" | "close" | "createOscillator" | "createGain" | "createBiquadFilter" | "createBuffer" | "createBufferSource"
>;

/**
 * When each sound's last sample plays, in milliseconds after it starts: it is over by then. The synth sets them. A tone stops 20 ms
 * after it has faded (`tone`), and a burst of noise ends with its buffer (`noise`); the Letter's second note starts 0.1 s late. All are
 * under 0.6 s (spec §4.6). Preview sounds spaces its sounds by them (`PREVIEW_AT_MS`).
 */
export const SOUND_MS: Record<SoundName, number> = { tick: 80, tock: 90, stamp: 200, drawer: 220, letter: 570 };

/** The gain a fade starts from or falls to: an exponential ramp can't reach zero. */
const SILENCE = 0.0001;
/** How long a tone takes to come up to its level, so that it starts with no click. */
const ATTACK = 0.008;
/** How long a tone's oscillator runs on after it has faded. */
const TAIL = 0.02;

/**
 * A sine that comes up to `peak` in 8 ms and falls away by `seconds`, sweeping from `from` to `to` Hz as it goes (with no `to`, it holds
 * its pitch). It starts `at` seconds from now, and stops 20 ms after it has faded.
 */
function tone(context: AudioContextLike, at: number, from: number, seconds: number, peak: number, to?: number): void {
  const start = context.currentTime + at;
  const voice = context.createOscillator();
  const level = context.createGain();
  voice.type = "sine";
  voice.frequency.setValueAtTime(from, start);
  if (to !== undefined) voice.frequency.exponentialRampToValueAtTime(to, start + seconds);
  level.gain.setValueAtTime(SILENCE, start);
  level.gain.exponentialRampToValueAtTime(peak, start + ATTACK);
  level.gain.exponentialRampToValueAtTime(SILENCE, start + seconds);
  voice.connect(level).connect(context.destination);
  voice.start(start);
  voice.stop(start + seconds + TAIL);
}

/**
 * A burst of noise that dies away over `seconds`, heard through a band-pass filter at `centre` Hz (swept to `to` as it goes, if given)
 * of width `q`, at the level `peak`. It starts `at` seconds from now and ends with its buffer.
 */
function noise(context: AudioContextLike, at: number, seconds: number, centre: number, q: number, peak: number, to?: number): void {
  const start = context.currentTime + at;
  const length = Math.round(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) samples[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = context.createBufferSource();
  source.buffer = buffer;
  const band = context.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = q;
  band.frequency.setValueAtTime(centre, start);
  if (to !== undefined) band.frequency.exponentialRampToValueAtTime(to, start + seconds);
  const level = context.createGain();
  level.gain.value = peak;
  source.connect(band).connect(level).connect(context.destination);
  source.start(start);
}

const SYNTH: Record<SoundName, (context: AudioContextLike) => void> = {
  tick: (context) => tone(context, 0, 1320, 0.06, 0.07, 880),
  tock: (context) => tone(context, 0, 760, 0.07, 0.07, 520),
  // A thud and a click. The prototype's .32 and .22, lowered so that the two layers together peak at 0.48, under the spec's 0.5.
  stamp: (context) => {
    tone(context, 0, 160, 0.18, 0.3, 52);
    noise(context, 0, 0.08, 1000, 0.9, 0.18);
  },
  drawer: (context) => noise(context, 0, 0.22, 500, 0.7, 0.05, 2600),
  // Two soft bell notes, a fifth apart. The prototype's lasted 0.55 s and 0.7 s; these two end at 0.57 s, under the spec's 0.6.
  letter: (context) => {
    tone(context, 0, 1046.5, 0.35, 0.05);
    tone(context, 0.1, 1568, 0.45, 0.04);
  },
};

/**
 * The page's one AudioContext, made at the first sound or by `prepareSounds`, whichever comes first, and let go of by `releaseSounds`. Each
 * context holds the audio device open while it runs, so there is one for a page, not one for a sound.
 */
let shared: AudioContextLike | null = null;

/** A real one. Read when it is made, not when the module loads: a page that never plays makes none. */
const newContext = (): AudioContextLike => new AudioContext();

/** The page's AudioContext: the one it has, else a new one by `make`. Throws when none can be made. */
function context(make: () => AudioContextLike): AudioContextLike {
  return (shared ??= make());
}

/**
 * How long the page's AudioContext runs with nothing to play before it is suspended (`quietFrom`). A context that runs keeps the audio
 * device open, playing silence: macOS then keeps the Mac from sleeping (with sounds on and nothing playing, coreaudiod holds
 * PreventUserIdleSystemSleep for the page's audio, which `pmset -g assertions` shows, and with sounds off it holds none), and a Bluetooth
 * headset stays in its playback mode. Suspended, the context lets both go. Waking it takes a moment, which the next sound waits for.
 */
export const QUIET_MS = 30_000;

/** The wake of the page's context while it is under way (`wake`): each sound that comes meanwhile waits for it. */
let waking: Promise<void> | null = null;

/** The suspend that comes once the page has been quiet for QUIET_MS (`quietFrom`). */
let quiet: ReturnType<typeof setTimeout> | null = null;

/**
 * Wakes `ready` if it is suspended (by the quiet, or as it was made), and returns the wake, which every sound that comes meanwhile waits
 * for, so they play in the order they came: a sound scheduled into a suspended context would wait on its stopped clock, and be noted as
 * played before it is heard. Null when the context runs and no wake is under way. (A wake is always the page's context's: letting go of
 * the context forgets it, `releaseSounds`.)
 */
function wake(ready: AudioContextLike): Promise<void> | null {
  if (waking) return waking;
  if (ready.state !== "suspended") return null;
  const woken: Promise<void> = ready
    .resume()
    .catch(() => undefined) // a context that can't wake plays nothing, and the next sound tries again
    .finally(() => {
      if (waking === woken) waking = null;
    });
  waking = woken;
  return woken;
}

/**
 * Starts the quiet over: QUIET_MS after `after` milliseconds from now (the length of a sound that has just begun), `ready` is suspended,
 * if it is still the page's context and runs. A context that won't suspend is left as it is.
 */
function quietFrom(ready: AudioContextLike, after = 0): void {
  if (quiet !== null) clearTimeout(quiet);
  quiet = setTimeout(() => {
    quiet = null;
    if (shared !== ready || ready.state !== "running") return;
    try {
      void ready.suspend().catch(() => undefined);
    } catch {
      // It stays awake, as it was: the next sound starts the quiet over.
    }
  }, after + QUIET_MS);
}

/** How many plays `__avanzelSounds` keeps. */
const KEPT = 20;

/** For the tests: each play, oldest first, as its name and the time (`performance.now()`) it was played. */
type Played = { name: SoundName; at: number };

function note(name: SoundName): void {
  const log = ((globalThis as { __avanzelSounds?: Played[] }).__avanzelSounds ??= []);
  log.push({ name, at: performance.now() });
  if (log.length > KEPT) log.splice(0, log.length - KEPT);
}

/**
 * Plays `name` now. The page's AudioContext is made by the first play, unless `prepareSounds` made it first (`make`, which the tests
 * give a fake). A context the quiet has suspended is woken first, and the sound waits for it to run (`wake`); one that sounds have let
 * go of meanwhile (`releaseSounds`) takes the sound with it. Each sound starts the quiet over from its end (`quietFrom`). Each play is
 * noted in `globalThis.__avanzelSounds` for the tests, the last 20, as it is played. A sound that can't play is left unheard, and
 * nothing else is affected: a Mac with no way to play audio is a Mac without sounds, never an error in a window.
 */
export function playSound(name: SoundName, make: () => AudioContextLike = newContext): void {
  try {
    const ready = context(make);
    const woken = wake(ready);
    if (woken === null) return play(name, ready);
    void woken.then(() => {
      if (shared === ready && ready.state === "running") play(name, ready);
    });
  } catch (error) {
    console.warn(`The ${name} sound could not play.`, error);
  }
}

/** Plays `name` into `ready`, which runs, notes it, and starts the quiet over from the sound's end. */
function play(name: SoundName, ready: AudioContextLike): void {
  try {
    SYNTH[name](ready);
    note(name);
    quietFrom(ready, SOUND_MS[name]);
  } catch (error) {
    console.warn(`The ${name} sound could not play.`, error);
  }
}

/**
 * Makes the page's AudioContext now, with no sound, so that the first sound finds it made. Opening the audio device takes a tenth of a
 * second, and for the capsule that would be the Tick's, ahead of the recorder's start: main says sounds are on (`capsule:sounds-setting`,
 * when they are switched on and when the page loads with them on), and the page prepares them then, off the dictation's path. A context
 * made, or found suspended, is woken, and the quiet starts from now. Like `playSound`, it never throws: a Mac with no way to play audio is a
 * Mac without sounds, and the next sound tries again.
 */
export function prepareSounds(make: () => AudioContextLike = newContext): void {
  try {
    const ready = context(make);
    void wake(ready);
    quietFrom(ready);
  } catch (error) {
    console.warn("The sounds could not be made ready.", error);
  }
}

/**
 * Wakes the page's AudioContext, if the quiet has suspended it, for a sound that is on its way, and starts the quiet over: main says a
 * recording is starting, whose Tick follows, or has sent a sound the page holds back for a moment (the Tock until the microphone is let
 * go, the Stamp until it lands), which then finds the context awake. The wake takes about as long as opening the device. It makes no
 * context: a page that has none has nothing to wake, and its first sound makes one.
 */
export function wakeSounds(): void {
  const ready = shared;
  if (!ready) return;
  try {
    void wake(ready);
    quietFrom(ready);
  } catch (error) {
    console.warn("The sounds could not be woken.", error);
  }
}

/**
 * Closes the page's AudioContext and lets go of it, which lets go of the audio device: an open context keeps the device, and with it
 * a Bluetooth headset's playback mode, until the page ends. Main says sounds are off (`capsule:sounds-setting`), and the page releases
 * them then; a window that plays by itself releases them when its own switch goes off. A sound played after it makes a new context, as
 * the first one did, and a sound that waited for the context to wake goes with it. It does nothing for a page that has none, and a
 * context that will not close is let go of all the same.
 */
export function releaseSounds(): void {
  const held = shared;
  shared = null;
  waking = null;
  if (quiet !== null) clearTimeout(quiet);
  quiet = null;
  if (!held) return;
  try {
    void held.close().catch(() => undefined);
  } catch {
    // Let go of all the same: there is nothing else to do for a context that will not close.
  }
}

/**
 * Asks main whether a window may play a sound of its own now (`AvanzelBridge.settings.mayPlaySounds`). It may not while a recording runs:
 * the recorder keeps no echo cancellation (recorder.ts), so the sound would be heard in the words. The capsule's sounds are kept out of a
 * recording by main (controller.ts, `sound`), which sends them; a window plays its own, so it asks, right before each sound.
 */
export type MayPlay = () => Promise<boolean>;

/** What main says, or no when it can't be asked (the window is closing, say): a sound that may be heard in someone's words is worse than one that isn't played. */
async function allowed(may: MayPlay): Promise<boolean> {
  try {
    return await may();
  } catch {
    return false;
  }
}

/** Plays `name` as a window's own sound, if main says it may right as it would play. */
async function playIfAllowed(name: SoundName, may: MayPlay, make?: () => AudioContextLike): Promise<void> {
  if (await allowed(may)) playSound(name, make);
}

/**
 * When Preview sounds plays the Stamp, the Drawer and the Letter, in milliseconds after it plays the Tick, which is first. Each begins
 * after the one before has ended (`SOUND_MS`: the Tick's, the Stamp's and the Drawer's), with room to hear it end.
 */
export const PREVIEW_AT_MS = { stamp: 260, drawer: 520, letter: 800 } as const;

/**
 * Plays the Tick, the Stamp, the Drawer and the Letter one after the other, for a person to hear what the sounds are before they switch
 * them on. It plays whatever the setting is: the person asked for it, and the setting is main's to hold for the capsule (controller.ts,
 * `sound`), not a window's own. Each sound asks main right before it plays (`may`), so a recording that starts during the Preview
 * keeps the rest of it out. The times count from the Tick, which opens the audio device the first time and may take a tenth of a second
 * to: the others follow it, so the spacing between the sounds holds.
 */
export function previewSounds(may: MayPlay, make?: () => AudioContextLike): void {
  void (async () => {
    if (!(await allowed(may))) return;
    playSound("tick", make);
    setTimeout(() => void playIfAllowed("stamp", may, make), PREVIEW_AT_MS.stamp);
    setTimeout(() => void playIfAllowed("drawer", may, make), PREVIEW_AT_MS.drawer);
    setTimeout(() => void playIfAllowed("letter", may, make), PREVIEW_AT_MS.letter);
  })();
}

/**
 * What a window does when its Play sounds switch has changed, once the change is saved: switching on plays the Stamp, as the sign that
 * they are on (if main says it may: not over a recording); switching off lets go of the window's audio device (`releaseSounds`), and
 * plays nothing.
 */
export function soundsSwitched(on: boolean, may: MayPlay, make?: () => AudioContextLike): void {
  if (on) void playIfAllowed("stamp", may, make);
  else releaseSounds();
}
