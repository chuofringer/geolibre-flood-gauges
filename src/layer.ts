import { FETCH_TIMEOUT_MS, NOAA_MAP_SERVER_URL, REFRESH_INTERVAL } from "./core/constants";
import { StatusChip, type LoadState } from "./statusChip";
import { fetchAllGauges } from "./data/noaaMapServer";
import { aggregateToHex, FLOOD_STATUSES, type HexFeatureCollection } from "./core/hexAggregation";
import { gaugeLayerStyle, gaugeHitLayerPaint, hexLayerStyle, HEX_COLOR_EXPRESSION } from "./style";
import type { GaugeFeature, GaugeGeoJSON, GaugeProperties } from "./core/types";
import type { GeoLibreAppAPI, GeoLibreFeatureCollection, MapLike } from "./host/geolibre-api";

export const LAYER_ID = "flood-gauges-layer";
export const NATIVE_ID = "flood-gauges-points";
export const HIT_ID = "flood-gauges-points-hit";
export const LAYER_NAME = "US Live Flood Gauges (NOAA)";
export const GROUP_NAME = "US Live Flood Gauges";

// Low-zoom H3 overview (flood.live parity, HexSource.tsx): res-3 hexes to
// zoom 5, res-4 hexes for the 5–6 band, raw dots from zoom 6 up. Only
// flood-active hexes are registered, so quiet regions stay clean.
//
// Rendering note: the host's external-GeoJSON path draws polygons as a LINE
// layer only (layer-sync's geometry profile has no fill branch). The fill is
// ours: `fillId` is listed in `nativeLayerIds` so the host ADOPTS it —
// zoom-range, visibility, opacity, reorder, and unregister-removal all apply
// — but the layer itself is added by `ensureHexFillLayers()` against the
// host-created `<nativeId>-source`, and re-added after every host sync pass
// (the `geolibre-layer-labels-change` signal) so it survives basemap
// switches exactly like our click handlers do.
//
// Gauge dots get the same treatment for clickability: `HIT_ID` is a
// transparent circle on the host's points source, larger than the visible
// r=6 dot (see `GAUGE_HIT_RADIUS`). It is NOT listed in `nativeLayerIds` —
// the host would re-apply the visible circle paint on every sync. We add,
// hide-with-the-dots, and remove it ourselves.
export const HEX_LAYERS = [
  {
    id: "flood-gauges-hex3-layer",
    nativeId: "flood-gauges-hex3",
    fillId: "flood-gauges-hex3-fill",
    name: "Flood Overview — national (H3)",
    resolution: 3,
    minZoom: 0,
    maxZoom: 5,
  },
  {
    id: "flood-gauges-hex4-layer",
    nativeId: "flood-gauges-hex4",
    fillId: "flood-gauges-hex4-fill",
    name: "Flood Overview — regional (H3)",
    resolution: 4,
    minZoom: 5,
    maxZoom: 6,
  },
] as const;

export type GaugeClickHandler = (properties: GaugeProperties) => void;

interface MapMouseFeatureLike {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown };
}
interface MapMouseEventLike {
  features?: MapMouseFeatureLike[];
}

/**
 * Owns the flood-gauges external-native-layer registration: initial fetch,
 * periodic refresh with content-digest change detection (plan D4), and the
 * map click/hover handlers on the rendered layer. See plan §3.2.
 */
export class GaugeLayerManager {
  private readonly app: GeoLibreAppAPI;
  private readonly onGaugeClick: GaugeClickHandler;

  private data: GaugeGeoJSON | null = null;
  private digest: string | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  /** Bumped on stop(); a resolving fetch from a stale generation is discarded. */
  private generation = 0;
  private inFlight = false;
  private stopped = false;
  private loadState: LoadState = "loading";
  private lastOkAt: number | null = null;
  private readonly chip = new StatusChip();
  private registered = false;
  private boundMap: MapLike | null = null;
  private refreshIntervalMs = REFRESH_INTERVAL;

  private readyResolve!: () => void;
  /** Resolves once the first successful fetch has registered the layer. */
  readonly ready: Promise<void>;

  private readonly boundClick = (e: unknown) => this.handleClick(e as MapMouseEventLike);
  private readonly boundHexClick = (e: unknown) => this.handleHexClick(e as MapMouseEventLike);
  private readonly boundMouseEnter = () => this.setCursor("pointer");
  private readonly boundMouseLeave = () => this.setCursor("");
  private readonly bindMapHandlersRef = () => this.bindMapHandlers();

  constructor(app: GeoLibreAppAPI, onGaugeClick: GaugeClickHandler) {
    this.app = app;
    this.onGaugeClick = onGaugeClick;
    this.ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
  }

  getLoadState(): LoadState {
    return this.loadState;
  }

  async start(): Promise<void> {
    this.chip.mount();
    this.renderChip();
    this.bindMapHandlers();
    window.addEventListener("geolibre-layer-labels-change", this.bindMapHandlersRef);
    await this.refresh(true);
    this.readyResolve();
    this.intervalId = setInterval(() => {
      void this.refresh(false);
    }, this.refreshIntervalMs);
  }

  /** Applied by project state (plan §3.5); retunes a running interval. */
  setRefreshIntervalMinutes(minutes: number): void {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    this.refreshIntervalMs = minutes * 60_000;
    if (this.intervalId != null) {
      clearInterval(this.intervalId);
      this.intervalId = setInterval(() => {
        void this.refresh(false);
      }, this.refreshIntervalMs);
    }
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    if (this.intervalId != null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.abortController?.abort();
    this.abortController = null;
    this.chip.unmount();
    this.unbindMapHandlers();
    window.removeEventListener("geolibre-layer-labels-change", this.bindMapHandlersRef);
    this.app.unregisterExternalNativeLayer?.(LAYER_ID);
    for (const hex of HEX_LAYERS) {
      this.app.unregisterExternalNativeLayer?.(hex.id);
    }
    // Belt and braces: the host removes adopted native ids on unregister,
    // but if it ever misses ours, take the fill layers down explicitly.
    const map = this.boundMap ?? this.app.getMap?.() ?? null;
    if (map?.getLayer && map.removeLayer) {
      for (const hex of HEX_LAYERS) {
        if (map.getLayer(hex.fillId)) map.removeLayer(hex.fillId);
      }
      if (map.getLayer(HIT_ID)) map.removeLayer(HIT_ID);
    }
  }

  /** Test hook: force an immediate refresh cycle, bypassing the interval. */
  refreshNow(): Promise<void> {
    return this.refresh(false);
  }

  async findGauge(lid: string): Promise<GaugeFeature | null> {
    await this.ready;
    if (!this.data) return null;
    return this.data.features.find((f) => f.properties.gaugelid === lid) ?? null;
  }

  private async refresh(isFirst: boolean): Promise<void> {
    if (this.inFlight || this.stopped) return;
    this.inFlight = true;
    this.loadState = "loading";
    this.renderChip();
    const generation = this.generation;
    const controller = new AbortController();
    this.abortController = controller;
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const data = await fetchAllGauges(controller.signal);
      // A fetch resolving after stop() (or a superseded generation) must
      // never re-register — this is the deactivate-racing-fetch guard.
      if (this.stopped || generation !== this.generation) return;

      const digest = computeDigest(data);
      this.lastOkAt = Date.now();
      this.loadState = "ok";
      this.renderChip();
      if (!isFirst && this.registered && digest === this.digest) {
        // Content unchanged (plan D4 digest skip) — no re-register.
        return;
      }

      this.data = data;
      this.digest = digest;
      this.registerAll(data, !this.registered);
      this.registered = true;
    } catch (err) {
      // stop()/generation bump already aborted us — don't paint an error
      // onto a dead plugin.
      if (this.stopped || generation !== this.generation) return;
      // Failed fetch (including the very first one): log, keep the
      // interval, surface retry. Never an unhandled rejection, never a
      // permanently blank plugin. Timeout abort lands here too so
      // inFlight cannot stick until the browser gives up.
      console.error("[geolibre-flood-gauges] gauge refresh failed", err);
      this.loadState = "error";
      this.renderChip();
    } finally {
      clearTimeout(timeoutId);
      if (this.abortController === controller) this.abortController = null;
      this.inFlight = false;
    }
  }

  private renderChip(): void {
    this.chip.render({
      state: this.loadState,
      hasData: this.data != null,
      lastOkAt: this.lastOkAt,
      onRetry: () => {
        void this.refreshNow();
      },
    });
  }

  private registerAll(data: GaugeGeoJSON, first: boolean): void {
    this.app.registerExternalNativeLayer?.({
      id: LAYER_ID,
      name: LAYER_NAME,
      nativeLayerIds: [NATIVE_ID],
      geojson: data,
      // originalUrl keeps the (up to 10k-feature) collection out of
      // .geolibre.json on project save (plan §3.2).
      metadata: { originalUrl: NOAA_MAP_SERVER_URL },
      // style is only sent on the FIRST registration — the host merges
      // plugin style above user edits on every registration, so re-sending
      // it on refresh would silently revert Style-panel changes every cycle.
      ...(first ? { style: gaugeLayerStyle() } : {}),
    });

    for (const hex of HEX_LAYERS) {
      const aggregated = aggregateToHex(data, hex.resolution);
      const active: HexFeatureCollection = {
        type: "FeatureCollection",
        features: aggregated.features.filter((f) => FLOOD_STATUSES.has(f.properties.worstStatus)),
      };
      this.app.registerExternalNativeLayer?.({
        id: hex.id,
        name: hex.name,
        // fillId second: the host renders the FIRST id (as a line layer for
        // polygons) and adopts the rest — our fill layer (see HEX_LAYERS note).
        nativeLayerIds: [hex.nativeId, hex.fillId],
        geojson: active as unknown as GeoLibreFeatureCollection,
        // Derived data: restorable from the same source URL on reopen.
        metadata: { originalUrl: NOAA_MAP_SERVER_URL },
        ...(first ? { style: hexLayerStyle(hex.minZoom, hex.maxZoom) } : {}),
      });
    }
    this.ensureHexFillLayers();
    this.ensureGaugeHitLayer();

    if (first) {
      this.app.addLayerGroup?.(GROUP_NAME, [
        LAYER_ID,
        ...HEX_LAYERS.map((hex) => hex.id),
      ]);
    }
  }

  /**
   * Adds our fill layer for each hex tier when the host-created source
   * exists and the fill is missing (fresh activate, basemap switch, map
   * re-init). Inserted beneath the host's outline layer. The raw MapLibre
   * expression array is correct at this level — the JSON-string rule
   * (plan §3.3) applies only to the host's LayerStyle field.
   */
  private ensureHexFillLayers(): void {
    const map = this.app.getMap?.();
    if (!map?.addLayer || !map.getLayer || !map.getSource) return;
    for (const hex of HEX_LAYERS) {
      const sourceId = `${hex.nativeId}-source`;
      if (map.getLayer(hex.fillId) || !map.getSource(sourceId)) continue;
      map.addLayer(
        {
          id: hex.fillId,
          type: "fill",
          source: sourceId,
          minzoom: hex.minZoom,
          maxzoom: hex.maxZoom,
          filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
          paint: {
            "fill-color": HEX_COLOR_EXPRESSION,
            "fill-opacity": 1,
          },
        },
        map.getLayer(hex.nativeId) ? hex.nativeId : undefined,
      );
    }
  }

  /**
   * Transparent circle on the host's points source so mid-zoom dots are a
   * usable hit target. Inserted beneath the visible layer; paint is ours
   * (the host would flatten it to the visible radius if it adopted this id).
   */
  private ensureGaugeHitLayer(): void {
    const map = this.app.getMap?.();
    if (!map?.addLayer || !map.getLayer || !map.getSource) return;
    const sourceId = `${NATIVE_ID}-source`;
    const visibility = this.nativeDotsVisibility(map);
    if (map.getLayer(HIT_ID)) {
      map.setLayoutProperty?.(HIT_ID, "visibility", visibility);
      return;
    }
    if (!map.getSource(sourceId)) return;
    map.addLayer(
      {
        id: HIT_ID,
        type: "circle",
        source: sourceId,
        minzoom: 6,
        layout: { visibility },
        paint: gaugeHitLayerPaint(),
      },
      map.getLayer(NATIVE_ID) ? NATIVE_ID : undefined,
    );
  }

  /** Follows the host-owned visible dots so a hidden layer isn't still clickable. */
  private nativeDotsVisibility(map: MapLike): "visible" | "none" {
    if (!map.getLayer?.(NATIVE_ID) || !map.getLayoutProperty) return "visible";
    return map.getLayoutProperty(NATIVE_ID, "visibility") === "none" ? "none" : "visible";
  }

  private bindMapHandlers(): void {
    this.ensureHexFillLayers();
    this.ensureGaugeHitLayer();
    const map = this.app.getMap?.();
    if (!map) return; // map not ready yet; the next labels-change event retries
    this.unbindFrom(map);
    map.on("click", NATIVE_ID, this.boundClick);
    map.on("mouseenter", NATIVE_ID, this.boundMouseEnter);
    map.on("mouseleave", NATIVE_ID, this.boundMouseLeave);
    map.on("click", HIT_ID, this.boundClick);
    map.on("mouseenter", HIT_ID, this.boundMouseEnter);
    map.on("mouseleave", HIT_ID, this.boundMouseLeave);
    for (const hex of HEX_LAYERS) {
      // Bound to the fill layer: the interior is the click target, not the
      // 1px outline the host draws under hex.nativeId.
      map.on("click", hex.fillId, this.boundHexClick);
      map.on("mouseenter", hex.fillId, this.boundMouseEnter);
      map.on("mouseleave", hex.fillId, this.boundMouseLeave);
    }
    this.boundMap = map;
  }

  private unbindMapHandlers(): void {
    const map = this.boundMap ?? this.app.getMap?.() ?? null;
    if (map) this.unbindFrom(map);
    this.boundMap = null;
  }

  private unbindFrom(map: MapLike): void {
    map.off("click", NATIVE_ID, this.boundClick);
    map.off("mouseenter", NATIVE_ID, this.boundMouseEnter);
    map.off("mouseleave", NATIVE_ID, this.boundMouseLeave);
    map.off("click", HIT_ID, this.boundClick);
    map.off("mouseenter", HIT_ID, this.boundMouseEnter);
    map.off("mouseleave", HIT_ID, this.boundMouseLeave);
    for (const hex of HEX_LAYERS) {
      map.off("click", hex.fillId, this.boundHexClick);
      map.off("mouseenter", hex.fillId, this.boundMouseEnter);
      map.off("mouseleave", hex.fillId, this.boundMouseLeave);
    }
  }

  private setCursor(cursor: string): void {
    const map = this.app.getMap?.();
    if (map) map.getCanvas().style.cursor = cursor;
  }

  private handleClick(e: MapMouseEventLike): void {
    const map = this.app.getMap?.();
    if (map && this.nativeDotsVisibility(map) === "none") return;
    const properties = e.features?.[0]?.properties;
    if (!properties) return;
    this.onGaugeClick(properties as unknown as GaugeProperties);
  }

  /**
   * Hex click = zoom-in, not select (flood.live FloodMap.tsx).
   * Primary: easeTo the cell centroid at currentZoom + 2. Fallback: the
   * previous ring-extent fitBounds when getZoom/easeTo are unavailable
   * (older hosts) — do not no-op.
   */
  private handleHexClick(e: MapMouseEventLike): void {
    const geometry = e.features?.[0]?.geometry;
    if (geometry?.type !== "Polygon" || !Array.isArray(geometry.coordinates)) return;
    const ring = (geometry.coordinates as [number, number][][])[0];
    if (!ring?.length) return;
    const map = this.app.getMap?.();
    if (map?.getZoom && map.easeTo) {
      const centerLng = ring.reduce((sum, c) => sum + c[0], 0) / ring.length;
      const centerLat = ring.reduce((sum, c) => sum + c[1], 0) / ring.length;
      map.easeTo({
        center: [centerLng, centerLat],
        zoom: map.getZoom() + 2,
      });
      return;
    }
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
    this.app.fitBounds?.([minLng, minLat, maxLng, maxLat]);
  }
}

/**
 * Content digest over sorted per-gauge `lid|status|value|obstime` (plan D4).
 * Fails open (returns a digest that can never match a prior one) whenever
 * any `obstime` fails to parse, so an upstream format change can't
 * permanently pin the refresh-skip.
 */
export function computeDigest(data: GaugeGeoJSON): string {
  const parts: string[] = [];
  let failOpen = false;
  for (const feature of data.features) {
    const p = feature.properties;
    if (Number.isNaN(Date.parse(p.obstime))) failOpen = true;
    parts.push(`${p.gaugelid}|${p.status}|${p.observed ?? ""}|${p.obstime}`);
  }
  if (failOpen) return `fail-open:${Date.now()}:${Math.random()}`;
  parts.sort();
  return parts.join("\n");
}
