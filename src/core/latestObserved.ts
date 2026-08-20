// Source of truth: flood.live src/utils/latestObserved.ts
// getLatestObserved is ported verbatim; no deviations.
// isValidPrimary / getLatestObservedTime apply the same flood.live rule
// (primary != null && primary > -999) at the display-time fallback.

import type { StageFlowResponse } from "./types";

/** NOAA missing-obs sentinel. flood.live: primary != null && primary > -999. */
export function isValidPrimary(v: number | null | undefined): v is number {
  return v != null && v > -999;
}

/**
 * Returns the latest valid observed primary value from stageflow data.
 * This ensures the displayed value matches what the chart plots.
 */
export function getLatestObserved(
  stageFlowData: StageFlowResponse | undefined,
): number | null {
  const data = stageFlowData?.observed?.data;
  if (!data || data.length === 0) return null;
  // Walk backwards to find the latest valid reading
  for (let i = data.length - 1; i >= 0; i--) {
    const v = data[i].primary;
    if (v != null && v > -999) return v;
  }
  return null;
}

/**
 * Timestamp of the latest valid observed point (skips NOAA sentinels).
 * Same walk as getLatestObserved so the staleness line matches the plotted value.
 */
export function getLatestObservedTime(
  stageFlowData: StageFlowResponse | undefined,
): string | null {
  const data = stageFlowData?.observed?.data;
  if (!data || data.length === 0) return null;
  for (let i = data.length - 1; i >= 0; i--) {
    const v = data[i].primary;
    if (v != null && v > -999) return data[i].validTime;
  }
  return null;
}
