// Something taken away turns to dust, as a deleted message does in Telegram: a front sweeps across it from the left, what it passes
// is gone, and from the front grains of its colours lift and drift off up and to the right, thinning out, until nothing is left.

/** How long the front takes to cross, and the longest a grain lives after it leaves. */
const SWEEP_MS = 650;
const GRAIN_LIFE_MS = 750;
/** A grain's size, in CSS pixels, and how many leave each pixel of the front's height per frame. */
const GRAIN = 2;
const DENSITY = 0.55;

interface Grain {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  color: string;
}

/**
 * `el` turns to dust over `canvas` (which covers it, with room around it for the grains to drift into: `pad` CSS pixels each side),
 * in `colors`. The element's own `--_wipe` (0% to 100%) says how far the front has gone, for its mask. `done` is called once the
 * last grain has gone. Returns a function that stops it early.
 */
export function disintegrate(el: HTMLElement, canvas: HTMLCanvasElement, colors: readonly string[], pad: number, done: () => void): () => void {
  const ratio = window.devicePixelRatio || 1;
  const box = el.getBoundingClientRect();
  const width = box.width + pad * 2;
  const height = box.height + pad * 2;
  canvas.width = Math.ceil(width * ratio);
  canvas.height = Math.ceil(height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    done();
    return () => {};
  }
  ctx.scale(ratio, ratio);
  const grains: Grain[] = [];
  const start = performance.now();
  let frame = 0;
  let stopped = false;
  const step = (now: number) => {
    if (stopped) return;
    const t = now - start;
    const sweep = Math.min(1, t / SWEEP_MS);
    // The front eases out, quick at first and slower as it reaches the end, as a breath of wind does.
    const front = 1 - Math.pow(1 - sweep, 2);
    el.style.setProperty("--_wipe", `${(front * 100).toFixed(2)}%`);
    if (sweep < 1) {
      const x = pad + front * box.width;
      const count = Math.round(box.height * DENSITY);
      for (let i = 0; i < count; i++) {
        grains.push({
          x: x - Math.random() * 6,
          y: pad + Math.random() * box.height,
          vx: 0.04 + Math.random() * 0.12,
          vy: -(0.02 + Math.random() * 0.1),
          born: now,
          life: GRAIN_LIFE_MS * (0.45 + Math.random() * 0.55),
          color: colors[Math.floor(Math.random() * colors.length)] ?? "#888",
        });
      }
    }
    ctx.clearRect(0, 0, width, height);
    for (let i = grains.length - 1; i >= 0; i--) {
      const g = grains[i]!;
      const age = now - g.born;
      if (age > g.life) {
        grains.splice(i, 1);
        continue;
      }
      const k = age / g.life;
      // Each grain drifts on, picking up a little lift and a little wobble, and fades and shrinks as it goes.
      const x = g.x + g.vx * age + Math.sin((g.born + age) / 90) * 1.2;
      const y = g.y + g.vy * age - 0.00004 * age * age;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = g.color;
      const size = GRAIN * (1 - k * 0.5);
      ctx.fillRect(x, y, size, size);
    }
    ctx.globalAlpha = 1;
    if (sweep >= 1 && grains.length === 0) {
      done();
      return;
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
  };
}
