// Source of truth: flood.live src/utils/trend.ts
// Ported verbatim; no deviations.

import type { StageFlowPoint } from "./types";

export function computeTrend(
  observedData: StageFlowPoint[],
  threshold = 0.1,
): "rising" | "falling" | "stable" {
  if (!observedData || observedData.length < 2) return "stable";

  const recent = observedData.slice(-12);
  const valid = recent.filter(
    (p) => p.primary != null && p.primary > -999,
  ) as (StageFlowPoint & { primary: number })[];
  if (valid.length < 2) return "stable";

  const mid = Math.floor(valid.length / 2);
  const firstHalf = valid.slice(0, mid);
  const secondHalf = valid.slice(mid);

  const avg = (pts: (StageFlowPoint & { primary: number })[]) =>
    pts.reduce((sum, p) => sum + p.primary, 0) / pts.length;

  const firstAvg = avg(firstHalf);
  const secondAvg = avg(secondHalf);
  const diff = secondAvg - firstAvg;

  if (diff > threshold) return "rising";
  if (diff < -threshold) return "falling";
  return "stable";
}
