// Scanner server function with composite scoring + ETFs + RVOL.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchCandlesSafe } from "./yahoo.functions";
import { bestMatch } from "./patterns/detectors";
import { computeRVOL } from "./patterns/rvol";
import { NASDAQ_100, SP500, type TickerInfo } from "./universe";
import { ETFS, SECTOR_ETFS } from "./etfs";
import type { Candle, ScanResult, Timeframe } from "./patterns/types";

const TimeframeSchema = z.enum(["5m", "15m", "1h", "4h", "1d", "1w"]);
const PatternKindSchema = z.enum([
  "head_and_shoulders",
  "inverse_head_and_shoulders",
  "double_top",
  "double_bottom",
  "triple_top",
  "triple_bottom",
  "bull_flag",
  "bear_flag",
  "ascending_triangle",
  "descending_triangle",
  "symmetrical_triangle",
  "rising_wedge",
  "falling_wedge",
  "cup_and_handle",
  "rounding_bottom",
  "rectangle",
  "bullish_pennant",
  "bearish_pennant",
  "custom",
]);

const UniverseSchema = z.enum(["nasdaq100", "sp500", "etfs", "sector_etfs", "watchlist"]);

const ScanSchema = z.object({
  universe: UniverseSchema,
  watchlist: z.array(z.string().min(1).max(10)).max(200).optional(),
  timeframe: TimeframeSchema,
  pattern: PatternKindSchema,
  customTemplate: z.array(z.number()).max(500).optional(),
  minScore: z.number().min(0).max(1).default(0.72),
  minComposite: z.number().min(0).max(1).default(0.75),
  includePrePost: z.boolean().default(false),
  filters: z
    .object({
      minPrice: z.number().min(0).optional(),
      maxPrice: z.number().min(0).optional(),
      minAvgVolume: z.number().min(0).optional(),
      minRvol: z.number().min(0).optional(),
      minAtrPct: z.number().min(0).optional(),
    })
    .optional(),
  limit: z.number().min(1).max(200).default(150),
  /** Max results returned (after sort). Default 20 for high-signal output. */
  maxResults: z.number().min(1).max(60).default(20),
});

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

const avg = (nums: number[]) =>
  nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;

/** ATR% over last `period` bars (Wilder TR avg / last close * 100). */
function atrPct(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const slice = candles.slice(-(period + 1));
  let sumTR = 0;
  for (let i = 1; i < slice.length; i++) {
    const cur = slice[i], prev = slice[i - 1];
    const tr = Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prev.c),
      Math.abs(cur.l - prev.c),
    );
    sumTR += tr;
  }
  const atr = sumTR / period;
  const last = slice[slice.length - 1].c;
  return last > 0 ? (atr / last) * 100 : 0;
}

function resolveUniverse(
  u: z.infer<typeof UniverseSchema>,
  watchlist?: string[],
): TickerInfo[] {
  switch (u) {
    case "nasdaq100": return NASDAQ_100;
    case "sp500": return SP500;
    case "etfs": return ETFS;
    case "sector_etfs": return SECTOR_ETFS;
    case "watchlist":
      return (watchlist ?? []).map((s) => ({ symbol: s.toUpperCase(), name: s.toUpperCase() }));
  }
}

export const runScan = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ScanSchema.parse(d))
  .handler(async ({ data }) => {
    const universe = resolveUniverse(data.universe, data.watchlist);
    if (universe.length === 0) return { results: [], fetched: 0, errors: 0 };

    const tickers = universe.slice(0, data.limit);
    let errors = 0;

    const scanned = await mapWithConcurrency(tickers, 8, async (t) => {
      const candles = await fetchCandlesSafe(t.symbol, data.timeframe as Timeframe, data.includePrePost);
      if (!candles || candles.length < 30) {
        errors++;
        return null;
      }
      const rvol = computeRVOL(candles, data.timeframe as Timeframe);
      const match = bestMatch(candles, {
        only: data.pattern,
        customTemplate: data.customTemplate,
        minScore: data.minScore,
        recentRvol: rvol,
      });
      if (!match) return null;
      if (match.composite < data.minComposite) return null;

      const last = candles[candles.length - 1];
      const prev = candles[candles.length - 2] ?? last;
      const lastPrice = last.c;
      const changePct = ((last.c - prev.c) / prev.c) * 100;
      const avgVolume = avg(candles.slice(-20).map((c) => c.v));

      const f = data.filters;
      const atrP = f?.minAtrPct != null ? atrPct(candles) : 0;
      if (f) {
        if (f.minPrice != null && lastPrice < f.minPrice) return null;
        if (f.maxPrice != null && lastPrice > f.maxPrice) return null;
        if (f.minAvgVolume != null && avgVolume < f.minAvgVolume) return null;
        if (f.minRvol != null && rvol < f.minRvol) return null;
        if (f.minAtrPct != null && atrP < f.minAtrPct) return null;
      }

      const result: ScanResult = {
        symbol: t.symbol,
        name: t.name,
        timeframe: data.timeframe as Timeframe,
        match,
        lastPrice,
        changePct,
        avgVolume,
        rvol,
        candles: candles.slice(-100) as Candle[],
      };
      return result;
    });

    const results = scanned
      .filter((r): r is ScanResult => r !== null)
      .sort((a, b) => b.match.composite - a.match.composite)
      .slice(0, data.maxResults);

    return { results, fetched: tickers.length, errors };
  });

/**
 * "Find Similar" scan: uses the last N closes of a source symbol as a custom
 * template, then scans the universe for similar shapes on the same timeframe.
 */
const FindSimilarSchema = z.object({
  sourceSymbol: z.string().min(1).max(10),
  timeframe: TimeframeSchema,
  universe: UniverseSchema,
  watchlist: z.array(z.string().min(1).max(10)).max(200).optional(),
  bars: z.number().min(20).max(200).default(80),
  minComposite: z.number().min(0).max(1).default(0.7),
  maxResults: z.number().min(1).max(40).default(20),
});

export const findSimilar = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => FindSimilarSchema.parse(d))
  .handler(async ({ data }) => {
    const sourceCandles = await fetchCandlesSafe(data.sourceSymbol, data.timeframe as Timeframe);
    if (!sourceCandles || sourceCandles.length < 20) {
      return { results: [], fetched: 0, errors: 1, template: [] as number[] };
    }
    const useBars = Math.min(data.bars, sourceCandles.length);
    const template = sourceCandles.slice(-useBars).map((c) => c.c);

    const universe = resolveUniverse(data.universe, data.watchlist).filter(
      (t) => t.symbol !== data.sourceSymbol.toUpperCase(),
    );
    let errors = 0;
    const scanned = await mapWithConcurrency(universe, 8, async (t) => {
      const candles = await fetchCandlesSafe(t.symbol, data.timeframe as Timeframe);
      if (!candles || candles.length < 30) {
        errors++;
        return null;
      }
      const rvol = computeRVOL(candles, data.timeframe as Timeframe);
      const match = bestMatch(candles, {
        only: "custom",
        customTemplate: template,
        minScore: 0.6,
        recentRvol: rvol,
      });
      if (!match || match.composite < data.minComposite) return null;
      const last = candles[candles.length - 1];
      const prev = candles[candles.length - 2] ?? last;
      const result: ScanResult = {
        symbol: t.symbol,
        name: t.name,
        timeframe: data.timeframe as Timeframe,
        match: { ...match, pattern: `Similar to ${data.sourceSymbol}` },
        lastPrice: last.c,
        changePct: ((last.c - prev.c) / prev.c) * 100,
        avgVolume: avg(candles.slice(-20).map((c) => c.v)),
        rvol,
        candles: candles.slice(-100) as Candle[],
      };
      return result;
    });

    const results = scanned
      .filter((r): r is ScanResult => r !== null)
      .sort((a, b) => b.match.composite - a.match.composite)
      .slice(0, data.maxResults);
    return { results, fetched: universe.length, errors, template };
  });
