// Relative Volume (RVOL) calculator.
//
// RVOL = current cumulative volume / 20-day average cumulative volume
// at the same time-of-day (NY session). This is the industry-standard
// definition used by Trade Ideas / Finviz Elite.
//
// For daily timeframe, RVOL is simply today's volume / 20-day SMA volume.

import type { Candle, Timeframe } from "./types";

const INTRADAY_TF: Timeframe[] = ["5m", "15m", "1h", "4h"];

/** Returns NY-session time-of-day key "HH:MM" for a unix-second timestamp. */
function nySessionKey(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  // toLocaleString with timeZone gives us the NY wall-clock time.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}

function nyDateKey(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Is this timestamp in the NY regular session (09:30–16:00 ET)? */
export function isRegularHoursNY(unixSec: number): boolean {
  const tod = nySessionKey(unixSec);
  return tod >= "09:30" && tod < "16:00";
}

/**
 * Compute current RVOL for the last bar in `candles`.
 *
 * - Intraday: cumulative volume so far today vs average cumulative volume
 *   at the same elapsed point of session over the last 20 trading days.
 * - Daily/weekly: last bar volume vs 20-period SMA.
 */
export function computeRVOL(candles: Candle[], tf: Timeframe): number {
  if (candles.length < 5) return 1;

  if (!INTRADAY_TF.includes(tf)) {
    const last = candles[candles.length - 1];
    const window = candles.slice(-21, -1); // 20 prior bars
    if (window.length === 0) return 1;
    const avg = window.reduce((s, c) => s + c.v, 0) / window.length;
    return avg > 0 ? last.v / avg : 1;
  }

  // Intraday: group by NY date, compute cumulative volume up to current TOD.
  const last = candles[candles.length - 1];
  const lastTOD = nySessionKey(last.t);
  const lastDate = nyDateKey(last.t);

  // Cumulative volume today up to (and including) the last bar.
  let todayCum = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (nyDateKey(candles[i].t) !== lastDate) break;
    todayCum += candles[i].v;
  }

  // Cumulative volume at same TOD for each prior day.
  const byDate = new Map<string, number>();
  for (const c of candles) {
    const date = c.dateKey ?? nyDateKey(c.t);
    if (date === lastDate) continue;
    if (nySessionKey(c.t) > lastTOD) continue;
    byDate.set(date, (byDate.get(date) ?? 0) + c.v);
  }
  const priorCums = [...byDate.values()].slice(-20);
  if (priorCums.length === 0) return 1;
  const avgPrior = priorCums.reduce((a, b) => a + b, 0) / priorCums.length;
  return avgPrior > 0 ? todayCum / avgPrior : 1;
}

// Augment Candle with optional precomputed dateKey (perf hint; not required).
declare module "./types" {
  interface Candle {
    dateKey?: string;
  }
}
