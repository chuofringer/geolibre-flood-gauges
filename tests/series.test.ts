import { describe, it, expect } from "vitest";
import { buildSeries } from "../src/panel/series";
import type { StageFlowResponse } from "../src/core/types";

const NOW = Date.parse("2026-08-19T12:00:00Z");
const THRESHOLDS = { action: 10, minor: 15, moderate: 20, major: 25 };

function iso(hoursFromNow: number): string {
  return new Date(NOW + hoursFromNow * 3_600_000).toISOString();
}

describe("buildSeries", () => {
  it("splits observed vs forecast at max(now, lastObservedTime)", () => {
    const stageflow: StageFlowResponse = {
      observed: {
        primaryUnits: "ft",
        data: [
          { validTime: iso(-2), primary: 10, secondary: null },
          { validTime: iso(-1), primary: 11, secondary: null },
        ],
      },
      forecast: {
        primaryUnits: "ft",
        data: [
          { validTime: iso(1), primary: 12, secondary: null },
          { validTime: iso(2), primary: 13, secondary: null },
        ],
      },
    };
    const series = buildSeries(stageflow, THRESHOLDS, NOW);
    // Observed values present, forecast values only for future points (+ bridge).
    const observedCount = series.observed.filter((v) => v != null).length;
    const forecastCount = series.forecast.filter((v) => v != null).length;
    expect(observedCount).toBe(2);
    // 2 forecast points + 1 bridge point (duplicated boundary) = 3 non-null forecast entries,
    // but the bridge shares an x with the last observed point so it doesn't add a new column.
    expect(forecastCount).toBe(3);
  });

  it("duplicates the boundary point into the forecast series (bridge)", () => {
    const stageflow: StageFlowResponse = {
      observed: { primaryUnits: "ft", data: [{ validTime: iso(-1), primary: 10, secondary: null }] },
      forecast: { primaryUnits: "ft", data: [{ validTime: iso(1), primary: 12, secondary: null }] },
    };
    const series = buildSeries(stageflow, THRESHOLDS, NOW);
    const lastObsIndex = series.x.findIndex((t) => t === Math.round(Date.parse(iso(-1)) / 1000));
    expect(lastObsIndex).toBeGreaterThanOrEqual(0);
    expect(series.observed[lastObsIndex]).toBe(10);
    // The bridge duplicates the observed value into forecast at the same x.
    expect(series.forecast[lastObsIndex]).toBe(10);
  });

  it("excludes forecast points at or before the split time (future-only)", () => {
    const stageflow: StageFlowResponse = {
      observed: { primaryUnits: "ft", data: [{ validTime: iso(-1), primary: 10, secondary: null }] },
      forecast: {
        primaryUnits: "ft",
        data: [
          { validTime: iso(-1), primary: 10, secondary: null }, // same time as split — excluded
          { validTime: iso(1), primary: 11, secondary: null }, // future — included
        ],
      },
    };
    const series = buildSeries(stageflow, THRESHOLDS, NOW);
    // Only the bridge point + the one future forecast point should be non-null.
    expect(series.forecast.filter((v) => v != null)).toHaveLength(2);
  });

  it("passes threshold y-values through unchanged", () => {
    const series = buildSeries(undefined, THRESHOLDS, NOW);
    expect(series.thresholds).toEqual(THRESHOLDS);
  });

  it("clips to a fixed now +/- 3 day window", () => {
    const stageflow: StageFlowResponse = {
      observed: {
        primaryUnits: "ft",
        data: [
          { validTime: iso(-24 * 10), primary: 5, secondary: null }, // 10 days ago — out of window
          { validTime: iso(-1), primary: 10, secondary: null },
        ],
      },
      forecast: { primaryUnits: "ft", data: [] },
    };
    const series = buildSeries(stageflow, THRESHOLDS, NOW);
    expect(series.observed.filter((v) => v != null)).toHaveLength(1);
    expect(series.windowStartSec).toBe(Math.round((NOW - 3 * 86_400_000) / 1000));
    expect(series.windowEndSec).toBe(Math.round((NOW + 3 * 86_400_000) / 1000));
  });

  it("returns empty arrays for an empty/all-sentinel series", () => {
    const stageflow: StageFlowResponse = {
      observed: {
        primaryUnits: "ft",
        data: [
          { validTime: iso(-1), primary: -999, secondary: null },
          { validTime: iso(-2), primary: -9999, secondary: null },
        ],
      },
      forecast: { primaryUnits: "ft", data: [] },
    };
    const series = buildSeries(stageflow, THRESHOLDS, NOW);
    expect(series.x).toHaveLength(0);
    expect(series.observed).toHaveLength(0);
    expect(series.forecast).toHaveLength(0);
  });

  it("handles undefined stageflow gracefully", () => {
    const series = buildSeries(undefined, THRESHOLDS, NOW);
    expect(series.x).toHaveLength(0);
  });
});
