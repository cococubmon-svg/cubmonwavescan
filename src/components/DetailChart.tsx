import { useMemo, useState } from "react";
import type { Candle, PatternMatch, Timeframe } from "@/lib/patterns/types";

interface DetailChartProps {
  candles: Candle[];
  match?: PatternMatch | null;
  height?: number;
  /** Override timeframe selector (per-chart). */
  timeframe?: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
  linkedToGlobal?: boolean;
  onToggleLink?: () => void;
  loading?: boolean;
}

const TF_OPTIONS: Timeframe[] = ["5m", "15m", "1h", "4h", "1d", "1w"];

export function DetailChart({
  candles,
  match,
  height = 360,
  timeframe,
  onTimeframeChange,
  linkedToGlobal,
  onToggleLink,
  loading,
}: DetailChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  const { items, hi, lo, w, h } = useMemo(() => {
    const w = Math.max(800, candles.length * 8);
    const h = height;
    if (candles.length === 0) return { items: [], hi: 0, lo: 0, w, h };
    const hi = Math.max(...candles.map((c) => c.h));
    const lo = Math.min(...candles.map((c) => c.l));
    const range = hi - lo || 1;
    const candleW = Math.max(2, (w - 16) / candles.length - 1);
    const items = candles.map((c, i) => {
      const x = 8 + i * ((w - 16) / candles.length);
      const yHigh = ((hi - c.h) / range) * (h - 20) + 10;
      const yLow = ((hi - c.l) / range) * (h - 20) + 10;
      const yOpen = ((hi - c.o) / range) * (h - 20) + 10;
      const yClose = ((hi - c.c) / range) * (h - 20) + 10;
      return { x, yHigh, yLow, yOpen, yClose, up: c.c >= c.o, candleW, c };
    });
    return { items, hi, lo, w, h };
  }, [candles, height]);

  const matchX1 = match && items.length ? items[match.startIdx]?.x ?? 0 : 0;
  const matchX2 = match && items.length
    ? (items[match.endIdx]?.x ?? items[items.length - 1].x) + (items[0]?.candleW ?? 0)
    : 0;

  const hoverCandle = hover != null ? candles[hover] : null;

  return (
    <div className="bg-panel-2/40 rounded-lg overflow-hidden">
      {/* Toolbar */}
      {(onTimeframeChange || onToggleLink) && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-wrap">
          {onTimeframeChange && (
            <div className="flex gap-0.5 bg-panel-2 rounded-md p-0.5">
              {TF_OPTIONS.map((t) => (
                <button
                  key={t}
                  onClick={() => onTimeframeChange(t)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                    timeframe === t
                      ? "bg-brand text-brand-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          {onToggleLink && (
            <button
              onClick={onToggleLink}
              title={linkedToGlobal ? "Linked to global timeframe" : "Independent timeframe"}
              className={`text-[10px] font-mono px-2 py-1 rounded ring-1 transition-colors ${
                linkedToGlobal
                  ? "bg-brand/10 text-brand ring-brand/30"
                  : "bg-panel-2 text-muted-foreground ring-border hover:text-foreground"
              }`}
            >
              {linkedToGlobal ? "🔗 LINKED" : "⛓️‍💥 INDEP"}
            </button>
          )}
          {hoverCandle && (
            <div className="ml-auto font-mono text-[10px] text-muted-foreground flex gap-3">
              <span>O <span className="text-foreground">{hoverCandle.o.toFixed(2)}</span></span>
              <span>H <span className="text-foreground">{hoverCandle.h.toFixed(2)}</span></span>
              <span>L <span className="text-foreground">{hoverCandle.l.toFixed(2)}</span></span>
              <span>C <span className="text-foreground">{hoverCandle.c.toFixed(2)}</span></span>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid place-items-center" style={{ height }}>
          <span className="text-xs text-muted-foreground font-mono animate-pulse">LOADING…</span>
        </div>
      ) : candles.length === 0 ? (
        <div className="grid place-items-center" style={{ height }}>
          <span className="text-xs text-muted-foreground font-mono">NO_DATA</span>
        </div>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <svg width={w} height={h} className="block" onMouseLeave={() => setHover(null)}>
            {[0.25, 0.5, 0.75].map((p) => {
              const y = 10 + p * (h - 20);
              const val = hi - p * (hi - lo);
              return (
                <g key={p}>
                  <line x1="0" x2={w} y1={y} y2={y} stroke="var(--color-border)" strokeOpacity="0.4" strokeDasharray="2 4" />
                  <text x={w - 4} y={y - 2} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill="var(--color-muted-foreground)">
                    {val.toFixed(2)}
                  </text>
                </g>
              );
            })}

            {match && (
              <rect
                x={matchX1}
                y={6}
                width={Math.max(2, matchX2 - matchX1)}
                height={h - 12}
                fill="var(--color-brand)"
                fillOpacity="0.08"
                stroke="var(--color-brand)"
                strokeOpacity="0.4"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
            )}

            {items.map((it, i) => {
              const color = it.up ? "var(--color-bull)" : "var(--color-bear)";
              const yBodyTop = Math.min(it.yOpen, it.yClose);
              const bodyH = Math.max(1, Math.abs(it.yClose - it.yOpen));
              return (
                <g key={i} onMouseEnter={() => setHover(i)}>
                  <line x1={it.x + it.candleW / 2} x2={it.x + it.candleW / 2} y1={it.yHigh} y2={it.yLow} stroke={color} strokeWidth="1" />
                  <rect x={it.x} y={yBodyTop} width={it.candleW} height={bodyH} fill={color} />
                  <rect x={it.x - 1} y={0} width={it.candleW + 2} height={h} fill="transparent" />
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
