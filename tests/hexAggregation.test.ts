import { describe, expect, it } from "vitest";
import { aggregateToHex, FLOOD_STATUSES } from "../src/core/hexAggregation";
import type { GaugeGeoJSON, GaugeProperties } from "../src/core/types";

function gauge(lng: number, lat: number, status: GaugeProperties["status"]): GaugeGeoJSON["features"][number] {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: {
      gaugelid: "TEST1",
      status,
      location: "loc",
      waterbody: "wb",
      state: "PA",
      observed: 1,
      latitude: lat,
      longitude: lng,
      action: null,
      flood: null,
      moderate: null,
      major: null,
      units: "ft",
      obstime: "2026-08-19T00:00:00Z",
      wfo: "PBZ",
    },
  };
}

const fc = (features: GaugeGeoJSON["features"]): GaugeGeoJSON => ({
  type: "FeatureCollection",
  features,
});

describe("aggregateToHex (flood.live port)", () => {
  it("bins co-located gauges into one closed-ring hex with counts", () => {
    const out = aggregateToHex(fc([gauge(-80, 40.4, "action"), gauge(-80.001, 40.401, "no_flooding")]), 3);
    expect(out.features).toHaveLength(1);
    const hex = out.features[0];
    expect(hex.properties.count).toBe(2);
    expect(hex.properties.floodCount).toBe(1);
    const ring = hex.geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed ring
  });

  it("worstStatus follows severity order, not insertion order", () => {
    const out = aggregateToHex(
      fc([gauge(-80, 40.4, "minor"), gauge(-80.001, 40.401, "major"), gauge(-80.002, 40.402, "action")]),
      3,
    );
    expect(out.features[0].properties.worstStatus).toBe("major");
  });

  it("out_of_service never outranks a flood status", () => {
    const out = aggregateToHex(fc([gauge(-80, 40.4, "out_of_service"), gauge(-80.001, 40.401, "action")]), 3);
    expect(out.features[0].properties.worstStatus).toBe("action");
  });

  it("separate regions land in separate hexes", () => {
    const out = aggregateToHex(fc([gauge(-80, 40.4, "action"), gauge(-95, 30, "major")]), 3);
    expect(out.features).toHaveLength(2);
  });

  it("FLOOD_STATUSES covers exactly action..major (the layer filter contract)", () => {
    expect([...FLOOD_STATUSES].sort()).toEqual(["action", "major", "minor", "moderate"]);
    expect(FLOOD_STATUSES.has("no_flooding")).toBe(false);
    expect(FLOOD_STATUSES.has("not_defined")).toBe(false);
  });
});
