// Color expression ported EXACTLY from flood.live GaugeLayers.tsx:55-66.
import type { GeoLibreLayerStylePartial } from "./host/geolibre-api";

export const GAUGE_COLOR_EXPRESSION = [
  "match",
  ["get", "status"],
  "major",
  "#cc33ff",
  "moderate",
  "#ff0000",
  "minor",
  "#ff9900",
  "action",
  "#ffe033",
  "no_flooding",
  "#00ff00",
  "not_defined",
  "rgba(136,136,136,0.2)",
  "obs_not_current",
  "rgba(136,136,136,0.2)",
  "out_of_service",
  "rgba(136,136,136,0.2)",
  "rgba(136,136,136,0.2)",
];

// Visible dot size. flood.live GaugeLayers.tsx interpolates 6→10 by zoom;
// the host style field is a flat number, so we keep the z6 handoff size.
export const GAUGE_CIRCLE_RADIUS = 6;

// Invisible hit-circle radius. flood.live FloodMap.tsx expands clicks via
// Map `clickTolerance` (3 desktop / 8 mobile) rather than a second circle.
// GeoLibre owns the Map constructor, so we add a transparent circle instead:
// visible radius + flood.live's mobile tolerance, a ~28px target at z6–7.
export const GAUGE_HIT_RADIUS = GAUGE_CIRCLE_RADIUS + 8;

export function gaugeHitLayerPaint(): {
  "circle-radius": number;
  "circle-color": string;
  "circle-opacity": number;
  "circle-stroke-width": number;
} {
  return {
    "circle-radius": GAUGE_HIT_RADIUS,
    "circle-color": "#000000",
    "circle-opacity": 0,
    "circle-stroke-width": 0,
  };
}

// The registration's `vectorStyleExpression` field is a JSON STRING, never
// the array itself — passing the array throws inside the host's whole-map
// style sync (plan §3.3). This is the one payload detail T3 snapshot-tests.
// minZoom 6 mirrors flood.live GaugeLayers.tsx: raw dots only past the hex
// handoff. QA noted a few stray dots at national zoom (FL/TX/Vancouver) —
// that's host minZoom application on this points layer, not hex-click, so
// leave it (not a one-line correctness fix on the same path).
export function gaugeLayerStyle(): GeoLibreLayerStylePartial {
  return {
    vectorStyleMode: "expression",
    vectorStyleProperty: "status",
    vectorStyleExpression: JSON.stringify(GAUGE_COLOR_EXPRESSION),
    circleRadius: GAUGE_CIRCLE_RADIUS,
    strokeColor: "#000000",
    strokeWidth: 1,
    fillOpacity: 1,
    minZoom: 6,
  };
}

// H3 overview fill, ported from flood.live HexSource.tsx: per-status alpha is
// baked into the rgba stops (a store LayerStyle carries one static color
// expression, so the fill-color encodes both hue and opacity). The
// aggregation already drops quiet hexes, matching flood.live's opacity-0
// treatment of no_flooding cells, so everything painted here is flood-active.
// Alphas sit between flood.live's light/dark variants to read on both themes.
export const HEX_COLOR_EXPRESSION = [
  "match",
  ["get", "worstStatus"],
  "major",
  "rgba(204,51,255,0.75)",
  "moderate",
  "rgba(255,0,0,0.65)",
  "minor",
  "rgba(255,153,0,0.55)",
  "action",
  "rgba(255,224,51,0.45)",
  "rgba(136,136,136,0)",
];

export function hexLayerStyle(minZoom: number, maxZoom: number): GeoLibreLayerStylePartial {
  return {
    vectorStyleMode: "expression",
    vectorStyleProperty: "worstStatus",
    vectorStyleExpression: JSON.stringify(HEX_COLOR_EXPRESSION),
    strokeColor: "rgba(128,128,128,0.35)",
    strokeWidth: 1,
    // Per-status alpha lives in the rgba stops; the host's fill-opacity must
    // not dilute it further (its default washed the fills out to outlines).
    fillOpacity: 1,
    minZoom,
    maxZoom,
  };
}
