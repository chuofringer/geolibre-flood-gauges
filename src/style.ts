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

// The registration's `vectorStyleExpression` field is a JSON STRING, never
// the array itself — passing the array throws inside the host's whole-map
// style sync (plan §3.3). This is the one payload detail T3 snapshot-tests.
export function gaugeLayerStyle(): GeoLibreLayerStylePartial {
  return {
    vectorStyleMode: "expression",
    vectorStyleProperty: "status",
    vectorStyleExpression: JSON.stringify(GAUGE_COLOR_EXPRESSION),
    circleRadius: 6,
    strokeColor: "#000000",
    strokeWidth: 1,
    fillOpacity: 1,
  };
}
