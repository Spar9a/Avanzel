// Recording a part of the screen, for the recording's Add: the person drags out the part over the dimmed screen (Esc gives up), and
// it is recorded at once, the screen cropped to it, until Stop or the time limit; the video goes to main, which puts it on the
// recording's list. This window is kept out of the capture (main's content protection), so its own edge and dim are never in the video.
import "@avanzel/ui/base.css";
import { MarkUp, ScreenArea, type ScreenAreaRect } from "@avanzel/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AreaSetup, AvanzelBridge } from "../../shared/ipc.ts";
import "./styles.css";

declare global {
  interface Window {
    avanzel: AvanzelBridge;
  }
}

const api = window.avanzel.area;

/** A part smaller than this, in points, is a click rather than a drag: it picks nothing. */
const LEAST = 12;
const FPS = 30;

/** The kinds of video this page can write, best first: MPEG-4, which every app opens, then WebM. */
const KINDS = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];

/** "0:07" for 7 seconds. */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/**
 * Records `rect` of the screen `setup` names: the display's stream drawn, cropped, onto a canvas at its own pixels, and the canvas
 * recorded. Resolves with what stops it, which resolves with the video.
 */
async function recordPart(rect: ScreenAreaRect, setup: AreaSetup): Promise<() => Promise<{ video: ArrayBuffer; mime: string }>> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    // Electron's way to a display's stream, by its capture source.
    video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: setup.sourceId } } as unknown as MediaTrackConstraints,
  });
  const source = document.createElement("video");
  source.srcObject = stream;
  source.muted = true;
  await source.play();
  // The stream's pixels to a point of this window, which covers the display.
  const kx = source.videoWidth / window.innerWidth;
  const ky = source.videoHeight / window.innerHeight;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round((rect.width * kx) / 2) * 2); // even sizes: what H.264 takes
  canvas.height = Math.max(2, Math.round((rect.height * ky) / 2) * 2);
  const paint = canvas.getContext("2d");
  const draw = () => paint?.drawImage(source, rect.x * kx, rect.y * ky, rect.width * kx, rect.height * ky, 0, 0, canvas.width, canvas.height);
  draw();
  const frames = setInterval(draw, 1000 / FPS);
  const mime = KINDS.find((kind) => MediaRecorder.isTypeSupported(kind)) ?? "video/webm";
  const recorder = new MediaRecorder(canvas.captureStream(FPS), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start(1000);
  return () =>
    new Promise((resolve) => {
      recorder.onstop = () => {
        clearInterval(frames);
        for (const track of stream.getTracks()) track.stop();
        void new Blob(chunks, { type: mime }).arrayBuffer().then((video) => resolve({ video, mime }));
      };
      recorder.stop();
    });
}

/**
 * `rect` of the screen `setup` names, as a picture at the screen's own pixels: one frame of the display's stream, cropped. This window
 * is out of the capture, so the picture is the screen under it.
 */
async function takePart(rect: ScreenAreaRect, setup: AreaSetup): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: setup.sourceId } } as unknown as MediaTrackConstraints,
  });
  try {
    const source = document.createElement("video");
    source.srcObject = stream;
    source.muted = true;
    await source.play();
    const kx = source.videoWidth / window.innerWidth;
    const ky = source.videoHeight / window.innerHeight;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width * kx));
    canvas.height = Math.max(1, Math.round(rect.height * ky));
    canvas.getContext("2d")?.drawImage(source, rect.x * kx, rect.y * ky, rect.width * kx, rect.height * ky, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("no picture"))), "image/png"));
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

function Area() {
  const [mode, setMode] = useState<AreaSetup["mode"]>("video");
  useEffect(() => {
    void api.get().then((setup) => setup && setMode(setup.mode));
  }, []);
  const [rect, setRect] = useState<ScreenAreaRect | null>(null);
  const [phase, setPhase] = useState<"pick" | "recording" | "saving" | "marking">("pick");
  const [picture, setPicture] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const from = useRef<{ x: number; y: number } | null>(null);
  const stopper = useRef<(() => Promise<{ video: ArrayBuffer; mime: string }>) | null>(null);

  const stop = useCallback(async () => {
    const stopRecording = stopper.current;
    if (!stopRecording) return;
    stopper.current = null;
    setPhase("saving");
    const { video, mime } = await stopRecording();
    if (video.byteLength === 0) console.error("area recording: the recorder gave nothing", mime);
    await api.done(video, mime);
  }, []);

  const start = useCallback(async (picked: ScreenAreaRect) => {
    const setup = await api.get();
    if (!setup) return api.cancel();
    if (setup.mode === "marks") {
      setPhase("saving");
      try {
        setPicture(URL.createObjectURL(await takePart(picked, setup)));
        setPhase("marking");
      } catch (error) {
        console.error("area picture", error);
        api.cancel();
      }
      return;
    }
    try {
      stopper.current = await recordPart(picked, setup);
    } catch (error) {
      console.error("area recording", error);
      return api.cancel();
    }
    setPhase("recording");
    api.setInteractive(false); // only its Stop takes the pointer now (`onBarHover`)
    const began = Date.now();
    const tick = setInterval(() => {
      const now = (Date.now() - began) / 1000;
      setSeconds(now);
      if (now >= setup.maxSeconds) {
        clearInterval(tick);
        void stop();
      }
    }, 250);
  }, [stop]);

  // Esc gives up the picking, and stops a recording, which is kept.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (phase === "pick") api.cancel();
      else if (phase === "recording") void stop();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [phase, stop]);

  const point = (event: React.PointerEvent) => ({ x: event.clientX, y: event.clientY });
  if (phase === "marking" && rect && picture) {
    return (
      <MarkUp
        rect={rect}
        picture={picture}
        onCancel={() => api.cancel()}
        onDone={(png) => void png.arrayBuffer().then((bytes) => api.done(bytes, "image/png"))}
      />
    );
  }
  return (
    <div
      className="area"
      onPointerDown={(event) => {
        if (phase !== "pick") return;
        from.current = point(event);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const a = from.current;
        if (phase !== "pick" || !a) return;
        const b = point(event);
        setRect({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });
      }}
      onPointerUp={() => {
        const picked = rect;
        from.current = null;
        if (phase !== "pick" || !picked) return;
        if (picked.width < LEAST || picked.height < LEAST) return setRect(null);
        void start(picked);
      }}
    >
      <ScreenArea
        rect={rect}
        recording={mode === "video" && phase !== "pick"}
        hint={mode === "marks" ? "Drag over the part of the screen to mark. Esc gives up." : "Drag over the part of the screen to record. Esc gives up."}
        time={clock(seconds)}
        onStop={() => void stop()}
        onBarHover={(over) => api.setInteractive(over)}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Area />);
