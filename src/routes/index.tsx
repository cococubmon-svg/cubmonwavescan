import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { runScan, findSimilar } from "@/lib/scan.functions";
import { PatternCanvas, type PatternCanvasHandle } from "@/components/PatternCanvas";
import { MiniChart } from "@/components/MiniChart";
import { DetailChart } from "@/components/DetailChart";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { PATTERN_LABELS, type PatternKind, type Timeframe } from "@/lib/patterns/types";
import type { ScanResult, Candle } from "@/lib/patterns/types";
import { TEMPLATES } from "@/lib/patterns/templates";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WaveScan — Find stocks matching the chart pattern you want" },
      { name: "description", content: "Scan US equities and ETFs for chart patterns across 5m–1w timeframes. Pick from a library, draw your own, or find stocks similar to any ticker — with similarity %, composite scoring, and RVOL." },
      { property: "og:title", content: "WaveScan — Stock Pattern Scanner" },
      { property: "og:description", content: "Find stocks that match the pattern you're looking for — in seconds." },
    ],
  }),
  component: Scanner,
});

const TIMEFRAMES: Timeframe[] = ["5m", "15m", "1h", "4h", "1d", "1w"];

const LIBRARY: Array<{ kind: PatternKind; label: string }> = (
  Object.keys(TEMPLATES) as Array<Exclude<PatternKind, "custom">>
).map((k) => ({ kind: k, label: PATTERN_LABELS[k] }));

type Universe = "nasdaq100" | "sp500" | "etfs" | "sector_etfs" | "watchlist";
type PatternSource = "library" | "draw" | "stock";

const UNIVERSE_LABELS: Record<Universe, string> = {
  nasdaq100: "Nasdaq 100",
  sp500: "S&P 500",
  etfs: "ETFs",
  sector_etfs: "Sector ETFs",
  watchlist: "Watchlist",
};

function Scanner() {
  const runScanFn = useServerFn(runScan);
  const findSimilarFn = useServerFn(findSimilar);
  const canvasRef = useRef<PatternCanvasHandle>(null);

  const [universe, setUniverse] = useState<Universe>("nasdaq100");
  const [watchlistRaw, setWatchlistRaw] = useState("AAPL,MSFT,NVDA,TSLA,AMD");
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [patternSource, setPatternSource] = useState<PatternSource>("library");
  const [pattern, setPattern] = useState<PatternKind>("double_bottom");
  const [stockSource, setStockSource] = useState<string>("NVDA");
  const [minComposite, setMinComposite] = useState(0.65);
  const [minPrice, setMinPrice] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<string>("");
  const [minAvgVolume, setMinAvgVolume] = useState<string>("");
  const [minRvol, setMinRvol] = useState<string>("");
  const [minAtrPct, setMinAtrPct] = useState<string>("");
  const [includePrePost, setIncludePrePost] = useState(false);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [selected, setSelected] = useState<ScanResult | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [view, setView] = useState<"cards" | "table">("table");

  // Per-chart timeframe (detail chart)
  const [detailTfLinked, setDetailTfLinked] = useState(true);
  const [detailTf, setDetailTf] = useState<Timeframe>("1h");
  useEffect(() => {
    if (detailTfLinked) setDetailTf(timeframe);
  }, [timeframe, detailTfLinked]);

  useEffect(() => {
    const w = localStorage.getItem("wavescan:watchlist");
    if (w) setWatchlistRaw(w);
  }, []);
  useEffect(() => {
    localStorage.setItem("wavescan:watchlist", watchlistRaw);
  }, [watchlistRaw]);

  const scanMutation = useMutation({
    mutationFn: async () => {
      const customTemplate =
        patternSource === "draw" ? canvasRef.current?.getSeries(64) ?? [] : undefined;
      const effectivePattern: PatternKind =
        patternSource === "draw" ? "custom" : pattern;
      const watchlist = watchlistRaw
        .split(/[,\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      const filters: {
        minPrice?: number;
        maxPrice?: number;
        minAvgVolume?: number;
        minRvol?: number;
        minAtrPct?: number;
      } = {};
      if (minPrice) filters.minPrice = Number(minPrice);
      if (maxPrice) filters.maxPrice = Number(maxPrice);
      if (minAvgVolume) filters.minAvgVolume = Number(minAvgVolume);
      if (minRvol) filters.minRvol = Number(minRvol);
      if (minAtrPct) filters.minAtrPct = Number(minAtrPct);
      return runScanFn({
        data: {
          universe,
          watchlist,
          timeframe,
          pattern: effectivePattern,
          customTemplate,
          minScore: 0.65,
          minComposite,
          includePrePost,
          filters,
          limit: universe === "watchlist" ? Math.max(1, watchlist.length) : 150,
          maxResults: 40,
        },
      });
    },
  });

  const similarMutation = useMutation({
    mutationFn: async (source: { symbol: string; tf: Timeframe }) => {
      const watchlist = watchlistRaw.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
      return findSimilarFn({
        data: {
          sourceSymbol: source.symbol.toUpperCase(),
          timeframe: source.tf,
          universe,
          watchlist,
          bars: 80,
          minComposite: 0.6,
          maxResults: 40,
        },
      });
    },
  });

  const triggerRun = () => {
    if (patternSource === "stock") {
      if (!stockSource.trim()) return;
      scanMutation.reset();
      similarMutation.mutate({ symbol: stockSource.trim(), tf: timeframe });
    } else {
      similarMutation.reset();
      scanMutation.mutate();
    }
  };

  const activeResults = (similarMutation.data?.results.length ? similarMutation.data : scanMutation.data)?.results ?? [];
  const usingSimilar = !!similarMutation.data?.results.length;
  const isPending = scanMutation.isPending || similarMutation.isPending;
  const hasRun = !!(scanMutation.data || similarMutation.data) || isPending;

  useEffect(() => {
    if (activeResults.length > 0 && !selected) setSelected(activeResults[0]);
    if (activeResults.length === 0) setSelected(null);
  }, [activeResults, selected]);

  const universeCount = useMemo(() => {
    if (universe === "nasdaq100") return 96;
    if (universe === "sp500") return 160;
    if (universe === "etfs") return 27;
    if (universe === "sector_etfs") return 11;
    return watchlistRaw.split(/[,\s]+/).filter(Boolean).length;
  }, [universe, watchlistRaw]);

  const onPickLibrary = (k: PatternKind) => {
    setPattern(k);
    setPatternSource("library");
    canvasRef.current?.clear();
  };

  const runDisabled =
    isPending ||
    (patternSource === "draw" && !hasDrawing) ||
    (patternSource === "stock" && !stockSource.trim()) ||
    (universe === "watchlist" && !watchlistRaw.trim());

  const errorCount = usingSimilar ? similarMutation.data?.errors ?? 0 : scanMutation.data?.errors ?? 0;
  const fetchedCount = usingSimilar ? similarMutation.data?.fetched ?? 0 : scanMutation.data?.fetched ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-6 min-w-0">
            <span className="font-mono font-medium tracking-tight text-brand whitespace-nowrap">
              WAVESCAN
            </span>
            <nav className="hidden md:flex gap-6">
              <span className="text-sm font-medium text-foreground">Scanner</span>
              <span className="text-sm font-medium text-muted-foreground">Library</span>
            </nav>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeSwitcher />
            <div className="hidden sm:flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-brand animate-pulse" />
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                Yahoo · ~15m
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="py-4 sm:py-8">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 space-y-6">
          {/* HERO */}
          {!hasRun && <Hero />}

          <div className="grid grid-cols-12 gap-4 lg:gap-8">
            {/* Left rail */}
            <aside className="col-span-12 lg:col-span-3 space-y-6 order-2 lg:order-1">
              {/* Pattern source tabs */}
              <section className="space-y-3">
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Pattern Source
                </h2>
                <div className="flex gap-1 bg-panel-2 rounded-lg p-1">
                  {(["library", "draw", "stock"] as PatternSource[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setPatternSource(s)}
                      className={`flex-1 text-[10px] font-mono uppercase py-1.5 rounded-md transition-colors ${
                        patternSource === s
                          ? "bg-brand text-brand-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s === "library" ? "Library" : s === "draw" ? "Draw" : "From Stock"}
                    </button>
                  ))}
                </div>
              </section>

              {patternSource === "draw" && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-mono text-muted-foreground uppercase">Canvas</h3>
                    <button
                      onClick={() => { canvasRef.current?.clear(); setHasDrawing(false); }}
                      className="text-[10px] font-mono text-muted-foreground hover:text-foreground"
                    >
                      CLEAR
                    </button>
                  </div>
                  <div className="aspect-square w-full bg-panel ring-1 ring-border rounded-lg grid-bg relative overflow-hidden">
                    <PatternCanvas
                      ref={canvasRef}
                      onChange={(h) => { setHasDrawing(h); }}
                      className="absolute inset-0"
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Sketch the shape you're hunting. We'll DTW-match it against every ticker.
                  </p>
                </section>
              )}

              {patternSource === "stock" && (
                <section className="space-y-3">
                  <h3 className="text-[10px] font-mono text-muted-foreground uppercase">Source Ticker</h3>
                  <input
                    value={stockSource}
                    onChange={(e) => setStockSource(e.target.value.toUpperCase())}
                    placeholder="NVDA"
                    className="w-full bg-panel-2 px-3 py-2 rounded font-mono text-sm focus:outline-none focus:ring-1 focus:ring-brand uppercase"
                  />
                  <div className="flex flex-wrap gap-1">
                    {["NVDA", "TSLA", "AAPL", "AMD", "META", "SPY"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setStockSource(t)}
                        className="text-[10px] font-mono px-2 py-0.5 rounded bg-panel-2 hover:bg-brand/20 hover:text-brand"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    We use this stock's last 80 bars as the template, then scan your universe for similar shapes.
                  </p>
                </section>
              )}

              {patternSource === "library" && (
                <section className="space-y-3">
                  <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Library · {LIBRARY.length}
                  </h2>
                  <div className="grid grid-cols-2 gap-2 max-h-[420px] lg:max-h-[540px] overflow-y-auto scrollbar-thin pr-1">
                    {LIBRARY.map((p, i) => {
                      const active = pattern === p.kind && patternSource === "library";
                      return (
                        <button
                          key={p.kind}
                          onClick={() => onPickLibrary(p.kind)}
                          className={`flex flex-col gap-1.5 p-2.5 rounded-lg text-left ring-1 transition-colors ${
                            active ? "bg-brand/10 ring-brand/40" : "bg-panel ring-border hover:ring-brand/30"
                          }`}
                        >
                          <span className={`text-[10px] font-mono ${active ? "text-brand" : "text-muted-foreground"}`}>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className={`text-[11px] font-medium leading-tight ${active ? "text-brand" : "text-foreground"}`}>
                            {p.label}
                          </span>
                          <TemplateSparkline kind={p.kind} active={active} />
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </aside>

            {/* Main: controls + results */}
            <div className="col-span-12 lg:col-span-9 space-y-4 sm:space-y-6 order-1 lg:order-2">
              {/* Controls bar */}
              <div className="p-3 sm:p-4 bg-panel ring-1 ring-border rounded-xl space-y-3">
                <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                  <Field label="Universe">
                    <select
                      value={universe}
                      onChange={(e) => setUniverse(e.target.value as Universe)}
                      className="bg-panel-2 text-sm font-medium px-2 py-1 rounded focus:outline-none cursor-pointer"
                    >
                      {(Object.keys(UNIVERSE_LABELS) as Universe[]).map((u) => (
                        <option key={u} value={u}>{UNIVERSE_LABELS[u]}</option>
                      ))}
                    </select>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {universeCount}
                    </span>
                  </Field>

                  <Field label="Timeframe">
                    <div className="flex gap-0.5 bg-panel-2 rounded-md p-0.5">
                      {TIMEFRAMES.map((t) => (
                        <button
                          key={t}
                          onClick={() => setTimeframe(t)}
                          className={`px-1.5 py-0.5 rounded text-[11px] font-mono uppercase ${
                            timeframe === t ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label={`Min Score · ${Math.round(minComposite * 100)}`}>
                    <input
                      type="range"
                      min={0.5} max={0.95} step={0.01}
                      value={minComposite}
                      onChange={(e) => setMinComposite(Number(e.target.value))}
                      className="accent-brand w-28"
                    />
                  </Field>

                  <button
                    onClick={() => setShowFilters((v) => !v)}
                    className="text-[10px] font-mono px-2 py-1 rounded bg-panel-2 text-muted-foreground hover:text-foreground uppercase"
                  >
                    {showFilters ? "− Filters" : "+ Filters"}
                  </button>

                  <div className="ml-auto flex items-center gap-3 flex-wrap">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase hidden sm:inline">
                      {patternSource === "stock"
                        ? <>Source: <span className="text-foreground">{stockSource || "—"}</span></>
                        : patternSource === "draw"
                          ? <>Pattern: <span className="text-foreground">Drawing</span></>
                          : <>Pattern: <span className="text-foreground">{PATTERN_LABELS[pattern]}</span></>}
                    </span>
                    <button
                      onClick={triggerRun}
                      disabled={runDisabled}
                      className="flex items-center bg-brand text-brand-foreground px-4 py-2 rounded-lg font-medium text-sm active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isPending && (
                        <div className="mr-2 size-4 border-2 border-brand-foreground border-t-transparent rounded-full animate-spin" />
                      )}
                      {patternSource === "stock" ? "Find Similar" : "Run Scan"}
                    </button>
                  </div>
                </div>

                {showFilters && (
                  <div className="space-y-3 pt-3 border-t border-border">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono text-muted-foreground uppercase">RVOL Preset:</span>
                      {[
                        { label: "Any", v: "" },
                        { label: ">1.5x", v: "1.5" },
                        { label: ">2.0x", v: "2" },
                        { label: ">3.0x", v: "3" },
                      ].map((p) => (
                        <button
                          key={p.label}
                          onClick={() => setMinRvol(p.v)}
                          className={`text-[10px] font-mono px-2 py-1 rounded ${
                            minRvol === p.v ? "bg-brand text-brand-foreground" : "bg-panel-2 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-3">
                      <Field label="Min Price">
                        <input inputMode="decimal" placeholder="—" value={minPrice} onChange={(e) => setMinPrice(e.target.value)}
                          className="w-20 bg-panel-2 px-2 py-1 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand" />
                      </Field>
                      <Field label="Max Price">
                        <input inputMode="decimal" placeholder="—" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)}
                          className="w-20 bg-panel-2 px-2 py-1 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand" />
                      </Field>
                      <Field label="Min Avg Vol">
                        <input inputMode="numeric" placeholder="—" value={minAvgVolume} onChange={(e) => setMinAvgVolume(e.target.value)}
                          className="w-24 bg-panel-2 px-2 py-1 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand" />
                      </Field>
                      <Field label={`Min RVOL · ${minRvol || "—"}x`}>
                        <input inputMode="decimal" placeholder="any" value={minRvol} onChange={(e) => setMinRvol(e.target.value)}
                          className="w-16 bg-panel-2 px-2 py-1 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand" />
                      </Field>
                      <Field label="Min ATR %">
                        <input inputMode="decimal" placeholder="—" value={minAtrPct} onChange={(e) => setMinAtrPct(e.target.value)}
                          className="w-16 bg-panel-2 px-2 py-1 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand" />
                      </Field>
                      <Field label="Session">
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input type="checkbox" checked={includePrePost} onChange={(e) => setIncludePrePost(e.target.checked)}
                            className="accent-brand" />
                          <span className="font-mono uppercase text-[10px]">Pre/Post</span>
                        </label>
                      </Field>
                    </div>
                  </div>
                )}
              </div>

              {universe === "watchlist" && (
                <div className="p-3 bg-panel ring-1 ring-border rounded-lg space-y-2">
                  <label className="text-[10px] font-mono text-muted-foreground uppercase">
                    Watchlist (comma-separated tickers)
                  </label>
                  <input
                    value={watchlistRaw}
                    onChange={(e) => setWatchlistRaw(e.target.value)}
                    className="w-full bg-panel-2 px-3 py-2 rounded font-mono text-sm focus:outline-none focus:ring-1 focus:ring-brand"
                    placeholder="AAPL, MSFT, NVDA"
                  />
                </div>
              )}

              {(scanMutation.isError || similarMutation.isError) && (
                <div className="p-3 rounded-lg bg-destructive/10 ring-1 ring-destructive/30 text-sm text-destructive">
                  Error: {((scanMutation.error || similarMutation.error) as Error).message}
                </div>
              )}

              {hasRun && (
                <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground uppercase flex-wrap">
                  {usingSimilar && (
                    <span className="text-brand">
                      Similar to {(similarMutation.variables as { symbol: string } | undefined)?.symbol ?? ""} ·{" "}
                      <button onClick={() => similarMutation.reset()} className="underline">clear</button>
                    </span>
                  )}
                  <span>Matches: <span className="text-foreground">{activeResults.length}</span></span>
                  <span>Scanned: <span className="text-foreground">{fetchedCount}</span></span>
                  {errorCount > 0 && (
                    <span title="Symbols where data was unavailable (delisted, rate-limited, etc).">
                      Skipped: <span className="text-warn">{errorCount}</span>
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1 bg-panel-2 rounded-md p-0.5">
                    {(["table", "cards"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setView(v)}
                        className={`px-2 py-0.5 rounded text-[10px] uppercase ${
                          view === v ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {isPending ? (
                <ResultsSkeleton view={view} />
              ) : activeResults.length > 0 ? (
                view === "table" ? (
                  <ResultsTable
                    results={activeResults}
                    selected={selected}
                    onSelect={(r) => { setSelected(r); setDetailOpen(true); }}
                    usingSimilar={usingSimilar}
                  />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                    {activeResults.map((r) => (
                      <ResultCard
                        key={r.symbol}
                        r={r}
                        onClick={() => { setSelected(r); setDetailOpen(true); }}
                        active={selected?.symbol === r.symbol}
                        usingSimilar={usingSimilar}
                      />
                    ))}
                  </div>
                )
              ) : hasRun ? (
                <EmptyState />
              ) : null}

              {selected && (
                <DetailPanel
                  selected={selected}
                  detailTf={detailTf}
                  setDetailTf={setDetailTf}
                  detailTfLinked={detailTfLinked}
                  toggleLink={() => setDetailTfLinked((v) => !v)}
                  onFindSimilar={() => similarMutation.mutate({ symbol: selected.symbol, tf: selected.timeframe })}
                  similarLoading={similarMutation.isPending}
                  detailOpen={detailOpen}
                  setDetailOpen={setDetailOpen}
                />
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-border mt-10 sm:mt-20">
        <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 sm:grid-cols-3 gap-8 text-xs text-muted-foreground">
          <div>
            <span className="font-mono text-brand">WAVESCAN</span>
            <p className="mt-2 max-w-[42ch]">
              Pattern screener with DTW + composite scoring (DTW · volume · trend · RVOL). Data via Yahoo Finance, ~15m delay.
            </p>
          </div>
          <div className="space-y-1">
            <h4 className="font-mono uppercase tracking-widest text-foreground/70">Engine</h4>
            <p>{LIBRARY.length} templates · custom canvas · find-similar</p>
            <p>Composite = 0.55·DTW + 0.20·Vol + 0.15·Trend + 0.10·RVOL</p>
          </div>
          <div className="space-y-1">
            <h4 className="font-mono uppercase tracking-widest text-foreground/70">Status</h4>
            <div className="flex items-center gap-2 text-brand">
              <div className="size-1.5 rounded-full bg-brand" /> SYSTEMS_NOMINAL
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ============================== HERO ============================== */

function Hero() {
  return (
    <section className="relative overflow-hidden rounded-2xl ring-1 ring-border bg-gradient-to-br from-panel via-background to-panel p-6 sm:p-10">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="relative space-y-4 max-w-3xl">
        <span className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-brand">
          <span className="size-1.5 rounded-full bg-brand animate-pulse" /> Pattern Screener
        </span>
        <h1 className="text-3xl sm:text-5xl font-semibold leading-tight tracking-tight">
          Find stocks that match the pattern you're{" "}
          <span className="text-brand">looking for</span> — in seconds.
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground max-w-[60ch]">
          Pick from 18 classic patterns, sketch your own on a canvas, or paste any ticker and find stocks moving like it. Composite scoring keeps the noise out.
        </p>
      </div>
      <div className="relative mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {EXAMPLE_RESULTS.map((ex) => (
          <div key={ex.symbol} className="bg-panel/80 ring-1 ring-border rounded-xl p-3 space-y-2">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-mono text-sm font-medium">{ex.symbol}</p>
                <p className="text-[10px] text-muted-foreground">{ex.pattern}</p>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-brand/10 text-brand ring-1 ring-brand/30">
                {ex.match}% MATCH
              </span>
            </div>
            <div className="h-16">
              <MiniChart candles={ex.candles} match={{ pattern: ex.pattern, score: ex.match / 100, composite: ex.match / 100, startIdx: 5, endIdx: ex.candles.length - 3 }} height={64} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Synthetic example candles, just for the hero (clearly illustrative).
function syntheticCandles(seed: number, shape: (i: number, n: number) => number, n = 40): Candle[] {
  const out: Candle[] = [];
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const trend = shape(i, n);
    const noise = (Math.sin(seed + i * 1.3) + Math.cos(seed * 2 + i * 0.7)) * 0.6;
    const c = 100 + trend + noise;
    const o = prev;
    const h = Math.max(o, c) + Math.abs(noise) * 0.6;
    const l = Math.min(o, c) - Math.abs(noise) * 0.6;
    out.push({ t: 1700000000 + i * 3600, o, h, l, c, v: 1_000_000 + Math.abs(noise) * 500_000 });
    prev = c;
  }
  return out;
}

const EXAMPLE_RESULTS = [
  {
    symbol: "NVDA", pattern: "Cup & Handle", match: 92,
    candles: syntheticCandles(1, (i, n) => {
      const x = i / (n - 1);
      // Cup: parabola; handle: slight dip then breakout
      if (x < 0.75) return 8 * (4 * (x - 0.4) * (x - 0.4) - 0.64);
      if (x < 0.92) return -2 + (x - 0.75) * 4;
      return 5 + (x - 0.92) * 60;
    }),
  },
  {
    symbol: "TSLA", pattern: "Double Bottom", match: 87,
    candles: syntheticCandles(2.4, (i, n) => {
      const x = i / (n - 1);
      const v = Math.sin(x * Math.PI * 2.1) * 6;
      return v + x * 4;
    }),
  },
  {
    symbol: "AMD", pattern: "Bull Flag", match: 84,
    candles: syntheticCandles(5.1, (i, n) => {
      const x = i / (n - 1);
      if (x < 0.45) return x * 18;
      if (x < 0.85) return 8 - (x - 0.45) * 4;
      return 6 + (x - 0.85) * 60;
    }),
  },
];

/* ============================== TABLE ============================== */

function ResultsTable({
  results, selected, onSelect, usingSimilar,
}: {
  results: ScanResult[];
  selected: ScanResult | null;
  onSelect: (r: ScanResult) => void;
  usingSimilar: boolean;
}) {
  return (
    <div className="bg-panel ring-1 ring-border rounded-xl overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm min-w-[760px]">
        <thead>
          <tr className="text-[10px] font-mono text-muted-foreground uppercase border-b border-border">
            <th className="text-left px-3 py-2">Ticker</th>
            <th className="text-left px-3 py-2">Chart</th>
            <th className="text-left px-3 py-2">Pattern</th>
            <th className="text-right px-3 py-2">{usingSimilar ? "Similarity" : "DTW"}</th>
            <th className="text-right px-3 py-2">Score</th>
            <th className="text-right px-3 py-2">RVOL</th>
            <th className="text-right px-3 py-2">Last</th>
            <th className="text-right px-3 py-2">Chg %</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const sim = Math.round(r.match.score * 100);
            const score = Math.round(r.match.composite * 100);
            const active = selected?.symbol === r.symbol;
            return (
              <tr
                key={r.symbol}
                onClick={() => onSelect(r)}
                className={`border-b border-border/50 cursor-pointer transition-colors ${
                  active ? "bg-brand/10" : "hover:bg-panel-2/50"
                }`}
              >
                <td className="px-3 py-2">
                  <div className="font-mono font-medium">{r.symbol}</div>
                  <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">{r.name}</div>
                </td>
                <td className="px-3 py-1.5">
                  <div className="w-24 h-10">
                    <MiniChart candles={r.candles} match={r.match} height={40} />
                  </div>
                </td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground">{r.match.pattern}</td>
                <td className="px-3 py-2 text-right">
                  <span className={`font-mono text-[11px] px-1.5 py-0.5 rounded ring-1 ${
                    sim >= 85 ? "bg-brand/10 text-brand ring-brand/30"
                    : sim >= 75 ? "bg-warn/10 text-warn ring-warn/30"
                    : "bg-panel-2 text-muted-foreground ring-border"
                  }`}>{sim}%</span>
                </td>
                <td className="px-3 py-2 text-right font-mono">{score}</td>
                <td className={`px-3 py-2 text-right font-mono ${r.rvol >= 2 ? "text-warn" : r.rvol >= 1.5 ? "text-brand" : "text-muted-foreground"}`}>
                  {r.rvol.toFixed(2)}x
                </td>
                <td className="px-3 py-2 text-right font-mono">${r.lastPrice.toFixed(2)}</td>
                <td className={`px-3 py-2 text-right font-mono ${r.changePct >= 0 ? "text-bull" : "text-bear"}`}>
                  {r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(2)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ============================== SKELETON ============================== */

function ResultsSkeleton({ view }: { view: "table" | "cards" }) {
  if (view === "table") {
    return (
      <div className="bg-panel ring-1 ring-border rounded-xl p-3 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <div className="h-4 w-14 rounded bg-panel-2 animate-pulse" />
            <div className="h-8 flex-1 rounded bg-panel-2 animate-pulse" />
            <div className="h-4 w-12 rounded bg-panel-2 animate-pulse" />
            <div className="h-4 w-10 rounded bg-panel-2 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="p-4 bg-panel ring-1 ring-border rounded-xl space-y-3">
          <div className="flex justify-between">
            <div className="space-y-2">
              <div className="h-4 w-16 bg-panel-2 rounded animate-pulse" />
              <div className="h-3 w-24 bg-panel-2 rounded animate-pulse" />
            </div>
            <div className="h-5 w-16 bg-panel-2 rounded animate-pulse" />
          </div>
          <div className="h-20 bg-panel-2 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/* ============================== DETAIL ============================== */

function DetailPanel({
  selected, detailTf, setDetailTf, detailTfLinked, toggleLink, onFindSimilar, similarLoading, detailOpen, setDetailOpen,
}: {
  selected: ScanResult;
  detailTf: Timeframe;
  setDetailTf: (t: Timeframe) => void;
  detailTfLinked: boolean;
  toggleLink: () => void;
  onFindSimilar: () => void;
  similarLoading: boolean;
  detailOpen: boolean;
  setDetailOpen: (o: boolean) => void;
}) {
  return (
    <>
      <section className="hidden md:block space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Selected Analysis
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onFindSimilar}
              disabled={similarLoading}
              className="text-[11px] font-mono px-3 py-1.5 rounded-md bg-brand/10 hover:bg-brand/20 text-brand ring-1 ring-brand/30 disabled:opacity-50"
            >
              {similarLoading ? "SEARCHING…" : "🔍 FIND SIMILAR PATTERNS"}
            </button>
            <span className="text-[10px] font-mono text-muted-foreground">
              {selected.symbol} · {detailTf.toUpperCase()} · {selected.match.pattern}
            </span>
          </div>
        </div>
        <div className="bg-panel ring-1 ring-border rounded-xl overflow-hidden">
          <DetailChart
            candles={selected.candles}
            match={selected.match}
            timeframe={detailTf}
            onTimeframeChange={setDetailTf}
            linkedToGlobal={detailTfLinked}
            onToggleLink={toggleLink}
          />
          <StatsRow r={selected} />
        </div>
      </section>

      {detailOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/60" onClick={() => setDetailOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto bg-background ring-1 ring-border rounded-t-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-background/95 backdrop-blur-md px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="font-mono text-sm">
                <span className="text-foreground font-medium">{selected.symbol}</span>{" "}
                <span className="text-muted-foreground text-[10px]">· {selected.match.pattern}</span>
              </div>
              <button
                onClick={() => setDetailOpen(false)}
                className="text-muted-foreground hover:text-foreground text-lg"
              >
                ✕
              </button>
            </div>
            <div className="p-3 space-y-3">
              <DetailChart
                candles={selected.candles}
                match={selected.match}
                timeframe={detailTf}
                onTimeframeChange={setDetailTf}
                linkedToGlobal={detailTfLinked}
                onToggleLink={toggleLink}
                height={280}
              />
              <StatsRow r={selected} />
              <button
                onClick={onFindSimilar}
                disabled={similarLoading}
                className="w-full text-xs font-mono py-3 rounded-md bg-brand text-brand-foreground disabled:opacity-50"
              >
                {similarLoading ? "SEARCHING…" : "🔍 FIND SIMILAR PATTERNS"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StatsRow({ r }: { r: ScanResult }) {
  const f = r.match.factors;
  return (
    <div className="p-4 sm:p-6 flex flex-wrap gap-x-8 gap-y-3 border-t border-border">
      <Stat label="Similarity" value={`${Math.round(r.match.score * 100)}%`} positive />
      <Stat label="Composite" value={`${Math.round(r.match.composite * 100)}`} positive />
      <Stat label="Last" value={`$${r.lastPrice.toFixed(2)}`} />
      <Stat label="Change" value={`${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(2)}%`} positive={r.changePct >= 0} />
      <Stat label="Avg Vol (20)" value={formatVolume(r.avgVolume)} />
      <Stat label="RVOL" value={`${r.rvol.toFixed(2)}x`} positive={r.rvol >= 1.5} />
      {f && (
        <>
          <Stat label="Vol Conf" value={`${Math.round(f.volume * 100)}`} />
          <Stat label="Trend Align" value={`${Math.round(f.trend * 100)}`} />
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-mono text-muted-foreground uppercase whitespace-nowrap">{label}</label>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-mono text-muted-foreground uppercase">{label}</p>
      <p className={`text-sm font-mono ${positive === undefined ? "text-foreground" : positive ? "text-bull" : "text-bear"}`}>
        {value}
      </p>
    </div>
  );
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

function ResultCard({ r, onClick, active, usingSimilar }: { r: ScanResult; onClick: () => void; active: boolean; usingSimilar: boolean }) {
  const composite = Math.round(r.match.composite * 100);
  const sim = Math.round(r.match.score * 100);
  const scoreColor = composite >= 85 ? "brand" : composite >= 75 ? "warn" : "muted-foreground";
  const rvolHigh = r.rvol >= 2;
  const rvolMed = r.rvol >= 1.5;
  return (
    <button
      onClick={onClick}
      className={`text-left p-3 sm:p-4 bg-panel ring-1 rounded-xl space-y-3 transition-all ${
        active ? "ring-brand/50" : "ring-border hover:ring-brand/30"
      }`}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <h3 className="font-mono font-medium text-base sm:text-lg">{r.symbol}</h3>
          <p className="text-xs text-muted-foreground truncate">{r.name}</p>
        </div>
        <div className="text-right flex-shrink-0 space-y-1">
          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ring-1 bg-brand/10 text-brand ring-brand/30">
            {sim}% {usingSimilar ? "SIM" : "DTW"}
          </span>
          <div>
            <span
              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ring-1 ${
                scoreColor === "brand"
                  ? "bg-brand/10 text-brand ring-brand/20"
                  : scoreColor === "warn"
                    ? "bg-warn/10 text-warn ring-warn/20"
                    : "bg-panel-2 text-muted-foreground ring-border"
              }`}
            >
              {composite} SCORE
            </span>
          </div>
        </div>
      </div>
      <div className="h-20 sm:h-24 w-full">
        <MiniChart candles={r.candles} match={r.match} height={96} />
      </div>
      <div className="flex justify-between items-center gap-2">
        <span className="text-[10px] font-mono text-muted-foreground uppercase truncate">
          {r.match.pattern}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-xs font-mono">
            ${r.lastPrice.toFixed(2)}
            <span className={`ml-1 ${r.changePct >= 0 ? "text-bull" : "text-bear"}`}>
              {r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(1)}%
            </span>
          </span>
          <span
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded ring-1 ${
              rvolHigh
                ? "bg-warn/10 text-warn ring-warn/30 animate-pulse"
                : rvolMed
                  ? "bg-brand/10 text-brand ring-brand/30"
                  : "bg-panel-2 text-muted-foreground ring-border"
            }`}
          >
            R {r.rvol.toFixed(1)}x
          </span>
        </div>
      </div>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="p-8 sm:p-12 bg-panel ring-1 ring-border rounded-xl text-center space-y-2">
      <p className="font-mono text-sm text-foreground">NO_MATCHES_FOUND</p>
      <p className="text-xs text-muted-foreground">
        Try lowering the composite score, relaxing the RVOL filter, or picking a different pattern/timeframe.
      </p>
    </div>
  );
}

function TemplateSparkline({ kind, active }: { kind: PatternKind; active: boolean }) {
  if (kind === "custom") return null;
  const tpl = TEMPLATES[kind as Exclude<PatternKind, "custom">];
  const w = 100;
  const h = 24;
  const path = tpl.map((v, i) => {
    const x = (i / (tpl.length - 1)) * w;
    const y = h - v * h;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-5">
      <path d={path} fill="none" stroke={active ? "var(--color-brand)" : "var(--color-muted-foreground)"} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
