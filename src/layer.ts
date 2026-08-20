import { NOAA_MAP_SERVER_URL, REFRESH_INTERVAL } from "./core/constants";
import { fetchAllGauges } from "./data/noaaMapServer";
import { gaugeLayerStyle } from "./style";
import type { GaugeFeature, GaugeGeoJSON, GaugeProperties } from "./core/types";
import type { GeoLibreAppAPI, MapLike } from "./host/geolibre-api";

export const LAYER_ID = "flood-gauges-layer";
export const NATIVE_ID = "flood-gauges-points";

export type GaugeClickHandler = (properties: GaugeProperties) => void;

interface MapMouseFeatureLike {
  properties?: Record<string, unknown>;
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
  private registered = false;
  private boundMap: MapLike | null = null;

  private readyResolve!: () => void;
  /** Resolves once the first successful fetch has registered the layer. */
  readonly ready: Promise<void>;

  private readonly boundClick = (e: unknown) => this.handleClick(e as MapMouseEventLike);
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

  async start(): Promise<void> {
    this.bindMapHandlers();
    window.addEventListener("geolibre-layer-labels-change", this.bindMapHandlersRef);
    await this.refresh(true);
    this.readyResolve();
    this.intervalId = setInterval(() => {
      void this.refresh(false);
    }, REFRESH_INTERVAL);
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
    this.unbindMapHandlers();
    window.removeEventListener("geolibre-layer-labels-change", this.bindMapHandlersRef);
    this.app.unregisterExternalNativeLayer?.(LAYER_ID);
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
    const generation = this.generation;
    const controller = new AbortController();
    this.abortController = controller;
    try {
      const data = await fetchAllGauges(controller.signal);
      // A fetch resolving after stop() (or a superseded generation) must
      // never re-register — this is the deactivate-racing-fetch guard.
      if (this.stopped || generation !== this.generation) return;

      const digest = computeDigest(data);
      if (!isFirst && this.registered && digest === this.digest) {
        // Content unchanged (plan D4 digest skip) — no re-register.
        return;
      }

      this.data = data;
      this.digest = digest;
      this.register(data, !this.registered);
      this.registered = true;
    } catch (err) {
      // Failed fetch (including the very first one): log, keep the
      // interval, retry next tick. Never an unhandled rejection, never a
      // permanently blank plugin.
      console.error("[geolibre-flood-gauges] gauge refresh failed", err);
    } finally {
      if (this.abortController === controller) this.abortController = null;
      this.inFlight = false;
    }
  }

  private register(data: GaugeGeoJSON, first: boolean): void {
    this.app.registerExternalNativeLayer?.({
      id: LAYER_ID,
      name: "US Flood Gauges (NOAA)",
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
  }

  private bindMapHandlers(): void {
    const map = this.app.getMap?.();
    if (!map) return; // map not ready yet; the next labels-change event retries
    this.unbindFrom(map);
    map.on("click", NATIVE_ID, this.boundClick);
    map.on("mouseenter", NATIVE_ID, this.boundMouseEnter);
    map.on("mouseleave", NATIVE_ID, this.boundMouseLeave);
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
  }

  private setCursor(cursor: string): void {
    const map = this.app.getMap?.();
    if (map) map.getCanvas().style.cursor = cursor;
  }

  private handleClick(e: MapMouseEventLike): void {
    const properties = e.features?.[0]?.properties;
    if (!properties) return;
    this.onGaugeClick(properties as unknown as GaugeProperties);
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
