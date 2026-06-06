import { describe, it, expect } from "vitest";
import { bestMatch, detectPatterns } from "../detectors";
import { TEMPLATES } from "../templates";
import type { Candle } from "../types";

function makeCandles(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    t: i * 60,
    o: c,
    h: c * 1.005,
    l: c * 0.995,
    c,
    v: 1000,
  }));
}

describe("detectPatterns", () => {
  it("finds the correct named pattern when constrained to it", () => {
    const flat = Array(20).fill(0.5);
    const series = [...flat, ...TEMPLATES.double_bottom, ...flat];
    const candles = makeCandles(series);
    const m = bestMatch(candles, { minScore: 0.6, only: "double_bottom" });
    expect(m).not.toBeNull();
    expect(m!.pattern.toLowerCase()).toContain("double bottom");
    expect(m!.score).toBeGreaterThan(0.8);
    expect(m!.composite).toBeGreaterThan(0);
    expect(m!.factors).toBeDefined();
  });

  it("custom template path returns a match when shape is present", () => {
    const flat = Array(20).fill(0.3);
    const series = [...flat, ...TEMPLATES.bull_flag, ...flat];
    const candles = makeCandles(series);
    const m = bestMatch(candles, {
      only: "custom",
      customTemplate: TEMPLATES.bull_flag,
      minScore: 0.5,
    });
    expect(m).not.toBeNull();
    expect(m!.score).toBeGreaterThan(0.5);
  });

  it("returns empty when minScore impossible to satisfy", () => {
    const random = Array.from({ length: 80 }, () => Math.random());
    const matches = detectPatterns(makeCandles(random), { minScore: 0.99 });
    expect(matches.length).toBe(0);
  });

  it("returns nothing if too few candles", () => {
    const m = detectPatterns(makeCandles([1, 2, 3]));
    expect(m).toEqual([]);
  });

  it("composite score includes rvol boost", () => {
    const flat = Array(20).fill(0.5);
    const series = [...flat, ...TEMPLATES.double_bottom, ...flat];
    const lowR = bestMatch(makeCandles(series), { minScore: 0.6, only: "double_bottom", recentRvol: 0.5 });
    const highR = bestMatch(makeCandles(series), { minScore: 0.6, only: "double_bottom", recentRvol: 2.5 });
    expect(highR!.composite).toBeGreaterThan(lowR!.composite);
  });
});
