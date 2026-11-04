// A small in-place radix-2 FFT, enough to correlate two sounds (`echoScore` in calls.ts) without a dependency.

/** The cosines and sines of one turn split `size` ways, by size: each size's table is made once. */
const tables = new Map<number, { cos: Float64Array; sin: Float64Array }>();

function table(size: number): { cos: Float64Array; sin: Float64Array } {
  let found = tables.get(size);
  if (!found) {
    const half = size >> 1;
    found = { cos: new Float64Array(half), sin: new Float64Array(half) };
    for (let i = 0; i < half; i++) {
      found.cos[i] = Math.cos((2 * Math.PI * i) / size);
      found.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
    tables.set(size, found);
  }
  return found;
}

/** The smallest power of two at least `n` (1 for n of 1 or less). */
export function nextPow2(n: number): number {
  let size = 1;
  while (size < n) size <<= 1;
  return size;
}

/**
 * The discrete Fourier transform of `re` + i `im` in place (their length a power of two); `inverse` gives the inverse transform,
 * divided by the length.
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) throw new Error(`fft needs two arrays of one power-of-two length, not ${n} and ${im.length}`);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const r = re[i]!;
      re[i] = re[j]!;
      re[j] = r;
      const m = im[i]!;
      im[i] = im[j]!;
      im[j] = m;
    }
  }
  const { cos, sin } = table(n);
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]!;
        const wi = sign * sin[k * step]!;
        const a = start + k;
        const b = a + half;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! / n;
      im[i] = im[i]! / n;
    }
  }
}
