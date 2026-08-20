import { fetchGaugeDetail, fetchStageFlow } from "../data/noaaNwps";
import { statusColor } from "../core/statusColors";
import { computeFloodCategory } from "../core/floodCategory";
import { computeTrend } from "../core/trend";
import { getLatestObserved, getLatestObservedTime, isValidPrimary } from "../core/latestObserved";
import { formatStaleness } from "./format";
import { buildSeries } from "./series";
import { computeStageBarModel, renderStageBar } from "./stageBar";
import { Hydrograph } from "./hydrograph";
import type { GaugeDetail, GaugeProperties, StageFlowResponse } from "../core/types";
import type { GeoLibreAppAPI } from "../host/geolibre-api";

export const PANEL_ID = "flood-gauges-panel";
export const PANEL_TITLE = "US Live Flood Gauges";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  ts: number;
  detail: GaugeDetail;
  stageflow: StageFlowResponse;
}
const detailCache = new Map<string, CacheEntry>();

const STATUS_LABEL: Record<string, string> = {
  major: "Major Flooding",
  moderate: "Moderate Flooding",
  minor: "Minor Flooding",
  action: "Action Stage",
  no_flooding: "No Flooding",
  not_defined: "Not Defined",
  obs_not_current: "Not Current",
  out_of_service: "Out of Service",
};

const TREND_DISPLAY = {
  rising: { symbol: "▲", label: "Rising" },
  falling: { symbol: "▼", label: "Falling" },
  stable: { symbol: "▶", label: "Stable" },
} as const;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Registers the panel once (activate-time), with a placeholder body. */
export function registerPanel(app: GeoLibreAppAPI): void {
  app.registerFloatingPanel?.({
    id: PANEL_ID,
    title: PANEL_TITLE,
    defaultWidth: 360,
    position: "top-right",
    render: renderEmptyState,
  });
}

function renderEmptyState(container: HTMLElement): void {
  container.classList.add("fg-panel");
  container.appendChild(el("p", "fg-muted", "Select a gauge on the map to see details."));
}

/**
 * Re-registers the panel with a render fn bound to the selected gauge, then
 * opens it. The host keys its render effect on function identity, so an
 * already-open panel refreshes in place on gauge-to-gauge switching.
 */
export function openGaugePanel(app: GeoLibreAppAPI, gauge: GaugeProperties): void {
  app.registerFloatingPanel?.({
    id: PANEL_ID,
    title: PANEL_TITLE,
    defaultWidth: 360,
    position: "top-right",
    render: (container) => renderGaugePanel(app, container, gauge),
  });
  app.openFloatingPanel?.(PANEL_ID);
}

async function loadGaugeData(
  lid: string,
  signal: AbortSignal,
): Promise<{ detail: GaugeDetail; stageflow: StageFlowResponse }> {
  const cached = detailCache.get(lid);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached;

  const [detail, stageflow] = await Promise.all([
    fetchGaugeDetail(lid, signal),
    fetchStageFlow(lid, signal),
  ]);
  const entry: CacheEntry = { ts: Date.now(), detail, stageflow };
  detailCache.set(lid, entry);
  return entry;
}

function openLink(app: GeoLibreAppAPI, url: string): void {
  if (app.openExternalUrl) {
    app.openExternalUrl(url);
    return;
  }
  // Plain-anchor fallback: on the Tauri desktop a bare target="_blank"
  // would navigate the app's own webview instead of the system browser,
  // but that surface always provides openExternalUrl — this path is only
  // reached in a browser context.
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * `render(container)` runs once per open — this function builds the whole
 * subtree once with a loading skeleton, kicks off the (abortable, cached)
 * NWPS fetch, and fills the subtree in when it resolves. Returns the host's
 * expected cleanup function.
 */
function renderGaugePanel(
  app: GeoLibreAppAPI,
  container: HTMLElement,
  gauge: GaugeProperties,
): () => void {
  container.classList.add("fg-panel");

  const header = el("div", "fg-header");
  const lidRow = el("div", "fg-lid-row");
  lidRow.appendChild(el("h2", "fg-lid", gauge.gaugelid));
  header.appendChild(lidRow);
  header.appendChild(
    el("p", "fg-location", [gauge.location, gauge.waterbody, gauge.state].filter(Boolean).join(" · ")),
  );

  // Meta row, flood.live style (GaugePanelHeader.tsx): badge · trend · age.
  const metaRow = el("div", "fg-meta-row");
  const badge = el("span", "fg-badge");
  applyBadge(badge, gauge.status);
  const trendEl = el("span", "fg-trend");
  const ageEl = el("span", "fg-age fg-muted", "…");
  metaRow.appendChild(badge);
  metaRow.appendChild(trendEl);
  metaRow.appendChild(ageEl);
  header.appendChild(metaRow);

  const observedRow = el("p", "fg-observed-row", "Observed: –");

  // Stage bar replaces the old 4-row threshold table (design review):
  // colored category zones with a marker at the observed stage.
  const stageBarHost = el("div", "fg-stagebar");
  stageBarHost.style.display = "none";

  const staleness = el("p", "fg-staleness fg-muted", "Loading latest observation…");

  const hydrographContainer = el("div", "fg-hydrograph");
  const hydrograph = new Hydrograph();

  const footer = el("p", "fg-footer");
  const link = el("a", "fg-link", "Open on flood.live");
  link.href = `https://flood.live?gauge=${encodeURIComponent(gauge.gaugelid)}&ref=geolibre`;
  link.addEventListener("click", (e) => {
    e.preventDefault();
    openLink(app, link.href);
  });
  footer.appendChild(link);

  container.appendChild(header);
  container.appendChild(observedRow);
  container.appendChild(stageBarHost);
  container.appendChild(staleness);
  container.appendChild(hydrographContainer);
  container.appendChild(footer);

  let disposed = false;
  const controller = new AbortController();

  loadGaugeData(gauge.gaugelid, controller.signal)
    .then(({ detail, stageflow }) => {
      if (disposed) return;
      fillDetail(gauge, detail, stageflow, {
        badge,
        trendEl,
        ageEl,
        observedRow,
        stageBarHost,
        staleness,
        hydrographContainer,
        hydrograph,
      });
    })
    .catch((err: unknown) => {
      if (disposed || controller.signal.aborted) return;
      staleness.textContent = "Could not load the latest observation.";
      console.error("[geolibre-flood-gauges] panel data load failed", err);
    });

  return () => {
    disposed = true;
    controller.abort();
    hydrograph.destroy();
  };
}

interface FillTargets {
  badge: HTMLElement;
  trendEl: HTMLElement;
  ageEl: HTMLElement;
  observedRow: HTMLElement;
  stageBarHost: HTMLElement;
  staleness: HTMLElement;
  hydrographContainer: HTMLElement;
  hydrograph: Hydrograph;
}

/** flood.live badge treatment: dark text only on the light chip colors. */
function applyBadge(badge: HTMLElement, status: string): void {
  badge.textContent = STATUS_LABEL[status] ?? status;
  badge.style.backgroundColor = statusColor(status);
  badge.style.color = status === "action" || status === "no_flooding" ? "#000" : "#fff";
}

function fillDetail(
  gauge: GaugeProperties,
  detail: GaugeDetail,
  stageflow: StageFlowResponse,
  targets: FillTargets,
): void {
  const cats = detail.flood?.categories;
  const thresholds = {
    action: cats?.action?.stage ?? null,
    minor: cats?.minor?.stage ?? null,
    moderate: cats?.moderate?.stage ?? null,
    major: cats?.major?.stage ?? null,
  };

  // flood.live rule: primary != null && primary > -999. Do not fall back to
  // the NWPS snapshot when it is the NOAA missing-obs sentinel (-999).
  const nwpsPrimary = detail.status?.observed?.primary ?? null;
  const observed =
    getLatestObserved(stageflow) ?? (isValidPrimary(nwpsPrimary) ? nwpsPrimary : null);
  const computedStatus =
    computeFloodCategory(observed, thresholds.action, thresholds.minor, thresholds.moderate, thresholds.major) ??
    detail.status?.observed?.floodCategory ??
    gauge.status;

  applyBadge(targets.badge, computedStatus);

  const trend = stageflow.observed?.data ? computeTrend(stageflow.observed.data) : "stable";
  const trendInfo = TREND_DISPLAY[trend];
  targets.trendEl.className = `fg-trend fg-trend-${trend}`;
  targets.trendEl.textContent = trendInfo.symbol;
  targets.trendEl.title = `Trend: ${trendInfo.label}`;

  // Observed stage, bolded (plan §3.6 item 2); the trend arrow sits in the
  // meta row next to the badge, flood.live style.
  const units = stageflow.observed?.primaryUnits ?? detail.flood?.stageUnits ?? gauge.units ?? "";
  targets.observedRow.textContent = "Observed: ";
  if (observed != null) {
    const value = el("strong", "fg-observed-value", `${observed}${units ? ` ${units}` : ""}`);
    targets.observedRow.appendChild(value);
  } else {
    targets.observedRow.appendChild(document.createTextNode("–"));
  }

  renderStageBar(targets.stageBarHost, computeStageBarModel(thresholds, observed), units);

  const lastObs = getLatestObservedTime(stageflow);

  targets.staleness.textContent = "";
  if (lastObs) {
    const info = formatStaleness(lastObs);
    if (info) {
      // Relative age in the meta row (amber/red past the staleness tiers);
      // absolute time + provenance on one muted line under the stage bar.
      targets.ageEl.textContent = info.relative;
      targets.ageEl.className = `fg-age ${info.tier === "amber" ? "fg-amber" : info.tier === "red" ? "fg-stale-red" : "fg-muted"}`;
      targets.ageEl.title = info.absolute;
      targets.staleness.textContent = `${info.absolute} · Data: NOAA/NWPS`;
    }
  } else {
    targets.ageEl.textContent = "";
    targets.staleness.textContent = "No recent observation available. · Data: NOAA/NWPS";
  }

  const now = Date.now();
  const series = buildSeries(stageflow, thresholds, now);
  targets.hydrograph.mount(targets.hydrographContainer, series, units);
}
