// Pattern detection engine.
//
// Strategy:
//  - DTW template matching for shape similarity
//  - Geometric sanity checks per pattern kind (reject false DTW matches)
//  - Composite scoring: 0.55*DTW + 0.20*volumeConfirm + 0.15*trendAlign + 0.10*RVOL
//
// Returns matches sorted by composite score, capped at MAX_RESULTS.

import { similarity, resample, normalizeSeries } from "./dtw";
import { TEMPLATES } from "./templates";
import type { Candle, PatternKind, PatternMatch } from "./types";
import { PATTERN_LABELS } from "./types";

export interface DetectOptions {
  minScore?: number;          // DTW threshold (raw similarity)
  windows?: number[];
  only?: PatternKind;
  customTemplate?: number[];
  /** Optional context for composite scoring */
  recentRvol?: number;        // current RVOL of the ticker (1.0 default)
}

const DEFAULTS: Required<Pick<DetectOptions, "minScore" | "windows">> = {
  minScore: 0.72,
  windows: [30, 45, 60, 80],
};

const closes = (cs: Candle[]) => cs.map((c) => c.c);

function bestForTemplate(
  series: number[],
  template: number[],
  windows: number[],
): { score: number; startIdx: number; endIdx: number } {
  let best = { score: 0, startIdx: 0, endIdx: 0 };
  const n = series.length;
  for (const w of windows) {
    if (w > n) continue;
    const step = Math.max(1, Math.floor(w * 0.05));
    for (let start = 0; start + w <= n; start += step) {
      const window = series.slice(start, start + w);
      const s = similarity(template, window);
      if (s > best.score) best = { score: s, startIdx: start, endIdx: start + w - 1 };
    }
  }
  return best;
}

/**
 * Volume confirmation: did volume increase on the breakout bar (last bar of
 * pattern window) vs average volume across the pattern? Bullish patterns want
 * an up-bar with vol spike; bearish patterns want a down-bar with vol spike.
 */
function volumeConfirmation(candles: Candle[], start: number, end: number, bullish: boolean): number {
  const window = candles.slice(start, end + 1);
  if (window.length < 3) return 0.5;
  const avgVol = window.reduce((s, c) => s + c.v, 0) / window.length;
  const last = window[window.length - 1];
  if (avgVol <= 0) return 0.5;
  const volRatio = Math.min(3, last.v / avgVol); // cap 3x
  const directional = bullish ? last.c >= last.o : last.c <= last.o;
  const base = (volRatio - 1) / 2; // -0.5..1
  return Math.max(0, Math.min(1, base + (directional ? 0.2 : -0.1)));
}

/**
 * Trend alignment: does the pattern's expected direction match the
 * higher-context trend (50-bar SMA slope before the pattern)?
 */
function trendAlignment(candles: Candle[], start: number, bullish: boolean): number {
  const lookback = Math.min(50, start);
  if (lookback < 10) return 0.5;
  const seg = candles.slice(start - lookback, start).map((c) => c.c);
  const first = seg.slice(0, Math.floor(lookback / 3)).reduce((a, b) => a + b, 0) / Math.floor(lookback / 3);
  const last = seg.slice(-Math.floor(lookback / 3)).reduce((a, b) => a + b, 0) / Math.floor(lookback / 3);
  const slope = (last - first) / first; // % change
  // Reversal patterns want opposing prior trend; continuation patterns want same.
  // Here we treat all "bullish" as wanting prior uptrend OR neutral (rough heuristic).
  if (bullish) return slope > -0.02 ? 0.5 + Math.min(0.5, slope * 5) : Math.max(0.2, 0.5 + slope * 5);
  return slope < 0.02 ? 0.5 - Math.min(0.5, slope * 5) : Math.max(0.2, 0.5 - slope * 5);
}

const BULLISH: Record<Exclude<PatternKind, "custom">, boolean> = {
  head_and_shoulders: false,
  inverse_head_and_shoulders: true,
  double_top: false,
  double_bottom: true,
  triple_top: false,
  triple_bottom: true,
  bull_flag: true,
  bear_flag: false,
  ascending_triangle: true,
  descending_triangle: false,
  symmetrical_triangle: true,
  rising_wedge: false,
  falling_wedge: true,
  cup_and_handle: true,
  rounding_bottom: true,
  rectangle: true,
  bullish_pennant: true,
  bearish_pennant: false,
};

/** Geometric sanity checks: reject DTW matches that violate pattern structure. */
function geometricCheck(kind: PatternKind, candles: Candle[], start: number, end: number): boolean {
  const seg = candles.slice(start, end + 1).map((c) => c.c);
  if (seg.length < 6) return false;
  const min = Math.min(...seg);
  const max = Math.max(...seg);
  const range = max - min;
  if (range / min < 0.015) return false; // < 1.5% range = noise

  switch (kind) {
    case "head_and_shoulders": {
      // head must be higher than both shoulders
      const peaks = findPeaks(seg, 3);
      if (peaks.length < 3) return false;
      const [a, b, c] = peaks;
      return seg[b] > seg[a] * 1.02 && seg[b] > seg[c] * 1.02;
    }
    case "inverse_head_and_shoulders": {
      const troughs = findTroughs(seg, 3);
      if (troughs.length < 3) return false;
      const [a, b, c] = troughs;
      return seg[b] < seg[a] * 0.98 && seg[b] < seg[c] * 0.98;
    }
    case "double_top":
    case "double_bottom": {
      const ext = kind === "double_top" ? findPeaks(seg, 2) : findTroughs(seg, 2);
      if (ext.length < 2) return false;
      const diff = Math.abs(seg[ext[0]] - seg[ext[1]]) / seg[ext[0]];
      return diff < 0.04; // peaks within 4%
    }
    default:
      return true;
  }
}

function findPeaks(s: number[], topN: number): number[] {
  const peaks: number[] = [];
  for (let i = 2; i < s.length - 2; i++) {
    if (s[i] > s[i - 1] && s[i] > s[i - 2] && s[i] > s[i + 1] && s[i] > s[i + 2]) {
      peaks.push(i);
    }
  }
  return peaks.sort((a, b) => s[b] - s[a]).slice(0, topN).sort((a, b) => a - b);
}
function findTroughs(s: number[], topN: number): number[] {
  const tr: number[] = [];
  for (let i = 2; i < s.length - 2; i++) {
    if (s[i] < s[i - 1] && s[i] < s[i - 2] && s[i] < s[i + 1] && s[i] < s[i + 2]) {
      tr.push(i);
    }
  }
  return tr.sort((a, b) => s[a] - s[b]).slice(0, topN).sort((a, b) => a - b);
}

function rvolFactor(rvol: number): number {
  // 0.5x → 0, 1x → 0.5, 2x → 1.0, capped
  return Math.max(0, Math.min(1, (rvol - 0.5) / 1.5));
}

function composite(dtw: number, vol: number, trend: number, rvol: number): number {
  return 0.55 * dtw + 0.2 * vol + 0.15 * trend + 0.1 * rvol;
}

export function detectPatterns(candles: Candle[], opts: DetectOptions = {}): PatternMatch[] {
  const { minScore, windows } = { ...DEFAULTS, ...opts };
  if (candles.length < Math.min(...windows)) return [];
  const series = closes(candles);
  const matches: PatternMatch[] = [];
  const rvol = opts.recentRvol ?? 1;
  const rvolF = rvolFactor(rvol);

  if (opts.only === "custom") {
    if (!opts.customTemplate || opts.customTemplate.length < 4) return [];
    const tpl = normalizeSeries(resample(opts.customTemplate, 32));
    const best = bestForTemplate(series, tpl, windows);
    if (best.score >= minScore) {
      // Determine direction from custom template (last vs first)
      const bullish = tpl[tpl.length - 1] > tpl[0];
      const vol = volumeConfirmation(candles, best.startIdx, best.endIdx, bullish);
      const trend = trendAlignment(candles, best.startIdx, bullish);
      matches.push({
        pattern: PATTERN_LABELS.custom,
        score: best.score,
        composite: composite(best.score, vol, trend, rvolF),
        startIdx: best.startIdx,
        endIdx: best.endIdx,
        factors: { dtw: best.score, volume: vol, trend, rvol: rvolF },
      });
    }
    return matches;
  }

  const kinds: PatternKind[] = opts.only
    ? [opts.only]
    : (Object.keys(TEMPLATES) as PatternKind[]);

  for (const kind of kinds) {
    if (kind === "custom") continue;
    const template = TEMPLATES[kind as Exclude<PatternKind, "custom">];
    const best = bestForTemplate(series, template, windows);
    if (best.score < minScore) continue;
    if (!geometricCheck(kind, candles, best.startIdx, best.endIdx)) continue;
    const bullish = BULLISH[kind as Exclude<PatternKind, "custom">];
    const vol = volumeConfirmation(candles, best.startIdx, best.endIdx, bullish);
    const trend = trendAlignment(candles, best.startIdx, bullish);
    matches.push({
      pattern: PATTERN_LABELS[kind],
      score: best.score,
      composite: composite(best.score, vol, trend, rvolF),
      startIdx: best.startIdx,
      endIdx: best.endIdx,
      factors: { dtw: best.score, volume: vol, trend, rvol: rvolF },
      meta: { kind },
    });
  }
  matches.sort((a, b) => b.composite - a.composite);
  return matches;
}

export function bestMatch(candles: Candle[], opts: DetectOptions = {}): PatternMatch | null {
  const m = detectPatterns(candles, opts);
  return m.length > 0 ? m[0] : null;
}
