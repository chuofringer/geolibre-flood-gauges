import type { StageFlowPoint, StageFlowResponse } from "../core/types";

export interface SeriesThresholds {
  action: number | null;
  minor: number | null;
  moderate: number | null;
  major: number | null;
}

export interface BuiltSeries {
  /** Unix seconds, one shared x-axis for both series (uPlot alignment). */
  x: number[];
  /** Observed values aligned to `x`; null where no observed reading exists. */
  observed: (number | null)[];
  /** Forecast values aligned to `x`, future-only + one bridge point where
   *  the observed line ends, so the dashed line visually connects. */
  forecast: (number | null)[];
  thresholds: SeriesThresholds;
  windowStartSec: number;
  windowEndSec: number;
}

const WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // flood.live's default `pm3` range
const SENTINEL_MAX = -999;

function isValid(p: StageFlowPoint): p is StageFlowPoint & { primary: number } {
  return p.primary != null && p.primary > SENTINEL_MAX;
}

function toMs(validTime: string): number | null {
  const t = Date.parse(validTime);
  return Number.isNaN(t) ? null : t;
}

interface Point {
  t: number;
  v: number;
}

function toPoints(data: StageFlowPoint[] | undefined): Point[] {
  return (data ?? [])
    .filter(isValid)
    .map((p) => ({ t: toMs(p.validTime), v: p.primary }))
    .filter((p): p is Point => p.t != null);
}

/**
 * Pure StageFlow -> uPlot data transform (plan §3.6 / T1). Splits observed
 * vs. forecast at `max(now, lastObservedTime)`, keeps only future forecast
 * points, duplicates the boundary point into the forecast series as a
 * bridge so the two lines connect visually, and clips everything to a
 * fixed `now` +/- 3 day window.
 */
export function buildSeries(
  stageflow: StageFlowResponse | undefined,
  thresholds: SeriesThresholds,
  now: number,
): BuiltSeries {
  const windowStart = now - WINDOW_MS;
  const windowEnd = now + WINDOW_MS;
  const inWindow = (p: Point) => p.t >= windowStart && p.t <= windowEnd;

  const observedAll = toPoints(stageflow?.observed?.data).sort((a, b) => a.t - b.t);
  const observedRaw = observedAll.filter(inWindow);

  const lastObservedTime = observedAll.length
    ? observedAll[observedAll.length - 1].t
    : -Infinity;
  const splitTime = Math.max(now, lastObservedTime);

  const forecastRaw = toPoints(stageflow?.forecast?.data)
    .filter((p) => p.t > splitTime)
    .filter(inWindow)
    .sort((a, b) => a.t - b.t);

  const bridge: Point[] = observedRaw.length
    ? [{ t: observedRaw[observedRaw.length - 1].t, v: observedRaw[observedRaw.length - 1].v }]
    : [];
  const forecastBridged = [...bridge, ...forecastRaw];

  const xSet = new Set<number>();
  for (const p of observedRaw) xSet.add(p.t);
  for (const p of forecastBridged) xSet.add(p.t);
  const xMs = [...xSet].sort((a, b) => a - b);

  const observedByT = new Map(observedRaw.map((p) => [p.t, p.v]));
  const forecastByT = new Map(forecastBridged.map((p) => [p.t, p.v]));

  return {
    x: xMs.map((t) => Math.round(t / 1000)),
    observed: xMs.map((t) => observedByT.get(t) ?? null),
    forecast: xMs.map((t) => forecastByT.get(t) ?? null),
    thresholds,
    windowStartSec: Math.round(windowStart / 1000),
    windowEndSec: Math.round(windowEnd / 1000),
  };
}
