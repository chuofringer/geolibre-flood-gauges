// Vendored subset of GeoLibre's plugin contract (packages/plugins/src/types.ts @ 5ce4d686).
// The published template's host-api.ts is stale (no getMap/fitBounds/openExternalUrl,
// panel position, or the current registration shape) — upstream gap noted in README.
// Types only, no runtime.

export interface GeoLibreFeatureCollection {
  type: "FeatureCollection";
  features: unknown[];
}

export type GeoLibreMapControlPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface GeoLibreLayerStylePartial {
  vectorStyleMode?: string; // we use "expression"
  vectorStyleProperty?: string;
  vectorStyleExpression?: string; // MUST be a JSON string, never an array (plan §3.3)
  circleRadius?: number;
  strokeColor?: string;
  strokeWidth?: number;
  fillOpacity?: number;
}

export interface GeoLibreExternalNativeLayerRegistration {
  id: string;
  name: string;
  geojson?: GeoLibreFeatureCollection;
  nativeLayerIds: string[]; // must be non-empty (plan §3.2)
  sourceIds?: string[];
  sourceId?: string;
  beforeId?: string;
  opacity?: number;
  style?: GeoLibreLayerStylePartial;
  metadata?: Record<string, unknown>;
}

export interface GeoLibreFloatingPanelRegistration {
  id: string;
  title: string | (() => string);
  icon?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  position?: GeoLibreMapControlPosition; // v2.0.0+
  render: (container: HTMLElement) => void | (() => void);
  onOpen?: () => void;
  onClose?: () => void;
}

export interface MapLike {
  // minimal MapLibre surface we touch
  on(type: string, layerId: string, listener: (e: unknown) => void): unknown;
  off(type: string, layerId: string, listener: (e: unknown) => void): unknown;
  getCanvas(): { style: { cursor: string } };
}

export interface GeoLibreAppAPI {
  registerExternalNativeLayer?: (layer: GeoLibreExternalNativeLayerRegistration) => void;
  unregisterExternalNativeLayer?: (id: string) => void;
  registerFloatingPanel?: (panel: GeoLibreFloatingPanelRegistration) => () => void;
  unregisterFloatingPanel?: (id: string) => void;
  openFloatingPanel?: (id: string) => boolean;
  closeFloatingPanel?: (id: string) => void;
  fitBounds?: (bounds: [number, number, number, number]) => void;
  getMap?: () => MapLike | null;
  openExternalUrl?: (url: string) => void;
}

export interface GeoLibrePlugin {
  id: string;
  name: string;
  version: string;
  urlParameterNames?: string[];
  activate: (app: GeoLibreAppAPI) => boolean | void;
  deactivate: (app: GeoLibreAppAPI) => void;
  handleUrlParameters?: (app: GeoLibreAppAPI, params: URLSearchParams) => void | Promise<void>;
  getProjectState?: () => unknown;
  applyProjectState?: (app: GeoLibreAppAPI, state: unknown) => boolean | void;
}
