// Yahoo Finance free-tier data layer.

import { createServerFn } from "@tanstack/react-start";
import type { Candle, Timeframe } from "./patterns/types";

const CACHE_TTL_MS: Record<Timeframe, number> = {
  "5m": 60_000,
  "15m": 3 * 60_000,
  "1h": 10 * 60_000,
  "4h": 30 * 60_000,
  "1d": 60 * 60_000,
  "1w": 6 * 60 * 60_000,
};

const RANGE_FOR: Record<Timeframe, string> = {
  "5m": "5d",
  "15m": "1mo",
  "1h": "3mo",
  "4h": "6mo",
  "1d": "1y",
  "1w": "5y",
};

const YAHOO_INTERVAL: Record<Timeframe, string> = {
  "5m": "5m",
  "15m": "15m",
  "1h": "60m",
  "4h": "60m",
  "1d": "1d",
  "1w": "1wk",
};

interface CacheEntry {
  expires: number;
  candles: Candle[];
}
const cache = new Map<string, CacheEntry>();

function cacheKey(symbol: string, tf: Timeframe, includePrePost: boolean) {
  return `${symbol}|${tf}|${includePrePost ? "ext" : "rth"}`;
}

function aggregate(candles: Candle[], factor: number): Candle[] {
  if (factor <= 1) return candles;
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (chunk.length === 0) continue;
    out.push({
      t: chunk[0].t,
      o: chunk[0].o,
      h: Math.max(...chunk.map((c) => c.h)),
      l: Math.min(...chunk.map((c) => c.l)),
      c: chunk[chunk.length - 1].c,
      v: chunk.reduce((s, c) => s + c.v, 0),
    });
  }
  return out;
}

async function fetchYahoo(symbol: string, tf: Timeframe, includePrePost = false): Promise<Candle[]> {
  const key = cacheKey(symbol, tf, includePrePost);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.candles;

  const interval = YAHOO_INTERVAL[tf];
  const range = RANGE_FOR[tf];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=${interval}&range=${range}&includePrePost=${includePrePost}&events=div%2Csplits`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; WaveScan/1.0; +https://lovable.dev)",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo ${res.status} for ${symbol}`);
  const json = (await res.json()) as YahooResponse;
  const result = json?.chart?.result?.[0];
  if (!result || !result.timestamp) throw new Error(`No data for ${symbol}`);
  const ts = result.timestamp;
  const q = result.indicators?.quote?.[0];
  if (!q) throw new Error(`No quote data for ${symbol}`);

  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    const v = q.volume?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ t: ts[i], o, h, l, c, v: v ?? 0 });
  }

  const final = tf === "4h" ? aggregate(candles, 4) : candles;
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS[tf], candles: final });
  return final;
}

interface YahooResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: { code: string; description: string } | null;
  };
}

export const getCandles = createServerFn({ method: "GET" })
  .inputValidator((data: { symbol: string; timeframe: Timeframe; includePrePost?: boolean }) => data)
  .handler(async ({ data }) => {
    try {
      const candles = await fetchYahoo(data.symbol, data.timeframe, data.includePrePost ?? false);
      return { candles, error: null as string | null };
    } catch (err) {
      console.error("getCandles failed", data.symbol, err);
      return { candles: [] as Candle[], error: (err as Error).message };
    }
  });

export async function fetchCandlesSafe(
  symbol: string,
  tf: Timeframe,
  includePrePost = false,
): Promise<Candle[] | null> {
  try {
    return await fetchYahoo(symbol, tf, includePrePost);
  } catch {
    return null;
  }
}
