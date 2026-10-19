// Microphone → 16 kHz mono float samples, plus a loudness level for the waveform.

export class Recorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];

  constructor(private readonly onLevel: (level: number) => void) {}

  async start(deviceId: string | null): Promise<void> {
    this.chunks = [];
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: false, noiseSuppression: false },
    });
    this.context = new AudioContext({ sampleRate: 16000 });
    await this.context.audioWorklet.addModule(new URL("capture-worklet.js", document.baseURI).href);
    const source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, "capture-processor");
    let sum = 0;
    let count = 0;
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
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

  /** Stops the microphone and returns everything recorded since start. */
  async stop(): Promise<Float32Array> {
    const chunks = this.chunks;
    await this.release();
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      samples.set(c, offset);
      offset += c.length;
    }
    return samples;
  }

  async cancel(): Promise<void> {
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
