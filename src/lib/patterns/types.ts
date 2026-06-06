export interface Candle {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Timeframe = "5m" | "15m" | "1h" | "4h" | "1d" | "1w";

export interface PatternMatch {
  pattern: string;       // human-readable pattern name
  score: number;         // 0..1 raw DTW similarity
  composite: number;     // 0..1 composite quality score
  startIdx: number;      // index in candle array where pattern begins
  endIdx: number;        // index where it ends
  factors?: {
    dtw: number;
    volume: number;
    trend: number;
    rvol: number;
  };
  meta?: Record<string, number | string>;
}

export interface ScanResult {
  symbol: string;
  name: string;
  timeframe: Timeframe;
  match: PatternMatch;
  lastPrice: number;
  changePct: number;
  avgVolume: number;
  rvol: number; // 0+ ; 1.0 = average
  candles: Candle[]; // recent slice for mini-chart
  sector?: string;
}

export type PatternKind =
  | "head_and_shoulders"
  | "inverse_head_and_shoulders"
  | "double_top"
  | "double_bottom"
  | "triple_top"
  | "triple_bottom"
  | "bull_flag"
  | "bear_flag"
  | "ascending_triangle"
  | "descending_triangle"
  | "symmetrical_triangle"
  | "rising_wedge"
  | "falling_wedge"
  | "cup_and_handle"
  | "rounding_bottom"
  | "rectangle"
  | "bullish_pennant"
  | "bearish_pennant"
  | "custom"; // canvas-drawn

export const PATTERN_LABELS: Record<PatternKind, string> = {
  head_and_shoulders: "Head & Shoulders",
  inverse_head_and_shoulders: "Inverse H&S",
  double_top: "Double Top",
  double_bottom: "Double Bottom",
  triple_top: "Triple Top",
  triple_bottom: "Triple Bottom",
  bull_flag: "Bull Flag",
  bear_flag: "Bear Flag",
  ascending_triangle: "Ascending Triangle",
  descending_triangle: "Descending Triangle",
  symmetrical_triangle: "Symmetrical Triangle",
  rising_wedge: "Rising Wedge",
  falling_wedge: "Falling Wedge",
  cup_and_handle: "Cup & Handle",
  rounding_bottom: "Rounding Bottom",
  rectangle: "Rectangle",
  bullish_pennant: "Bullish Pennant",
  bearish_pennant: "Bearish Pennant",
  custom: "Custom Drawing",
};
