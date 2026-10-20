import { afterEach, describe, expect, it, vi } from "vitest";
import { Recorder } from "../src/renderer/capsule/recorder.ts";

/** Just enough of the browser's media APIs; the microphone opens when the test says so. */
function fakeMedia() {
  const released: string[] = [];
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
    disconnect() {}
  });
  return { released, open: () => open() };
}

describe("recorder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
