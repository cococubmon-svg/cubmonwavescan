import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";

export interface PatternCanvasHandle {
  /** Returns normalized y values (0..1, higher = up on chart) sampled across width. */
  getSeries: (samples?: number) => number[];
  clear: () => void;
  hasDrawing: () => boolean;
}

/**
 * Freehand drawing canvas. Stores the user's stroke as a series of (x, y)
 * points and exposes a y-series resampled to N points for DTW matching.
 * Y is flipped so "up on screen = up in price".
 */
export const PatternCanvas = forwardRef<
  PatternCanvasHandle,
  { onChange?: (hasDrawing: boolean) => void; className?: string }
>(function PatternCanvas({ onChange, className }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const drawingRef = useRef(false);
  const [hasDrawing, setHasDrawing] = useState(false);

  const redraw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);

    // Center axis
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, c.height / 2);
    ctx.lineTo(c.width, c.height / 2);
    ctx.stroke();

    const pts = pointsRef.current;
    if (pts.length < 2) return;
    ctx.strokeStyle = "oklch(0.74 0.16 162)";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    // HiDPI scaling
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext("2d");
    ctx?.scale(dpr, dpr);
    // Reset width/height in CSS units for our point math
    redraw();
  }, []);

  const localPoint = (e: PointerEvent | React.PointerEvent) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  useImperativeHandle(ref, () => ({
    getSeries: (samples = 64) => {
      const pts = pointsRef.current;
      if (pts.length < 2) return [];
      const c = canvasRef.current!;
      const rect = c.getBoundingClientRect();
      // Sort by x to ensure monotonic time axis even if user backtracked
      const sorted = [...pts].sort((a, b) => a.x - b.x);
      const out: number[] = [];
      const minX = sorted[0].x;
      const maxX = sorted[sorted.length - 1].x;
      const span = Math.max(1, maxX - minX);
      for (let i = 0; i < samples; i++) {
        const targetX = minX + (i / (samples - 1)) * span;
        // Find surrounding points
        let lo = 0;
        let hi = sorted.length - 1;
        for (let j = 0; j < sorted.length - 1; j++) {
          if (sorted[j].x <= targetX && sorted[j + 1].x >= targetX) {
            lo = j;
            hi = j + 1;
            break;
          }
        }
        const t = (targetX - sorted[lo].x) / Math.max(0.0001, sorted[hi].x - sorted[lo].x);
        const yScreen = sorted[lo].y * (1 - t) + sorted[hi].y * t;
        // Invert: screen y grows downward; price grows upward.
        out.push(1 - yScreen / rect.height);
      }
      return out;
    },
    clear: () => {
      pointsRef.current = [];
      setHasDrawing(false);
      onChange?.(false);
      redraw();
    },
    hasDrawing: () => pointsRef.current.length > 1,
  }));

  const onPointerDown = (e: React.PointerEvent) => {
    drawingRef.current = true;
    pointsRef.current = [localPoint(e)];
    (e.target as Element).setPointerCapture(e.pointerId);
    redraw();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    pointsRef.current.push(localPoint(e));
    redraw();
  };
  const onPointerUp = () => {
    drawingRef.current = false;
    const has = pointsRef.current.length > 1;
    setHasDrawing(has);
    onChange?.(has);
  };

  return (
    <div className={`relative ${className ?? ""}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="block w-full h-full cursor-crosshair touch-none rounded-lg"
      />
      {!hasDrawing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            DRAW_PATTERN_HERE
          </span>
        </div>
      )}
    </div>
  );
});
