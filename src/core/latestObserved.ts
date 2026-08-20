// Source of truth: flood.live src/utils/latestObserved.ts
// Ported verbatim; no deviations.

import type { StageFlowResponse } from "./types";

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
