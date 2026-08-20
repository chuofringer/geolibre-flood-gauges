// Source of truth: flood.live src/api/noaaMapServer.ts
// Deviations: the localStorage cache functions are dropped entirely (the
// GeoLibre layer store holds the current data, not this plugin);
// `normalizeStatus` is exported for tests; and an optional `AbortSignal`
// parameter threads through `fetchPage`/`fetchAllGauges` so the layer
// manager's AbortController (plan §3.2) can cancel an in-flight refresh.
// Pagination logic — including the "only the last parallel page's
// exceededTransferLimit flag is consulted" quirk — is kept byte-equivalent
// to the original; it is documented here, not fixed, because this is a
// verbatim port (plan D7).

import { NOAA_MAP_SERVER_URL, MAP_SERVER_FIELDS, PAGE_SIZE } from "../core/constants";
import type { FloodCategory, GaugeGeoJSON } from "../core/types";

const PARALLEL_OFFSETS = [0, 5000, 10000];

const STATUS_MAP: Record<string, FloodCategory> = {
  major: "major",
  moderate: "moderate",
  minor: "minor",
  action: "action",
  no_flooding: "no_flooding",
  not_defined: "not_defined",
  obs_not_current: "obs_not_current",
  out_of_service: "out_of_service",
};

export function normalizeStatus(raw: string): FloodCategory {
  const key = raw?.toLowerCase().replace(/\s+/g, "_") ?? "";
  return STATUS_MAP[key] ?? "not_defined";
}

async function fetchPage(
  offset: number,
  signal?: AbortSignal,
): Promise<{ features: GaugeGeoJSON["features"]; exceededTransferLimit: boolean }> {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: MAP_SERVER_FIELDS,
    f: "geojson",
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
  });

  const res = await fetch(`${NOAA_MAP_SERVER_URL}?${params}`, { signal });
  if (!res.ok) throw new Error(`NOAA MapServer error: ${res.status}`);

  const data = await res.json();
  const features: GaugeGeoJSON["features"] = [];

  if (data.features) {
    for (const feature of data.features) {
      feature.properties.status = normalizeStatus(feature.properties.status);

      features.push(feature);
    }
  }

  return { features, exceededTransferLimit: data.exceededTransferLimit === true };
}

export async function fetchAllGauges(signal?: AbortSignal): Promise<GaugeGeoJSON> {
  // Fire all page requests in parallel
  const pages = await Promise.all(PARALLEL_OFFSETS.map((offset) => fetchPage(offset, signal)));

  const allFeatures: GaugeGeoJSON["features"] = [];
  for (const page of pages) {
    allFeatures.push(...page.features);
  }

  // Defensive tail: if the last parallel page was full, continue sequentially.
  // NOTE: only `pages[pages.length - 1].exceededTransferLimit` gates this —
  // an earlier parallel page could theoretically be truncated while the last
  // one isn't, and this port (matching flood.live) would miss it. Upstream
  // quirk, not fixed here (verbatim port).
  const MAX_TAIL_PAGES = 10;
  const lastPage = pages[pages.length - 1];
  if (lastPage.exceededTransferLimit) {
    let offset = PARALLEL_OFFSETS[PARALLEL_OFFSETS.length - 1] + PAGE_SIZE;
    for (let i = 0; i < MAX_TAIL_PAGES; i++) {
      const page = await fetchPage(offset, signal);
      allFeatures.push(...page.features);
      if (!page.exceededTransferLimit) break;
      offset += PAGE_SIZE;
    }
  }

  return { type: "FeatureCollection", features: allFeatures };
}
