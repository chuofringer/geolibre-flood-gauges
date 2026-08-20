import { describe, expect, it } from "vitest";
import { computeStageBarModel } from "../src/panel/stageBar";

const FULL = { action: 10, minor: 15, moderate: 20, major: 25 };

describe("computeStageBarModel", () => {
  it("returns null when no threshold is defined", () => {
    expect(computeStageBarModel({ action: null, minor: null, moderate: null, major: null }, 5)).toBeNull();
  });

  it("builds five zones from four thresholds, covering 0..100 contiguously", () => {
    const m = computeStageBarModel(FULL, 12)!;
    expect(m.zones).toHaveLength(5);
    expect(m.zones[0].fromPct).toBe(0);
    expect(m.zones[m.zones.length - 1].toPct).toBe(100);
    for (let i = 1; i < m.zones.length; i++) {
      expect(m.zones[i].fromPct).toBeCloseTo(m.zones[i - 1].toPct, 6);
    }
  });

  it("orders ticks ascending and places the marker between action and minor", () => {
    const m = computeStageBarModel(FULL, 12)!;
    expect(m.ticks.map((t) => t.value)).toEqual([10, 15, 20, 25]);
    const action = m.ticks[0].pct;
    const minor = m.ticks[1].pct;
    expect(m.markerPct!).toBeGreaterThan(action);
    expect(m.markerPct!).toBeLessThan(minor);
  });

  it("handles partial thresholds (only minor defined): two zones, one tick", () => {
    const m = computeStageBarModel({ action: null, minor: 15, moderate: null, major: null }, 12)!;
    expect(m.zones).toHaveLength(2);
    expect(m.ticks).toHaveLength(1);
  });

  it("clamps an out-of-range (but valid) observed marker into the visible band", () => {
    // Negative stages below datum are real; -1000 is a NOAA sentinel, not a clamp case.
    const low = computeStageBarModel(FULL, -5)!;
    expect(low.markerPct!).toBeGreaterThanOrEqual(2);
    const high = computeStageBarModel(FULL, 9000)!;
    expect(high.markerPct!).toBeLessThanOrEqual(98);
  });

  it("NOAA sentinel observed (-999 / -9999) → no marker; thresholds-only scale", () => {
    const a = computeStageBarModel(FULL, -999)!;
    expect(a.markerPct).toBeNull();
    expect(a.zones).toHaveLength(5);
    // Sentinel must not pull min out to -999 (that parks a fake left-edge marker).
    expect(a.min).toBeGreaterThan(-100);
    const b = computeStageBarModel(FULL, -9999)!;
    expect(b.markerPct).toBeNull();
    expect(b.min).toBeGreaterThan(-100);
  });

  it("no observation → no marker, zones still render", () => {
    const m = computeStageBarModel(FULL, null)!;
    expect(m.markerPct).toBeNull();
    expect(m.zones).toHaveLength(5);
  });

  it("sorts inverted threshold noise so zones never have negative width", () => {
    const m = computeStageBarModel({ action: 20, minor: 15, moderate: null, major: null }, 16)!;
    for (const z of m.zones) expect(z.toPct).toBeGreaterThanOrEqual(z.fromPct);
  });
});
