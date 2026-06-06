// Dynamic Time Warping with Sakoe-Chiba band for sub-quadratic matching.
// Used to compare a user-drawn template (normalized 0..1) against a normalized
// price window.

export function normalizeSeries(series: number[]): number[] {
  if (series.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of series) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range === 0) return series.map(() => 0.5);
  return series.map((v) => (v - min) / range);
}

// Resample a series to exactly `n` points using linear interpolation.
export function resample(series: number[], n: number): number[] {
  if (series.length === 0) return new Array(n).fill(0);
  if (series.length === 1) return new Array(n).fill(series[0]);
  const out = new Array(n);
  const step = (series.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    const idx = i * step;
    const lo = Math.floor(idx);
    const hi = Math.min(series.length - 1, lo + 1);
    const t = idx - lo;
    out[i] = series[lo] * (1 - t) + series[hi] * t;
  }
  return out;
}

/**
 * DTW distance with Sakoe-Chiba band of width `band` (default 10% of n).
 * Both series must be normalized to comparable ranges.
 */
export function dtwDistance(a: number[], b: number[], band?: number): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return Infinity;
  const w = Math.max(band ?? Math.ceil(Math.max(n, m) * 0.1), Math.abs(n - m));

  const INF = Number.POSITIVE_INFINITY;
  // Two-row rolling array
  let prev = new Array<number>(m + 1).fill(INF);
  let curr = new Array<number>(m + 1).fill(INF);
  prev[0] = 0;

  for (let i = 1; i <= n; i++) {
    curr[0] = INF;
    const jStart = Math.max(1, i - w);
    const jEnd = Math.min(m, i + w);
    // reset cells outside window
    for (let j = 0; j <= m; j++) if (j < jStart || j > jEnd) curr[j] = INF;
    for (let j = jStart; j <= jEnd; j++) {
      const cost = Math.abs(a[i - 1] - b[j - 1]);
      const best = Math.min(prev[j], curr[j - 1], prev[j - 1]);
      curr[j] = cost + best;
    }
    [prev, curr] = [curr, prev];
  }
  const d = prev[m];
  return Number.isFinite(d) ? d : INF;
}

/**
 * Score similarity in [0,1] for two normalized series (after resampling to same length).
 * 1 means identical.
 */
export function similarity(template: number[], window: number[]): number {
  const n = Math.max(template.length, window.length, 32);
  const a = normalizeSeries(resample(template, n));
  const b = normalizeSeries(resample(window, n));
  const d = dtwDistance(a, b);
  // Worst-case DTW distance for two 0..1 series of length n is ~n.
  const norm = d / n;
  return Math.max(0, 1 - norm);
}
