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
