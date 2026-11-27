import { afterEach, describe, expect, it, vi } from "vitest";
import { Recorder } from "../src/renderer/capsule/recorder.ts";

/** A microphone's track, as far as the recorder uses it: it can end by itself (`end`), as an AirPod taken out does. */
type FakeTrack = {
  readyState: "live" | "ended";
  stopped: boolean;
  listeners: Set<() => void>;
  stop(): void;
  getSettings(): { deviceId: string };
  addEventListener(type: "ended", listener: () => void): void;
  removeEventListener(type: "ended", listener: () => void): void;
  end(): void;
};

/** Just enough of the browser's media APIs; the microphone opens when the test says so, unless `answer` says otherwise. */
function fakeMedia() {
  const released: string[] = [];
  const nodes: { port: { onmessage: ((event: { data: Float32Array }) => void) | null } }[] = [];
  /** Every microphone track opened, in order. */
  const tracks: FakeTrack[] = [];
  /** What each getUserMedia was asked for. */
  const requests: MediaStreamConstraints[] = [];
  /** The microphone sources made, as they were connected and disconnected: "connect 1", "disconnect 1"… */
  const wiring: string[] = [];
  let contexts = 0;
  let devices: { kind: string; deviceId: string }[] = [{ kind: "audioinput", deviceId: "default" }];
  const deviceListeners = new Set<() => void>();
  /** "wait": opens when the test calls `open`; "open": at once; "refuse": no microphone. */
  const answer = { now: "wait" as "wait" | "open" | "refuse" };
  let open: () => void = () => undefined;
  const opened = (constraints: MediaStreamConstraints) => {
    const chosen = (constraints.audio as MediaTrackConstraints).deviceId as { exact: string } | undefined;
    const listeners = new Set<() => void>();
    const track: FakeTrack = {
      readyState: "live",
      stopped: false,
      listeners,
      stop() {
        track.stopped = true;
        track.readyState = "ended";
        released.push("microphone");
      },
      getSettings: () => ({ deviceId: chosen?.exact ?? "default" }),
      addEventListener: (_type, listener) => void listeners.add(listener),
      removeEventListener: (_type, listener) => void listeners.delete(listener),
      end() {
        track.readyState = "ended";
        for (const listener of [...listeners]) listener();
      },
    };
    tracks.push(track);
    return { getTracks: () => [track] };
  };
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: (constraints: MediaStreamConstraints) => {
        requests.push(constraints);
        if (answer.now === "refuse") return Promise.reject(new Error("Requested device not found"));
        if (answer.now === "open") return Promise.resolve(opened(constraints));
        return new Promise((resolve) => (open = () => resolve(opened(constraints))));
      },
      enumerateDevices: async () => devices,
      addEventListener: (_type: "devicechange", listener: () => void) => void deviceListeners.add(listener),
      removeEventListener: (_type: "devicechange", listener: () => void) => void deviceListeners.delete(listener),
    },
  });
  vi.stubGlobal("document", { baseURI: "file:///capsule/" });
  vi.stubGlobal("AudioContext", class {
    audioWorklet = { addModule: async () => undefined };
    constructor() {
      contexts++;
    }
    createMediaStreamSource() {
      const n = wiring.filter((step) => step.startsWith("connect")).length + 1;
      return { connect: () => wiring.push(`connect ${n}`), disconnect: () => wiring.push(`disconnect ${n}`) };
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
  /** The Mac's microphones change to `list`, and the page hears of it. */
  const change = (list: { kind: string; deviceId: string }[]) => {
    devices = list;
    for (const listener of [...deviceListeners]) listener();
  };
  return { released, open: () => open(), hear, tracks, requests, wiring, contexts: () => contexts, nodes, change, deviceListeners, answer };
}

/** Lets the recorder's promises run (they need no timer, so this works with fake timers too). */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("recorder", () => {
  afterEach(() => {
    vi.useRealTimers();
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
  it("a call's microphone that ends is opened again, and what it hears goes on into the same recording", async () => {
    const media = fakeMedia();
    const recorder = new Recorder(() => undefined);
    const starting = recorder.start(null, { lost: () => undefined });
    media.open();
    await starting;
    media.hear(Float32Array.of(1));
    media.tracks[0]!.end();
    await settle();
    media.open();
    await settle();
    media.hear(Float32Array.of(2));
    expect([...(await recorder.stop())]).toEqual([1, 2]);
    expect(media.tracks[0]!.stopped).toBe(true);
    expect(media.requests).toHaveLength(2);
    // the same audio context and worklet; the old source is let go of only once the new one is connected
    expect(media.contexts()).toBe(1);
    expect(media.nodes).toHaveLength(1);
    expect(media.wiring).toEqual(["connect 1", "connect 2", "disconnect 1"]);
  });

  it("a chosen microphone that goes away is replaced by the default one", async () => {
    const media = fakeMedia();
    media.change([
      { kind: "audioinput", deviceId: "default" },
      { kind: "audioinput", deviceId: "airpods" },
    ]);
    const recorder = new Recorder(() => undefined);
    const starting = recorder.start("airpods", { lost: () => undefined });
    media.open();
    await starting;
    media.change([
      { kind: "audioinput", deviceId: "default" },
      { kind: "audioinput", deviceId: "airpods" },
      { kind: "audiooutput", deviceId: "speakers" },
    ]);
    await settle();
    expect(media.requests).toHaveLength(1); // the chosen one is still there: nothing to do
    media.change([{ kind: "audioinput", deviceId: "default" }]);
    await settle();
    expect(media.requests).toHaveLength(2);
    expect((media.requests[0]!.audio as MediaTrackConstraints).deviceId).toEqual({ exact: "airpods" });
    expect((media.requests[1]!.audio as MediaTrackConstraints).deviceId).toBeUndefined();
    media.open();
    await settle();
    expect(media.tracks[0]!.stopped).toBe(true);
    await recorder.cancel();
  });

  it("no microphone for 3 s calls lost once, and a new device brings it back", async () => {
    vi.useFakeTimers();
    const media = fakeMedia();
    const lost = vi.fn();
    const recorder = new Recorder(() => undefined);
    const starting = recorder.start(null, { lost });
    media.open();
    await starting;
    media.hear(Float32Array.of(1));
    media.answer.now = "refuse";
    media.tracks[0]!.end();
    await settle();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(lost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(lost).toHaveBeenCalledTimes(1);
    media.change([]); // still none: the same loss, told once
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lost).toHaveBeenCalledTimes(1);
    media.answer.now = "open";
    media.change([{ kind: "audioinput", deviceId: "default" }]);
    await settle();
    media.hear(Float32Array.of(2));
    expect([...(await recorder.stop())]).toEqual([1, 2]);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it("without keep, nothing is reopened", async () => {
    const media = fakeMedia();
    const recorder = new Recorder(() => undefined);
    const starting = recorder.start(null);
    media.open();
    await starting;
    expect(media.deviceListeners.size).toBe(0);
    expect(media.tracks[0]!.listeners.size).toBe(0);
    media.tracks[0]!.end();
    media.change([]);
    await settle();
    expect(media.requests).toHaveLength(1);
    await recorder.stop();
  });

  it("a stop while reopening lets go of what opens after", async () => {
    const media = fakeMedia();
    const lost = vi.fn();
    const recorder = new Recorder(() => undefined);
    const starting = recorder.start(null, { lost });
    media.open();
    await starting;
    media.hear(Float32Array.of(1));
    media.tracks[0]!.end();
    await settle();
    expect(media.requests).toHaveLength(2);
    expect([...(await recorder.stop())]).toEqual([1]);
    expect(media.deviceListeners.size).toBe(0);
    media.open();
    await settle();
    expect(media.tracks[1]!.stopped).toBe(true);
    expect(media.wiring).toEqual(["connect 1"]);
    expect(lost).not.toHaveBeenCalled();
  });
});
