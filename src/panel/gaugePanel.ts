import { fetchGaugeDetail, fetchStageFlow } from "../data/noaaNwps";
import { statusColor } from "../core/statusColors";
import { computeFloodCategory } from "../core/floodCategory";
import { computeTrend } from "../core/trend";
import { getLatestObserved } from "../core/latestObserved";
import { formatStaleness } from "./format";
import { buildSeries } from "./series";
import { Hydrograph } from "./hydrograph";
import type { GaugeDetail, GaugeProperties, StageFlowResponse } from "../core/types";
import type { GeoLibreAppAPI } from "../host/geolibre-api";

export const PANEL_ID = "flood-gauges-panel";
export const PANEL_TITLE = "US Flood Gauges";

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

const THRESHOLD_ROWS = [
  { key: "action", label: "Action" },
  { key: "minor", label: "Minor" },
  { key: "moderate", label: "Moderate" },
  { key: "major", label: "Major" },
] as const;

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

  const badgeRow = el("div", "fg-badge-row");
  const badge = el("span", "fg-badge");
  const initialLabel = STATUS_LABEL[gauge.status] ?? gauge.status;
  badge.textContent = initialLabel;
  badge.style.backgroundColor = statusColor(gauge.status);
  badgeRow.appendChild(badge);
  header.appendChild(badgeRow);

  const thresholdTable = el("table", "fg-thresholds");
  const tbody = el("tbody");
  const valueCells = new Map<string, HTMLTableCellElement>();
  for (const row of THRESHOLD_ROWS) {
    const tr = el("tr");
    const chip = el("span", "fg-chip");
    chip.style.backgroundColor = statusColor(row.key);
    const labelCell = el("td", "fg-threshold-label");
    labelCell.appendChild(chip);
    labelCell.appendChild(document.createTextNode(row.label));
    tr.appendChild(labelCell);
    const valueCell = el("td", "fg-threshold-value", "–");
    tr.appendChild(valueCell);
    tbody.appendChild(tr);
    valueCells.set(row.key, valueCell);
  }
  thresholdTable.appendChild(tbody);

  const staleness = el("p", "fg-staleness fg-muted", "Loading latest observation…");
  const provenance = el("p", "fg-provenance fg-muted", "Data: NOAA/NWPS");

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
  container.appendChild(thresholdTable);
  container.appendChild(staleness);
  container.appendChild(provenance);
  container.appendChild(hydrographContainer);
  container.appendChild(footer);

  let disposed = false;
  const controller = new AbortController();

  loadGaugeData(gauge.gaugelid, controller.signal)
    .then(({ detail, stageflow }) => {
      if (disposed) return;
      fillDetail(gauge, detail, stageflow, { badge, valueCells, staleness, hydrographContainer, hydrograph });
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
  valueCells: Map<string, HTMLTableCellElement>;
  staleness: HTMLElement;
  hydrographContainer: HTMLElement;
  hydrograph: Hydrograph;
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

  const observed = getLatestObserved(stageflow) ?? detail.status?.observed?.primary ?? null;
  const computedStatus =
    computeFloodCategory(observed, thresholds.action, thresholds.minor, thresholds.moderate, thresholds.major) ??
    detail.status?.observed?.floodCategory ??
    gauge.status;

  targets.badge.textContent = STATUS_LABEL[computedStatus] ?? computedStatus;
  targets.badge.style.backgroundColor = statusColor(computedStatus);

  for (const row of THRESHOLD_ROWS) {
    const cell = targets.valueCells.get(row.key);
    if (!cell) continue;
    const value = thresholds[row.key];
    cell.textContent = value == null ? "–" : `${value}`;
    if (observed != null && isHighestExceeded(row.key, thresholds, observed)) {
      cell.classList.add("fg-observed");
    }
  }

  const trend = stageflow.observed?.data ? computeTrend(stageflow.observed.data) : "stable";
  const trendInfo = TREND_DISPLAY[trend];
  const lastObs = stageflow.observed?.data?.length
    ? stageflow.observed.data[stageflow.observed.data.length - 1].validTime
    : null;

  targets.staleness.textContent = "";
  if (lastObs) {
    const info = formatStaleness(lastObs);
    if (info) {
      targets.staleness.classList.toggle("fg-amber", info.tier === "amber");
      targets.staleness.classList.toggle("fg-stale-red", info.tier === "red");
      targets.staleness.textContent = `${trendInfo.symbol} ${info.label}`;
      targets.staleness.title = `Trend: ${trendInfo.label}`;
    }
  } else {
    targets.staleness.textContent = "No recent observation available.";
  }

  const now = Date.now();
  const series = buildSeries(stageflow, thresholds, now);
  targets.hydrograph.mount(targets.hydrographContainer, series);
}

function isHighestExceeded(
  key: (typeof THRESHOLD_ROWS)[number]["key"],
  thresholds: Record<string, number | null>,
  observed: number,
): boolean {
  // Highlights the highest threshold row the observed value has reached,
  // for the "observed bolded" requirement (plan §3.6 item 2).
  const order: (keyof typeof thresholds)[] = ["major", "moderate", "minor", "action"];
  for (const k of order) {
    const v = thresholds[k];
    if (v != null && observed >= v) return k === key;
  }
  return false;
}
