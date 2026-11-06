import { useEffect, useRef, type ReactNode } from "react";
import "../foundations.css";
import "./aura.css";

export interface AuraProps {
  /** calm: the lines drift slowly. listening: a recording is on, so the terrain rises and the strands swing with a voice's rhythm. */
  mood?: "calm" | "listening";
  /** Fill at least the height of the place it is in, such as a tab's page, so the aura reaches its bottom. */
  fill?: boolean;
  /** What sits in front of the aura, such as the ways to start something new. */
  children: ReactNode;
}

type Rgb = readonly [number, number, number];

/** How many frames a second the aura draws: enough for slow drifting lines, half the work of the display's own rate. */
const FPS = 30;
/** The canvas's pixels per point at most: thin lines stay sharp, and a Retina display isn't filled at full density. */
const MAX_DPR = 1.5;
/** Lines of the terrain, strands over it, and the step along x between their points, in points. */
const TERRAIN = 24;
const STRANDS = 12;
const STEP = 6;

/** Whether the surface behind the aura is dark, from its window token: lines are added up as light there, and laid on otherwise. */
function onDark(el: HTMLElement): boolean {
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return false;
  probe.fillStyle = "#fff";
  probe.fillStyle = getComputedStyle(el).getPropertyValue("--av-surface-window").trim() || "#fff";
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(probe.fillStyle));
  if (!m) return false;
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => parseInt(x, 16)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/** The colours the aura drifts through, read from the tokens: the brand's violet, People's blue and Memories' purple. */
function palette(el: HTMLElement): Rgb[] {
  const style = getComputedStyle(el);
  const probe = document.createElement("canvas").getContext("2d");
  const read = (name: string): Rgb => {
    if (!probe) return [107, 82, 238];
    probe.fillStyle = "#000";
    probe.fillStyle = style.getPropertyValue(name).trim() || "#000";
    const hex = String(probe.fillStyle);
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [107, 82, 238];
  };
  const violet = read("--av-accent-fill");
  // A lighter violet for the light lines: the brand's, a third of the way to white.
  const lilac: Rgb = [violet[0] + (255 - violet[0]) / 3, violet[1] + (255 - violet[1]) / 3, violet[2] + (255 - violet[2]) / 3];
  return [lilac, read("--av-shelf-people"), read("--av-shelf-memories"), lilac];
}

/** The colour `shift` of the way through the palette's loop, as time moves it along. */
function tint(stops: Rgb[], t: number, shift: number): Rgb {
  const x = ((((t * 0.05 + shift) % 1) + 1) % 1) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i]!;
  const b = stops[i + 1] ?? a;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

const rgba = (c: Rgb, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;

/**
 * Draws one frame: a terrain of lines over the whole height, the far ones at the top, and soft strands fanning over it, their
 * colours drifting through the palette. `v` is how much of a voice there is, 0 to 1. Glow is a second, wide and faint stroke under
 * each strand, never a shadow blur, which costs far more.
 */
function draw(g: CanvasRenderingContext2D, w: number, h: number, t: number, v: number, stops: Rgb[], dark: boolean): void {
  g.clearRect(0, 0, w, h);
  const k = dark ? 1 : 0.7;
  for (let i = 0; i < TERRAIN; i++) {
    const p = i / (TERRAIN - 1);
    const depth = p * p;
    const y0 = h * (0.04 + 0.94 * depth);
    const amp = (3 + 22 * depth) * (1 + 1.2 * v);
    const a = (0.06 + 0.34 * depth) * 0.55 * k;
    const left = tint(stops, t, p * 0.2);
    const right = tint(stops, t, p * 0.2 + 0.33);
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, rgba(left, 0));
    grad.addColorStop(0.3, rgba(left, a));
    grad.addColorStop(0.7, rgba(right, a));
    grad.addColorStop(1, rgba(right, 0));
    g.strokeStyle = grad;
    g.lineWidth = 0.6 + depth;
    g.beginPath();
    for (let x = 0; x <= w + STEP; x += STEP) {
      const y = y0 - Math.abs(Math.sin(x * 0.018 + t * 0.45 + i * 0.5) * Math.sin(x * 0.007 - t * 0.2 + i * 0.3)) * amp;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.globalCompositeOperation = dark ? "lighter" : "source-over";
  for (let i = 0; i < STRANDS; i++) {
    const p = i / (STRANDS - 1);
    const col = tint(stops, t, p * 0.3);
    const a = (0.08 + 0.22 * Math.sin(Math.max(0.15, p) * Math.PI)) * 0.7 * k;
    g.beginPath();
    for (let x = 0; x <= w + STEP; x += STEP) {
      const twist = Math.sin(x * 0.006 + t * 0.4 + p * 1.5);
      const y =
        h * 0.5 +
        (p - 0.5) * h * 0.8 * (0.35 + 0.65 * Math.abs(twist)) +
        Math.sin(x * 0.011 + t * 0.7 + p * 2.2) * (h * 0.05 + h * 0.06 * v) +
        Math.sin(x * 0.023 - t * 1.1 + p * 5) * (5 + 12 * v);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = rgba(col, a * 0.25);
    g.lineWidth = 6;
    g.stroke();
    g.strokeStyle = rgba(col, a);
    g.lineWidth = 1.6;
    g.stroke();
  }
  g.globalCompositeOperation = "source-over";
}

/**
 * A quiet moving background behind a place where a person speaks to Avanzel: a terrain of fine lines over its whole height, and
 * soft strands fanning over it, their colours drifting from violet through blue to purple. It is decoration only: it says nothing,
 * takes no clicks, draws nothing while it is out of sight, and holds still under Reduce Motion.
 */
export function Aura({ mood = "calm", fill, children }: AuraProps) {
  const back = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const listening = useRef(mood === "listening");
  listening.current = mood === "listening";

  useEffect(() => {
    const box = back.current;
    const el = canvas.current;
    const g = el?.getContext("2d", { alpha: true });
    if (!box || !el || !g) return;
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let stops = palette(box);
    let dark = onDark(box);
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;
    let level = listening.current ? 1 : 0;
    let visible = true;
    const start = performance.now();

    const size = () => {
      const rect = box.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = rect.width;
      height = rect.height;
      el.width = Math.max(1, Math.round(width * dpr));
      el.height = Math.max(1, Math.round(height * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const paint = (now: number) => {
      const t = (now - start) / 1000;
      level += ((listening.current ? 1 : 0) - level) * 0.08;
      const voice = level * (0.5 + 0.5 * Math.abs(Math.sin(t * 3.1) * Math.sin(t * 1.7 + 1)));
      draw(g, width, height, t, voice, stops, dark);
    };
    const tick = (now: number) => {
      frame = 0;
      if (!visible || document.hidden || still.matches) return;
      if (now - last >= 1000 / FPS - 2) {
        last = now;
        paint(now);
      }
      frame = requestAnimationFrame(tick);
    };
    const run = () => {
      if (frame || !visible || document.hidden) return;
      if (still.matches) {
        paint(start + 4000); // one resting frame, a little way into the drift
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    const onTheme = () => {
      dark = onDark(box);
      stops = palette(box);
      if (still.matches) paint(start + 4000);
    };

    size();
    const resize = new ResizeObserver(() => {
      size();
      if (still.matches || !frame) paint(performance.now());
    });
    resize.observe(box);
    const seen = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      run();
    });
    seen.observe(box);
    document.addEventListener("visibilitychange", run);
    darkQuery.addEventListener("change", onTheme);
    still.addEventListener("change", run);
    run();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", run);
      darkQuery.removeEventListener("change", onTheme);
      still.removeEventListener("change", run);
    };
  }, []);

  return (
    <div className="av-aura" data-mood={mood} data-fill={fill ? "" : undefined}>
      <div ref={back} className="av-aura-back" aria-hidden="true">
        <canvas ref={canvas} className="av-aura-canvas" />
        <i className="av-aura-veil" />
      </div>
      <div className="av-aura-front">{children}</div>
    </div>
  );
}
