import { describe, it, expect } from "vitest";
import { dtwDistance, normalizeSeries, resample, similarity } from "../dtw";

describe("normalizeSeries", () => {
  it("maps to [0,1]", () => {
    const r = normalizeSeries([1, 2, 3, 4, 5]);
    expect(r[0]).toBe(0);
    expect(r[r.length - 1]).toBe(1);
  });
  it("handles constant series", () => {
    const r = normalizeSeries([3, 3, 3]);
    expect(r).toEqual([0.5, 0.5, 0.5]);
  });
});

describe("resample", () => {
  it("preserves endpoints", () => {
    const r = resample([0, 10], 5);
    expect(r[0]).toBeCloseTo(0);
    expect(r[4]).toBeCloseTo(10);
    expect(r[2]).toBeCloseTo(5);
  });
});

describe("dtwDistance", () => {
  it("returns 0 for identical series", () => {
    const a = [0, 0.2, 0.5, 0.8, 1];
    expect(dtwDistance(a, a)).toBeCloseTo(0);
  });
  it("returns positive for different series", () => {
    expect(dtwDistance([0, 1, 0], [1, 0, 1])).toBeGreaterThan(0);
  });
  it("is symmetric (approximately) under band constraint", () => {
    const a = [0, 0.3, 0.6, 1.0, 0.7];
    const b = [0, 0.2, 0.5, 0.9, 0.6];
    expect(dtwDistance(a, b)).toBeCloseTo(dtwDistance(b, a), 6);
  });
});

describe("similarity", () => {
  it("scores identical shapes near 1", () => {
    const a = [0, 0.5, 1, 0.5, 0];
    expect(similarity(a, a)).toBeGreaterThan(0.95);
  });
  it("scores shifted but same-shape highly", () => {
    const a = [0, 0.5, 1, 0.5, 0];
    const b = [0.1, 0.55, 0.95, 0.55, 0.05];
    expect(similarity(a, b)).toBeGreaterThan(0.85);
  });
  it("scores opposite shapes lower", () => {
    const a = [0, 0.5, 1, 0.5, 0];
    const b = [1, 0.5, 0, 0.5, 1];
    expect(similarity(a, b)).toBeLessThan(similarity(a, a));
  });
});
