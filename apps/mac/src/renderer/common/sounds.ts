// Avanzel's five quiet sounds, made with WebAudio: no files to load, and no sound until the first one plays. They are stand-ins, the synth
// of the UX prototypes (reports/Avanzel UX prototypes/first-run.html:503-511), until the owner's recordings replace them (spec §11).
// Sounds are off by default and each has a visual twin (spec §4.6): each is under 0.6 s and quiet, no layer peaks over 0.35, and the
// Stamp's two layers together peak at 0.48. A window plays one with `playSound`; the capsule's page plays what main sends it
// (`capsule:sound`), and main decides when, and whether the setting allows it (controller.ts, `sound`).
import type { SoundName } from "../../shared/ipc.ts";

/** What of an `AudioContext` the sounds use. The page's own is one, and a fake stands in for it in the tests. */
export type AudioContextLike = Pick<
  AudioContext,
  "currentTime" | "sampleRate" | "state" | "destination" | "resume" | "createOscillator" | "createGain" | "createBiquadFilter" | "createBuffer" | "createBufferSource"
>;

/**
 * When each sound's last sample plays, in milliseconds after it starts: it is over by then. The synth sets them. A tone stops 20 ms
 * after it has faded (`tone`), and a burst of noise ends with its buffer (`noise`); the Letter's second note starts 0.1 s late. All are
 * under 0.6 s (spec §4.6). The Preview in setup and Settings spaces its sounds by them.
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

/** The page's one AudioContext, made at the first sound. Each context holds the audio device open, so there is one for a page, not one for a sound. */
let shared: AudioContextLike | null = null;

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
 * Plays `name` now. The page's AudioContext is made by the first play (`make`, which the tests give a fake) and woken if it is
 * suspended. Each play is noted in `globalThis.__avanzelSounds` for the tests, the last 20. A sound that can't play is left unheard,
 * and nothing else is affected: a Mac with no way to play audio is a Mac without sounds, never an error in a window.
 */
export function playSound(name: SoundName, make: () => AudioContextLike = () => new AudioContext()): void {
  try {
    const context = (shared ??= make());
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    SYNTH[name](context);
    note(name);
  } catch (error) {
    console.warn(`The ${name} sound could not play.`, error);
  }
}
