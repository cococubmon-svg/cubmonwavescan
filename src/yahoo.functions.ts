// Yahoo Finance data layer with multi-source fallback.
// Sources tried in order: Yahoo Finance v8, Finnhub, Twelve Data.
// All sources support 15-minute delayed data on free tiers.
//
// SETUP — add these to your Cloudflare Pages environment variables:
//   FINNHUB_KEY    = your key from https://finnhub.io  (free, 60 req/min)
//   TWELVEDATA_KEY = your key from https://twelvedata.com (free, 800 req/day)
// Both keys are optional — if absent the source is skipped.
// Yahoo Finance needs no key but has informal rate limits.

import { createServerFn } from "@tanstack/react-start";
import type { Candle, Timeframe } from "./patterns/types";

// ─── Config ──────────────────────────────────────────────────────────────────

const CACHE_TTL_MS: Record<Timeframe, number> = {
  "5m":  1 * 60_000,
  "15m": 3 * 60_000,
  "1h":  10 * 60_000,
  "4h":  30 * 60_000,
  "1d":  60 * 60_000,
  "1w":  6 * 60 * 60_000,
};

const RANGE_FOR: Record<Timeframe, string> = {
  "5m":  "5d",
  "15m": "1mo",
  "1h":  "3mo",
  "4h":  "6mo",
  "1d":  "2y",
  "1w":  "5y",
};

const YAHOO_INTERVAL: Record<Timeframe, string> = {
  "5m":  "5m",
  "15m": "15m",
  "1h":  "60m",
  "4h":  "60m",
  "1d":  "1d",
  "1w":  "1wk",
};

// Finnhub resolution mapping
const FINNHUB_RES: Record<Timeframe, string> = {
  "5m":  "5",
  "15m": "15",
  "1h":  "60",
  "4h":  "240",
  "1d":  "D",
  "1w":  "W",
};

// Twelve Data interval mapping
const TWELVEDATA_INTERVAL: Record<Timeframe, string> = {
  "5m":  "5min",
  "15m": "15min",
  "1h":  "1h",
  "4h":  "4h",
  "1d":  "1day",
  "1w":  "1week",
};

// How many candles to request per source
const CANDLE_COUNT: Record<Timeframe, number> = {
  "5m":  288,   // ~5 trading days
  "15m": 200,
  "1h":  200,
  "4h":  200,
  "1d":  400,
  "1w":  200,
};

// ─── Cache (in-memory, per Worker instance) ──────────────────────────────────

interface CacheEntry { expires: number; candles: Candle[]; }
const cache = new Map<string, CacheEntry>();

function cacheKey(symbol: string, tf: Timeframe, ext: boolean) {
  return `${symbol}|${tf}|${ext ? "ext" : "rth"}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function aggregate(candles: Candle[], factor: number): Candle[] {
  if (factor <= 1) return candles;
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (!chunk.length) continue;
    out.push({
      t: chunk[0].t,
      o: chunk[0].o,
      h: Math.max(...chunk.map(c => c.h)),
      l: Math.min(...chunk.map(c => c.l)),
      c: chunk[chunk.length - 1].c,
      v: chunk.reduce((s, c) => s + c.v, 0),
    });
  }
  return out;
}

function getEnv(key: string): string {
  try { return (globalThis as unknown as Record<string, string>)[key] ?? ""; }
  catch { return ""; }
}

// ─── Source 1: Yahoo Finance (no key required) ───────────────────────────────

async function fetchYahoo(
  symbol: string,
  tf: Timeframe,
  includePrePost = false,
): Promise<Candle[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${YAHOO_INTERVAL[tf]}&range=${RANGE_FOR[tf]}` +
    `&includePrePost=${includePrePost}&events=div%2Csplits`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; WaveScan/1.0)",
      "Accept": "application/json",
    },
  });

  if (res.status === 429) throw new Error(`Yahoo rate-limited for ${symbol}`);
  if (!res.ok) throw new Error(`Yahoo ${res.status} for ${symbol}`);

  const json = await res.json() as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{
          open?: (number|null)[]; high?: (number|null)[];
          low?: (number|null)[];  close?: (number|null)[];
          volume?: (number|null)[];
        }>};
      }>;
      error?: { code: string; description: string } | null;
    };
  };

  const result = json?.chart?.result?.[0];
  if (!result?.timestamp) throw new Error(`Yahoo: no data for ${symbol}`);

  const ts = result.timestamp!;
  const q  = result.indicators?.quote?.[0];
  if (!q) throw new Error(`Yahoo: no quote data for ${symbol}`);

  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const { open: o, high: h, low: l, close: c, volume: v } =
      { open: q.open?.[i], high: q.high?.[i], low: q.low?.[i],
        close: q.close?.[i], volume: q.volume?.[i] };
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ t: ts[i], o, h, l, c, v: v ?? 0 });
  }

  return tf === "4h" ? aggregate(candles, 4) : candles;
}

// ─── Source 2: Finnhub (free: 60 req/min — needs FINNHUB_KEY env var) ────────

async function fetchFinnhub(
  symbol: string,
  tf: Timeframe,
): Promise<Candle[]> {
  const key = getEnv("FINNHUB_KEY");
  if (!key) throw new Error("Finnhub: no API key configured");

  const now  = Math.floor(Date.now() / 1000);
  const days = tf === "5m" || tf === "15m" ? 7
             : tf === "1h" || tf === "4h"  ? 90
             : tf === "1d"                 ? 730
             : 1825; // 1w
  const from = now - days * 86400;
  const res  = getEnv("FINNHUB_RES") || FINNHUB_RES[tf];

  const url =
    `https://finnhub.io/api/v1/stock/candle` +
    `?symbol=${encodeURIComponent(symbol)}&resolution=${res}` +
    `&from=${from}&to=${now}&token=${key}`;

  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (r.status === 429) throw new Error(`Finnhub rate-limited for ${symbol}`);
  if (!r.ok) throw new Error(`Finnhub ${r.status} for ${symbol}`);

  const json = await r.json() as {
    s: string; t?: number[]; o?: number[]; h?: number[];
    l?: number[]; c?: number[]; v?: number[];
  };

  if (json.s !== "ok" || !json.t?.length) {
    throw new Error(`Finnhub: no data for ${symbol}`);
  }

  const candles: Candle[] = json.t!.map((t, i) => ({
    t,
    o: json.o![i],
    h: json.h![i],
    l: json.l![i],
    c: json.c![i],
    v: json.v?.[i] ?? 0,
  }));

  return tf === "4h" ? aggregate(candles, 4) : candles;
}

// ─── Source 3: Twelve Data (free: 800 req/day — needs TWELVEDATA_KEY env var) ─

async function fetchTwelveData(
  symbol: string,
  tf: Timeframe,
): Promise<Candle[]> {
  const key = getEnv("TWELVEDATA_KEY");
  if (!key) throw new Error("TwelveData: no API key configured");

  const count = CANDLE_COUNT[tf];
  const url =
    `https://api.twelvedata.com/time_series` +
    `?symbol=${encodeURIComponent(symbol)}&interval=${TWELVEDATA_INTERVAL[tf]}` +
    `&outputsize=${count}&apikey=${key}&format=JSON&order=asc`;

  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (r.status === 429) throw new Error(`TwelveData rate-limited for ${symbol}`);
  if (!r.ok) throw new Error(`TwelveData ${r.status} for ${symbol}`);

  const json = await r.json() as {
    status?: string;
    code?: number;
    message?: string;
    values?: Array<{
      datetime: string; open: string; high: string;
      low: string; close: string; volume?: string;
    }>;
  };

  if (json.status === "error" || json.code) {
    throw new Error(`TwelveData: ${json.message ?? "unknown error"} for ${symbol}`);
  }
  if (!json.values?.length) {
    throw new Error(`TwelveData: no data for ${symbol}`);
  }

  const candles: Candle[] = json.values!.map(v => ({
    t: Math.floor(new Date(v.datetime).getTime() / 1000),
    o: parseFloat(v.open),
    h: parseFloat(v.high),
    l: parseFloat(v.low),
    c: parseFloat(v.close),
    v: v.volume ? parseFloat(v.volume) : 0,
  }));

  return tf === "4h" ? aggregate(candles, 4) : candles;
}

// ─── Multi-source fetch with fallback ────────────────────────────────────────

async function fetchWithFallback(
  symbol: string,
  tf: Timeframe,
  includePrePost = false,
): Promise<Candle[]> {
  const key = cacheKey(symbol, tf, includePrePost);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.candles;

  const errors: string[] = [];

  // 1. Try Yahoo Finance first (no key needed, best coverage)
  try {
    const candles = await fetchYahoo(symbol, tf, includePrePost);
    if (candles.length >= 10) {
      cache.set(key, { expires: Date.now() + CACHE_TTL_MS[tf], candles });
      return candles;
    }
  } catch (e) {
    errors.push(`Yahoo: ${(e as Error).message}`);
  }

  // 2. Try Finnhub
  try {
    const candles = await fetchFinnhub(symbol, tf);
    if (candles.length >= 10) {
      cache.set(key, { expires: Date.now() + CACHE_TTL_MS[tf], candles });
      return candles;
    }
  } catch (e) {
    errors.push(`Finnhub: ${(e as Error).message}`);
  }

  // 3. Try Twelve Data
  try {
    const candles = await fetchTwelveData(symbol, tf);
    if (candles.length >= 10) {
      cache.set(key, { expires: Date.now() + CACHE_TTL_MS[tf], candles });
      return candles;
    }
  } catch (e) {
    errors.push(`TwelveData: ${(e as Error).message}`);
  }

  throw new Error(`All sources failed for ${symbol}: ${errors.join(" | ")}`);
}

// ─── Exported server functions (same API as before) ──────────────────────────

export const getCandles = createServerFn({ method: "GET" })
  .inputValidator((data: {
    symbol: string;
    timeframe: Timeframe;
    includePrePost?: boolean;
  }) => data)
  .handler(async ({ data }) => {
    try {
      const candles = await fetchWithFallback(
        data.symbol,
        data.timeframe,
        data.includePrePost ?? false,
      );
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
    return await fetchWithFallback(symbol, tf, includePrePost);
  } catch {
    return null;
  }
}
