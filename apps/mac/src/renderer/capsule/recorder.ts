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

export class Recorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
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

  async start(deviceId: string | null): Promise<void> {
    const generation = ++this.generation;
    this.paused = false;
    const overtaken = () => generation !== this.generation; // stopped or cancelled meanwhile
    this.chunks = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: false, noiseSuppression: false },
      });
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
    const source = this.context.createMediaStreamSource(this.stream);
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
    source.connect(this.node);
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
    return joined(chunks);
  }

  async cancel(): Promise<void> {
    this.generation++;
    await this.release();
  }

  private async release(): Promise<void> {
    this.node?.port.close();
    this.node?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    await this.context?.close().catch(() => undefined);
    this.node = null;
    this.stream = null;
    this.context = null;
    this.chunks = [];
  }
}
