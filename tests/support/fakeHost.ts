import type {
  GeoLibreAppAPI,
  GeoLibreExternalNativeLayerRegistration,
  GeoLibreFloatingPanelRegistration,
  MapLike,
} from "../../src/host/geolibre-api";

type Handler = (e: unknown) => void;

/** Records every `map.on`/`map.off` call so tests can assert full teardown. */
export class FakeMap implements MapLike {
  readonly handlerLedger = new Map<string, Set<Handler>>();
  zoom = 2;
  readonly easeToCalls: { center: [number, number]; zoom: number }[] = [];
  readonly layers = new Map<string, Record<string, unknown>>();
  readonly sources = new Set<string>();
  readonly addLayerCalls: { layer: Record<string, unknown>; beforeId?: string }[] = [];
  readonly layout = new Map<string, Record<string, unknown>>();

  on(type: string, layerId: string, listener: Handler): unknown {
    const key = `${type}:${layerId}`;
    if (!this.handlerLedger.has(key)) this.handlerLedger.set(key, new Set());
    this.handlerLedger.get(key)!.add(listener);
    return this;
  }

  off(type: string, layerId: string, listener: Handler): unknown {
    this.handlerLedger.get(`${type}:${layerId}`)?.delete(listener);
    return this;
  }

  getCanvas() {
    return { style: { cursor: "" } };
  }

  getZoom(): number {
    return this.zoom;
  }

  easeTo(options: { center: [number, number]; zoom: number }): unknown {
    this.easeToCalls.push(options);
    this.zoom = options.zoom;
    return this;
  }

  addSource(id: string): void {
    this.sources.add(id);
  }

  /** Marks a host-created native layer so plugin `ensure*` helpers can `beforeId` it. */
  addHostLayer(id: string): void {
    this.layers.set(id, { id });
  }

  addLayer(layer: Record<string, unknown>, beforeId?: string): unknown {
    this.addLayerCalls.push({ layer, beforeId });
    if (typeof layer.id === "string") this.layers.set(layer.id, layer);
    return this;
  }

  removeLayer(id: string): unknown {
    this.layers.delete(id);
    this.layout.delete(id);
    return this;
  }

  getLayer(id: string): unknown {
    return this.layers.get(id);
  }

  getSource(id: string): unknown {
    return this.sources.has(id) ? { id } : undefined;
  }

  getLayoutProperty(id: string, name: string): unknown {
    return this.layout.get(id)?.[name];
  }

  setLayoutProperty(id: string, name: string, value: unknown): unknown {
    const current = this.layout.get(id) ?? {};
    current[name] = value;
    this.layout.set(id, current);
    return this;
  }

  fire(type: string, layerId: string, event: unknown): void {
    for (const listener of this.handlerLedger.get(`${type}:${layerId}`) ?? []) {
      listener(event);
    }
  }

  /** Total live handler count across every type:layerId key. */
  get liveHandlerCount(): number {
    let total = 0;
    for (const set of this.handlerLedger.values()) total += set.size;
    return total;
  }
}

export interface FakeHostOptions {
  /** Delete every optional GeoLibreAppAPI member, simulating an old host. */
  minimal?: boolean;
  map?: FakeMap | null;
}

/**
 * Minimal in-memory GeoLibreAppAPI implementation for host-contract tests
 * (plan §5, T3). Ledgers every registration/unregistration and every
 * `window.addEventListener` the plugin adds so tests can assert complete
 * teardown.
 */
export class FakeHost {
  readonly layers = new Map<string, GeoLibreExternalNativeLayerRegistration>();
  readonly panels = new Map<string, GeoLibreFloatingPanelRegistration>();
  readonly openPanels = new Set<string>();
  readonly windowListeners: { type: string; listener: EventListenerOrEventListenerObject }[] = [];
  readonly fitBoundsCalls: [number, number, number, number][] = [];
  readonly openedUrls: string[] = [];
  readonly layerGroups: { name?: string; layerIds?: string[] }[] = [];
  map: FakeMap | null;

  readonly app: GeoLibreAppAPI;
  private readonly originalAddEventListener: typeof window.addEventListener;
  private readonly originalRemoveEventListener: typeof window.removeEventListener;

  constructor(options: FakeHostOptions = {}) {
    this.map = options.map === undefined ? new FakeMap() : options.map;
    this.originalAddEventListener = window.addEventListener.bind(window);
    this.originalRemoveEventListener = window.removeEventListener.bind(window);

    const fullApi: Required<GeoLibreAppAPI> = {
      registerExternalNativeLayer: (layer) => {
        this.layers.set(layer.id, layer);
        // Host creates `<first nativeId>-source` and the primary native layer;
        // plugin-owned extras (hex fills, gauge hit circle) then `addLayer`.
        const primary = layer.nativeLayerIds[0];
        if (primary && this.map) {
          this.map.addSource(`${primary}-source`);
          this.map.addHostLayer(primary);
        }
      },
      unregisterExternalNativeLayer: (id) => {
        this.layers.delete(id);
      },
      registerFloatingPanel: (panel) => {
        this.panels.set(panel.id, panel);
        return () => this.panels.delete(panel.id);
      },
      unregisterFloatingPanel: (id) => {
        this.panels.delete(id);
        this.openPanels.delete(id);
      },
      openFloatingPanel: (id) => {
        if (!this.panels.has(id)) return false;
        this.openPanels.add(id);
        return true;
      },
      closeFloatingPanel: (id) => {
        this.openPanels.delete(id);
      },
      fitBounds: (bounds) => {
        this.fitBoundsCalls.push(bounds);
      },
      getMap: () => this.map,
      addLayerGroup: (name, layerIds) => {
        this.layerGroups.push({ name, layerIds });
        return `group-${this.layerGroups.length}`;
      },
      openExternalUrl: (url) => {
        this.openedUrls.push(url);
      },
    };

    if (options.minimal) {
      this.app = {};
    } else {
      this.app = fullApi;
    }

    this.trackWindowListeners();
  }

  private trackWindowListeners(): void {
    window.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      opts?: boolean | AddEventListenerOptions,
    ) => {
      this.windowListeners.push({ type, listener });
      this.originalAddEventListener(type, listener, opts);
    }) as typeof window.addEventListener;

    window.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      opts?: boolean | EventListenerOptions,
    ) => {
      const idx = this.windowListeners.findIndex((l) => l.type === type && l.listener === listener);
      if (idx >= 0) this.windowListeners.splice(idx, 1);
      this.originalRemoveEventListener(type, listener, opts);
    }) as typeof window.removeEventListener;
  }

  /** Restores the real window.addEventListener/removeEventListener. */
  dispose(): void {
    window.addEventListener = this.originalAddEventListener;
    window.removeEventListener = this.originalRemoveEventListener;
  }
}
