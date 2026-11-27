// Microphone → 16 kHz mono float samples, plus a loudness level for the waveform.

function joined(chunks: readonly Float32Array[]): Float32Array {
  const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    samples.set(c, offset);
    offset += c.length;
  }
  return samples;
}

/** How long a call may be without a microphone before the person is told, once per loss. */
const MIC_LOST_MS = 3_000;

/** What the recorder asks the microphone for: `deviceId` exactly when one is chosen, else the Mac's default. */
function microphone(deviceId: string | null): MediaStreamConstraints {
  return { audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: false, noiseSuppression: false } };
}

/**
 * A call's watch on its microphone (`start` with `keep`): which start it belongs to, the microphone chosen, whom to tell when none
 * comes back, whether a reopen is under way (and whether a change came meanwhile), and the loss's timer while no microphone is open.
 */
type Watch = {
  generation: number;
  deviceId: string | null;
  keep: { lost(): void };
  reopening: boolean;
  again: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

export class Recorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  /** The microphone's way into `node`; a call's reopened microphone gets a new one into the same node. */
  private source: MediaStreamAudioSourceNode | null = null;
  /** Set while a call's recording runs: its microphone is opened again when it ends or goes away. Null for thoughts and dictation. */
  private watch: Watch | null = null;
  private chunks: Float32Array[] = [];
  /** How many of `chunks` have been given out by `fresh`. */
  private given = 0;
  /** Counts starts, stops and cancels: a start overtaken by a stop or cancel lets go of what it opens. */
  private generation = 0;

  /** While paused, the microphone stays open (so resuming is instant) but nothing it hears is kept. */
  private paused = false;

  constructor(private readonly onLevel: (level: number) => void) {}

  pause(): void {
    this.paused = true;
    this.onLevel(0);
  }

  resume(): void {
    this.paused = false;
  }

  /**
   * Opens the microphone `deviceId` (the default one when null) and records until `stop` or `cancel`. With `keep` (a call), a
   * microphone that ends or goes away is opened again into the same recording, the gap kept as silence so the call's two sides stay
   * aligned; `keep.lost()` is called once per loss that lasts MIC_LOST_MS without a microphone. Thoughts and dictation pass no `keep`.
   */
  async start(deviceId: string | null, keep?: { lost(): void }): Promise<void> {
    const generation = ++this.generation;
    this.paused = false;
    const overtaken = () => generation !== this.generation; // stopped or cancelled meanwhile
    this.chunks = [];
    this.given = 0;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(microphone(deviceId));
      if (overtaken()) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stream = stream;
      this.context = new AudioContext({ sampleRate: 16000 });
      await this.context.audioWorklet.addModule(new URL("capture-worklet.js", document.baseURI).href);
    } catch (error) {
      if (overtaken()) return; // whatever opened was released by the stop or cancel; nothing to report
      throw error;
    }
    if (overtaken() || !this.context || !this.stream) return;
    this.source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, "capture-processor");
    let sum = 0;
    let count = 0;
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (this.paused) return; // paused: what the microphone hears now is not kept, and draws no level
      const block = event.data;
      this.chunks.push(block);
      for (const v of block) sum += v * v;
      count += block.length;
      if (count >= 800) {
        // ~50 ms at 16 kHz: report RMS on a perceptual-ish scale
        this.onLevel(Math.min(1, Math.sqrt(sum / count) * 6));
        sum = 0;
        count = 0;
      }
    };
    this.source.connect(this.node);
    if (!keep) return;
    this.watch = { generation, deviceId, keep, reopening: false, again: false, timer: null };
    navigator.mediaDevices.addEventListener("devicechange", this.changed);
    for (const track of this.stream.getTracks()) track.addEventListener("ended", this.changed);
    if (this.stream.getTracks().some((track) => track.readyState === "ended")) this.changed(); // it ended while the worklet loaded
  }

  /** A call's microphone track ended, or the Mac's devices changed: looks again, one look at a time, and once more if one came meanwhile. */
  private readonly changed = (): void => {
    const watch = this.watch;
    if (!watch) return;
    if (watch.reopening) {
      watch.again = true;
      return;
    }
    watch.reopening = true;
    void this.reopen(watch).finally(() => {
      watch.reopening = false;
      if (watch.again && watch === this.watch) {
        watch.again = false;
        this.changed();
      }
    });
  };

  /**
   * Opens the call's microphone again if its track ended or its device is gone: the chosen one if it is still listed, else the
   * default. The new source joins the same worklet before the old one leaves, so the gap is silence (an ended track still feeds
   * zeros) and the call's two sides stay aligned. A failed open waits for the next device change; the loss's timer tells once.
   */
  private async reopen(watch: Watch): Promise<void> {
    const overtaken = () => watch.generation !== this.generation; // stopped or cancelled meanwhile
    const devices = await navigator.mediaDevices.enumerateDevices().then(
      (all) => all.filter((device) => device.kind === "audioinput"),
      () => null, // not known: only an ended track is reopened
    );
    if (overtaken()) return;
    const listed = (id: string | undefined) => devices === null || devices.some((device) => device.deviceId === id);
    const tracks = this.stream?.getTracks() ?? [];
    if (tracks.length > 0 && tracks.every((track) => track.readyState !== "ended" && listed(track.getSettings().deviceId))) return;
    watch.timer ??= setTimeout(() => {
      if (!overtaken()) watch.keep.lost();
    }, MIC_LOST_MS);
    const chosen = watch.deviceId !== null && devices?.some((device) => device.deviceId === watch.deviceId) ? watch.deviceId : null;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(microphone(chosen));
    } catch {
      return; // no microphone yet: the next device change tries again
    }
    if (overtaken() || !this.context || !this.node) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const source = this.context.createMediaStreamSource(stream);
    source.connect(this.node);
    this.source?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) {
      track.removeEventListener("ended", this.changed);
      track.stop();
    }
    this.source = source;
    this.stream = stream;
    for (const track of stream.getTracks()) track.addEventListener("ended", this.changed);
    if (watch.timer) clearTimeout(watch.timer);
    watch.timer = null;
  }

  /** Stops the microphone and returns everything recorded since start, or since the last `drain`. */
  async stop(): Promise<Float32Array> {
    this.generation++;
    const chunks = this.chunks;
    await this.release();
    return joined(chunks);
  }

  /** What was recorded since start, or since the last drain, which it lets go of: a call sends its microphone in such blocks. */
  drain(): Float32Array {
    const chunks = this.chunks;
    this.chunks = [];
    this.given = 0;
    return joined(chunks);
  }

  /** What was recorded since the last `fresh`, which stays for `stop`: a dictation's live words hear it as it comes. */
  fresh(): Float32Array {
    const chunks = this.chunks.slice(this.given);
    this.given = this.chunks.length;
    return joined(chunks);
  }

  async cancel(): Promise<void> {
    this.generation++;
    await this.release();
  }

  private async release(): Promise<void> {
    if (this.watch) {
      if (this.watch.timer) clearTimeout(this.watch.timer);
      navigator.mediaDevices.removeEventListener("devicechange", this.changed);
      for (const track of this.stream?.getTracks() ?? []) track.removeEventListener("ended", this.changed);
      this.watch = null;
    }
    this.node?.port.close();
    this.node?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    await this.context?.close().catch(() => undefined);
    this.node = null;
    this.source = null;
    this.stream = null;
    this.context = null;
    this.chunks = [];
    this.given = 0;
  }
}
