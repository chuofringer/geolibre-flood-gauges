// Source of truth: flood.live src/utils/floodCategory.ts
// Ported verbatim; no deviations.

import type { FloodCategory } from "./types";

/**
 * Compute flood category from an observed value and stage thresholds.
 * Returns null when there isn't enough data to determine the category
 * (e.g. observed value missing or no thresholds defined).
 *
 * NOAA's pre-calculated status can be stale or incorrect, so we derive
 * the category ourselves from the raw numbers in the same response.
 */
export function computeFloodCategory(
  observed: number | null | undefined,
  action: number | null | undefined,
  flood: number | null | undefined,
  moderate: number | null | undefined,
  major: number | null | undefined,
): FloodCategory | null {
  // NOAA uses -9999 (and sometimes -999) as sentinels for missing data.
  // Some gauges return other extreme negatives (e.g. -10000) that are
  // equally invalid.  No real river stage can be ≤ -999 ft, so treat
  // the entire range as sentinel / bad-data.
  const isSentinel = (v: number) => v <= -999;

  if (observed == null || isSentinel(observed)) return null;

  // Negative stages are legitimate (water below datum), but sentinel
  // values must be rejected for thresholds too.
  const valid = (v: number | null | undefined): v is number =>
    v != null && !isSentinel(v);

  const a = valid(action) ? action : null;
  const f = valid(flood) ? flood : null;
  const m = valid(moderate) ? moderate : null;
  const j = valid(major) ? major : null;

  if (a == null && f == null && m == null && j == null) return null;

  if (j != null && observed >= j) return "major";
  if (m != null && observed >= m) return "moderate";
  if (f != null && observed >= f) return "minor";
  if (a != null && observed >= a) return "action";
  return "no_flooding";
}
