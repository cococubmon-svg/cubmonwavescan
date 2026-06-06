import { useMemo } from "react";
import type { Candle, PatternMatch } from "@/lib/patterns/types";

interface MiniChartProps {
  candles: Candle[];
  match?: PatternMatch | null;
  height?: number;
  highlightColor?: string;
}

/**
 * SVG sparkline-style chart with the matched pattern region highlighted.
 * Deliberately lightweight — no charting library — so we can render dozens
 * in the results grid without jank.
 */
export function MiniChart({
  candles,
  match,
  height = 96,
  highlightColor = "oklch(0.74 0.16 162)",
}: MiniChartProps) {
  const { path, areaPath, hi, lo, points } = useMemo(() => {
    if (candles.length < 2) {
      return { path: "", areaPath: "", hi: 0, lo: 0, points: [] as string[] };
    }
    const closes = candles.map((c) => c.c);
    const hi = Math.max(...closes);
    const lo = Math.min(...closes);
    const range = hi - lo || 1;
    const w = 100;
    const h = 100;
    const pts = closes.map((c, i) => {
      const x = (i / (closes.length - 1)) * w;
      const y = h - ((c - lo) / range) * h;
      return [x, y] as const;
    });
    const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const areaPath = `${path} L${w},${h} L0,${h} Z`;
    return { path, areaPath, hi, lo, points: pts.map(([x, y]) => `${x},${y}`) };
  }, [candles]);

  if (candles.length < 2) {
    return <div style={{ height }} className="bg-zinc-900/50 rounded-md" />;
  }

  // Highlight band for the matched window
  const w = 100;
  const highlightX1 = match ? (match.startIdx / (candles.length - 1)) * w : 0;
  const highlightX2 = match ? (match.endIdx / (candles.length - 1)) * w : 0;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ height, width: "100%", display: "block" }}
      aria-label={`Mini chart, range ${lo.toFixed(2)} to ${hi.toFixed(2)}`}
    >
      <defs>
        <linearGradient id="mc-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={highlightColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={highlightColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      {match && (
        <rect
          x={highlightX1}
          y="0"
          width={Math.max(0.5, highlightX2 - highlightX1)}
          height="100"
          fill={highlightColor}
          fillOpacity="0.08"
          stroke={highlightColor}
          strokeOpacity="0.25"
          strokeWidth="0.3"
        />
      )}
      <path d={areaPath} fill="url(#mc-area)" />
      <path d={path} fill="none" stroke={highlightColor} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
