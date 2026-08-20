// Compact stage-bar visual replacing the 4-row threshold table (design
// review): one horizontal track whose colored zones are the flood
// categories, with a marker at the observed stage. Same data as the table,
// a fraction of the height, and it reads at a glance like flood.live's
// color language. Tick words match flood.live StageFlowChart markLines
// (Action / Minor / Moderate / Major) — not a second table.
import { FLOOD_COLORS } from "../core/constants";
import { isValidPrimary } from "../core/latestObserved";
import type { SeriesThresholds } from "./series";

const ZONE_ORDER = [
  { key: "action" as const, color: FLOOD_COLORS.action, category: "Action" },
  { key: "minor" as const, color: FLOOD_COLORS.minor, category: "Minor" },
  { key: "moderate" as const, color: FLOOD_COLORS.moderate, category: "Moderate" },
  { key: "major" as const, color: FLOOD_COLORS.major, category: "Major" },
];

const BELOW_COLOR = FLOOD_COLORS.no_flooding;

/** Full-width percent per character at 9px on a ~280px-narrow panel. */
const CHAR_PCT = 1.9;
const VAL_HALF_PCT = 3.5;
const TICK_GAP_PCT = 1;

export interface StageZone {
  fromPct: number;
  toPct: number;
  color: string;
}

export interface StageTick {
  value: number;
  pct: number;
  color: string;
  key: (typeof ZONE_ORDER)[number]["key"];
  /** flood.live markLine word (Action / Minor / Moderate / Major). */
  category: string;
  showCategory: boolean;
  showValue: boolean;
}

export interface StageBarModel {
  min: number;
  max: number;
  zones: StageZone[];
  ticks: StageTick[];
  /** Marker position in percent, clamped to stay visible; null without an observation. */
  markerPct: number | null;
}

function tickHalfPct(tick: Pick<StageTick, "showCategory" | "showValue" | "category">): number {
  if (tick.showCategory) return (tick.category.length * CHAR_PCT) / 2;
  if (tick.showValue) return VAL_HALF_PCT;
  return 0;
}

/** Drop category, then value, when neighboring ticks would paint on top of
 *  each other (QA: `1?2` collision when 1 and 2 sit a couple percent apart). */
function assignTickVisibility(ticks: StageTick[]): void {
  let prev: StageTick | undefined;
  for (const tick of ticks) {
    tick.showCategory = true;
    tick.showValue = true;
    if (prev) {
      const shown = prev;
      const gap = tick.pct - shown.pct;
      const need = (next: Pick<StageTick, "showCategory" | "showValue" | "category">) =>
        tickHalfPct(shown) + tickHalfPct(next) + TICK_GAP_PCT;
      if (gap < need(tick)) tick.showCategory = false;
      if (gap < need(tick)) tick.showValue = false;
    }
    if (tick.showCategory || tick.showValue) prev = tick;
  }
}

/**
 * Pure model builder (unit-tested with T1). Returns null when no threshold
 * is defined — a bar with no zone boundaries carries no information.
 */
export function computeStageBarModel(
  thresholds: SeriesThresholds,
  observed: number | null,
): StageBarModel | null {
  const defined = ZONE_ORDER.flatMap((z) => {
    const value = thresholds[z.key];
    return value != null ? [{ ...z, value }] : [];
  });
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

  const ticks: StageTick[] = defined.map((d) => ({
    value: d.value,
    pct: pct(d.value),
    color: d.color,
    key: d.key,
    category: d.category,
    showCategory: true,
    showValue: true,
  }));
  assignTickVisibility(ticks);

  return {
    min,
    max,
    zones,
    ticks,
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
    const unitSuffix = units ? ` ${units}` : "";
    label.title = `${tick.category} ${tick.value}${unitSuffix}`;

    if (tick.showCategory) {
      const cat = document.createElement("span");
      cat.className = "fg-stagebar-tick-cat";
      cat.textContent = tick.category;
      label.appendChild(cat);
    }
    if (tick.showValue) {
      const val = document.createElement("span");
      val.className = "fg-stagebar-tick-val";
      val.textContent = `${tick.value}`;
      label.appendChild(val);
    }
    if (tick.showCategory || tick.showValue) ticks.appendChild(label);
  }
  host.appendChild(ticks);
}
