import { GAUGE_ID_RE } from "./data/noaaNwps";
import type { GaugeFeature } from "./core/types";
import type { GeoLibreAppAPI } from "./host/geolibre-api";
import type { GaugeLayerManager } from "./layer";

export const DEEP_LINK_PARAM = "flood-gauge";

/**
 * Deep-link handler (plan §3.4). Dispatched by the host on app/project
 * load or map re-init, never on a raw URL change. `params.get()` is
 * untrusted URL input, so it's validated with `GAUGE_ID_RE` before ever
 * touching `manager.findGauge` (which awaits the initial fetch if it's
 * still in flight). Unknown ids are silently ignored, never thrown.
 */
export async function handleDeepLink(
  app: GeoLibreAppAPI,
  params: URLSearchParams,
  manager: GaugeLayerManager,
  onGaugeFound: (app: GeoLibreAppAPI, feature: GaugeFeature) => void,
): Promise<void> {
  const lid = params.get(DEEP_LINK_PARAM);
  if (!lid || !GAUGE_ID_RE.test(lid)) return;

  const feature = await manager.findGauge(lid);
  if (!feature) return;

  const [lng, lat] = feature.geometry.coordinates;
  app.fitBounds?.([lng, lat, lng, lat]); // degenerate box -> host flyTo at zoom >= 14
  onGaugeFound(app, feature);
}
