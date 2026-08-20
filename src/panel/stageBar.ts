// Compact stage-bar visual replacing the 4-row threshold table (design
// review): one horizontal track whose colored zones are the flood
// categories, with a marker at the observed stage. Same data as the table,
// a fraction of the height, and it reads at a glance like flood.live's
// color language.
import { FLOOD_COLORS } from "../core/constants";
import { isValidPrimary } from "../core/latestObserved";
import type { SeriesThresholds } from "./series";

const ZONE_ORDER = [
  { key: "action" as const, color: FLOOD_COLORS.action },
  { key: "minor" as const, color: FLOOD_COLORS.minor },
  { key: "moderate" as const, color: FLOOD_COLORS.moderate },
  { key: "major" as const, color: FLOOD_COLORS.major },
];

const BELOW_COLOR = FLOOD_COLORS.no_flooding;

export interface StageZone {
  fromPct: number;
  toPct: number;
  color: string;
}

export interface StageTick {
  value: number;
  pct: number;
  color: string;
}

export interface StageBarModel {
  min: number;
  max: number;
  zones: StageZone[];
  ticks: StageTick[];
  /** Marker position in percent, clamped to stay visible; null without an observation. */
  markerPct: number | null;
}

/**
 * Pure model builder (unit-tested with T1). Returns null when no threshold
 * is defined — a bar with no zone boundaries carries no information.
 */
export function computeStageBarModel(
  thresholds: SeriesThresholds,
  observed: number | null,
): StageBarModel | null {
  const defined = ZONE_ORDER.filter((z) => thresholds[z.key] != null).map((z) => ({
    ...z,
    value: thresholds[z.key] as number,
  }));
  // NOAA thresholds are ascending by definition; sort defensively anyway so
  // inverted data noise cannot produce negative-width zones.
  defined.sort((a, b) => a.value - b.value);
  if (defined.length === 0) return null;

  const values = defined.map((d) => d.value);
  // Sentinel (-999) must not stretch the scale or park a fake left-edge marker.
  const validObserved = isValidPrimary(observed) ? observed : null;
  if (validObserved != null) values.push(validObserved);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = 0.14 * (hi - lo || Math.abs(hi) || 1);
  const min = lo - pad;
  const max = hi + pad;
  const span = max - min;
  const pct = (v: number) => ((v - min) / span) * 100;

  const zones: StageZone[] = [];
  let cursor = 0;
  let color = BELOW_COLOR;
  for (const d of defined) {
    const boundary = pct(d.value);
    zones.push({ fromPct: cursor, toPct: boundary, color });
    cursor = boundary;
    color = d.color;
  }
  zones.push({ fromPct: cursor, toPct: 100, color });

  return {
    min,
    max,
    zones,
    ticks: defined.map((d) => ({ value: d.value, pct: pct(d.value), color: d.color })),
    markerPct: validObserved == null ? null : Math.min(98, Math.max(2, pct(validObserved))),
  };
}

/** Renders the model into `host` (idempotent: clears previous contents). */
export function renderStageBar(
  host: HTMLElement,
  model: StageBarModel | null,
  units: string,
): void {
  host.textContent = "";
  if (!model) {
    host.style.display = "none";
    return;
  }
  host.style.display = "";

  const track = document.createElement("div");
  track.className = "fg-stagebar-track";
  for (const zone of model.zones) {
    const seg = document.createElement("div");
    seg.className = "fg-stagebar-zone";
    seg.style.left = `${zone.fromPct}%`;
    seg.style.width = `${Math.max(0, zone.toPct - zone.fromPct)}%`;
    seg.style.background = zone.color;
    track.appendChild(seg);
  }
  if (model.markerPct != null) {
    const marker = document.createElement("div");
    marker.className = "fg-stagebar-marker";
    marker.style.left = `${model.markerPct}%`;
    track.appendChild(marker);
  }
  host.appendChild(track);

  const ticks = document.createElement("div");
  ticks.className = "fg-stagebar-ticks";
  for (const tick of model.ticks) {
    const label = document.createElement("span");
    label.className = "fg-stagebar-tick";
    label.style.left = `${tick.pct}%`;
    label.textContent = `${tick.value}`;
    label.title = units ? `${tick.value} ${units}` : `${tick.value}`;
    ticks.appendChild(label);
  }
  host.appendChild(ticks);
}
