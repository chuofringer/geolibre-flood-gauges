import { GAUGE_ID_RE } from "./data/noaaNwps";

// Small JSON only (plan §3.5) — it's stringified on every plugin toggle
// and embedded in .geolibre.json. Never the feature collection; that's
// kept out via the layer's metadata.originalUrl (plan §3.2).
export interface ProjectStateV1 {
  v: 1;
  selectedGauge?: string;
  refreshMinutes?: number;
}

/**
 * Parses an untrusted inbound project-state payload. Unknown `v`, missing
 * fields, or garbage must never throw — a project saved by a newer plugin
 * version must not break activation for an older one.
 */
export function parseProjectState(raw: unknown): ProjectStateV1 | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.v !== 1) return null;

  const state: ProjectStateV1 = { v: 1 };
  if (typeof obj.selectedGauge === "string" && GAUGE_ID_RE.test(obj.selectedGauge)) {
    state.selectedGauge = obj.selectedGauge;
  }
  if (
    typeof obj.refreshMinutes === "number" &&
    Number.isFinite(obj.refreshMinutes) &&
    obj.refreshMinutes > 0
  ) {
    state.refreshMinutes = obj.refreshMinutes;
  }
  return state;
}

export function buildProjectState(
  selectedGauge: string | null,
  refreshMinutes: number | null,
): ProjectStateV1 {
  const state: ProjectStateV1 = { v: 1 };
  if (selectedGauge) state.selectedGauge = selectedGauge;
  if (refreshMinutes) state.refreshMinutes = refreshMinutes;
  return state;
}
