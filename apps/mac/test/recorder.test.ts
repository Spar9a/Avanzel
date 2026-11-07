import { afterEach, describe, expect, it, vi } from "vitest";
import { Recorder } from "../src/renderer/capsule/recorder.ts";

/** Just enough of the browser's media APIs; the microphone opens when the test says so. */
function fakeMedia() {
  const released: string[] = [];
  const nodes: { port: { onmessage: ((event: { data: Float32Array }) => void) | null } }[] = [];
  let open: () => void = () => undefined;
  const stream = { getTracks: () => [{ stop: () => released.push("microphone") }] };
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: () => new Promise((resolve) => (open = () => resolve(stream))) },
  });
  vi.stubGlobal("document", { baseURI: "file:///capsule/" });
  vi.stubGlobal("AudioContext", class {
    audioWorklet = { addModule: async () => undefined };
    createMediaStreamSource() {
      return { connect: () => undefined };
    }
    async close() {
      released.push("audio context");
    }
  });
  vi.stubGlobal("AudioWorkletNode", class {
    port = { onmessage: null, close: () => undefined };
    constructor() {
      nodes.push(this);
    }
    disconnect() {}
  });
  /** The microphone hears `block`, as the capture worklet would post it. */
  const hear = (block: Float32Array) => nodes.at(-1)!.port.onmessage!({ data: block });
  return { released, open: () => open(), hear };
}

describe("recorder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives what is new each time it is asked, and still the whole recording at the stop", async () => {
    const media = fakeMedia();
    const recorder = new Recorder(() => undefined);
    const starting = recorder.start(null);
    media.open();
    await starting;
    media.hear(Float32Array.of(1, 2));
    media.hear(Float32Array.of(3));
    expect([...recorder.fresh()]).toEqual([1, 2, 3]);
    expect([...recorder.fresh()]).toEqual([]);
    media.hear(Float32Array.of(4));
    expect([...recorder.fresh()]).toEqual([4]);
    media.hear(Float32Array.of(5));
    expect([...(await recorder.stop())]).toEqual([1, 2, 3, 4, 5]);
  });

  it("starts the next recording's new audio from nothing", async () => {
    const media = fakeMedia();
    const recorder = new Recorder(() => undefined);
    const first = recorder.start(null);
    media.open();
    await first;
    media.hear(Float32Array.of(1, 2));
    recorder.fresh();
    await recorder.stop();
    const second = recorder.start(null);
    media.open();
    await second;
    media.hear(Float32Array.of(9));
    expect([...recorder.fresh()]).toEqual([9]);
    await recorder.cancel();
    expect([...recorder.fresh()]).toEqual([]);
  });

  it("lets go of a microphone that opens only after the recording was cancelled", async () => {
    const media = fakeMedia();
    const recorder = new Recorder(() => undefined);
    const starting = recorder.start(null);
    await recorder.cancel();
    media.open();
    await starting;
    expect(media.released).toContain("microphone");
  });

  it("lets go of a microphone that opens only after the recording was stopped", async () => {
    const media = fakeMedia();
    const recorder = new Recorder(() => undefined);
    const starting = recorder.start(null);
    expect(await recorder.stop()).toHaveLength(0);
    media.open();
    await starting;
    expect(media.released).toContain("microphone");
  });

  it("releases the microphone and the audio context when cancelled while recording", async () => {
    const media = fakeMedia();
    const recorder = new Recorder(() => undefined);
    const starting = recorder.start(null);
    media.open();
    await starting;
    await recorder.cancel();
    expect(media.released).toEqual(["microphone", "audio context"]);
  });

  it("drains what it holds in blocks, and stop gives what came after the last drain", async () => {
    const media = fakeMedia();
    const recorder = new Recorder(() => undefined);
    const starting = recorder.start(null);
    media.open();
    await starting;
    media.hear(new Float32Array([0.1, 0.2]));
    media.hear(new Float32Array([0.3]));
    expect(Array.from(recorder.drain())).toEqual([0.1, 0.2, 0.3].map(Math.fround));
    expect(recorder.drain()).toHaveLength(0);
    media.hear(new Float32Array([0.4]));
    expect(Array.from(await recorder.stop())).toEqual([Math.fround(0.4)]);
  });
});
