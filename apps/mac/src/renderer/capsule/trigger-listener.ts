// The voice trigger's ear: the microphone, open while the trigger is on, cut into short spans of speech that main checks for the word
// (`Controller.onTriggerAudio`). Quiet is never sent: a span starts when the sound rises over the room's own level and ends when it
// falls back for a moment, so nothing is made into words while no one speaks. 16 kHz mono, as the recorder's.

const RATE = 16000;
/** Sound kept from before a span starts, so its first syllable isn't cut: 300 ms. */
const BEFORE = 0.3 * RATE;
/** How long a span may run (3 s: a trigger word is short), and how long a quiet ends one (600 ms). */
const LONGEST = 3 * RATE;
const QUIET_ENDS = 0.6 * RATE;
/** A span shorter than this (250 ms) is a click or a cough, not a word. */
const SHORTEST = 0.25 * RATE;
/** Speech is this many times the room's level, and never under the floor, so a silent room's hiss doesn't count. */
const OVER_ROOM = 3;
const FLOOR = 0.012;

export class TriggerListener {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private generation = 0;

  /**
   * `send` gets each span of speech. `worklet`: where the capture worklet is, from the page that listens: the capsule's own, or the
   * panel's way to it (`../capsule/capture-worklet.js`), whose page records the trigger word.
   */
  constructor(
    private readonly send: (samples: Float32Array) => void,
    private readonly worklet = "capture-worklet.js",
    /** Given, the voice's level (0 to 1) for each block heard, for a wave of it. */
    private readonly onLevel?: (level: number) => void,
  ) {}

  /** Opens the microphone (`deviceId`, or the default) and listens until `stop`. A start while it listens starts it afresh. */
  async start(deviceId: string | null): Promise<void> {
    await this.stop();
    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    if (generation !== this.generation) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const context = new AudioContext({ sampleRate: RATE });
    await context.audioWorklet.addModule(new URL(this.worklet, document.baseURI).href);
    if (generation !== this.generation) {
      for (const track of stream.getTracks()) track.stop();
      await context.close().catch(() => undefined);
      return;
    }
    this.stream = stream;
    this.context = context;
    const node = new AudioWorkletNode(context, "capture-processor");
    this.node = node;
    let room = FLOOR; // the room's level, as it settles: it follows the quiet, and rises only slowly with noise
    let before: Float32Array[] = []; // what came just before a span
    let span: Float32Array[] | null = null;
    let spanLength = 0;
    let quiet = 0;
    const end = () => {
      if (span && spanLength - quiet >= SHORTEST) {
        const samples = new Float32Array(spanLength);
        let at = 0;
        for (const block of span) {
          samples.set(block, at);
          at += block.length;
        }
        this.send(samples);
      }
      span = null;
      spanLength = 0;
      quiet = 0;
    };
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const block = event.data;
      let sum = 0;
      for (const v of block) sum += v * v;
      const level = Math.sqrt(sum / Math.max(1, block.length));
      this.onLevel?.(Math.min(1, level * 6)); // the recorder's scale for its wave
      const loud = level > Math.max(FLOOR, room * OVER_ROOM);
      if (!loud) room = room * 0.995 + level * 0.005; // the room's level follows the quiet
      if (span) {
        span.push(block);
        spanLength += block.length;
        quiet = loud ? 0 : quiet + block.length;
        if (quiet >= QUIET_ENDS || spanLength >= LONGEST) end();
      } else if (loud) {
        span = [...before, block];
        spanLength = span.reduce((n, b) => n + b.length, 0);
        quiet = 0;
        before = [];
      } else {
        before.push(block);
        let kept = before.reduce((n, b) => n + b.length, 0);
        while (kept > BEFORE && before.length > 1) kept -= before.shift()!.length;
      }
    };
    context.createMediaStreamSource(stream).connect(node);
  }

  /** Closes the microphone: nothing more is heard or sent. */
  async stop(): Promise<void> {
    this.generation++;
    this.node?.port.close();
    this.node?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    await this.context?.close().catch(() => undefined);
    this.node = null;
    this.stream = null;
    this.context = null;
  }
}
