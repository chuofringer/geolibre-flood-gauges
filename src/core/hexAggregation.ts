// Source of truth: flood.live src/utils/hexAggregation.ts
// Deviations: FLOOD_STATUSES is exported (layer.ts filters the hex layers to
// flood-active cells before registering, mirroring flood.live's opacity-0
// treatment of quiet hexes); GeoJSON types come from a local structural
// interface instead of the ambient GeoJSON namespace.

import { latLngToCell, cellToBoundary } from "h3-js";
import type { GaugeGeoJSON } from "./types";

export interface HexFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
  properties: HexProperties;
}

export interface HexFeatureCollection {
  type: "FeatureCollection";
  features: HexFeature[];
}

export interface HexProperties {
  h3Index: string;
  count: number;
  floodCount: number;
  worstStatus: string;
  statusCounts: Record<string, number>;
}

const STATUS_SEVERITY: Record<string, number> = {
  major: 6,
  moderate: 5,
  minor: 4,
  action: 3,
  no_flooding: 2,
  not_defined: 1,
  obs_not_current: 1,
  out_of_service: 1,
};

// Statuses that represent active flood conditions (action stage or higher)
export const FLOOD_STATUSES = new Set(['action', 'minor', 'moderate', 'major']);

export function aggregateToHex(
  gauges: GaugeGeoJSON,
  resolution: number,
): HexFeatureCollection {
  const hexMap = new Map<
    string,
    {
      coords: [number, number][];
      count: number;
      floodCount: number;
      worstStatus: string;
      worstSeverity: number;
      statusCounts: Record<string, number>;
    }
  >();

  for (const feature of gauges.features) {
    const [lng, lat] = feature.geometry.coordinates;
    const status = feature.properties.status;

    let h3Index: string;
    try {
      h3Index = latLngToCell(lat, lng, resolution);
    } catch {
      continue;
    }

    const existing = hexMap.get(h3Index);
    const severity = STATUS_SEVERITY[status] ?? 1;

    const isFlood = FLOOD_STATUSES.has(status);

    if (existing) {
      existing.count++;
      if (isFlood) existing.floodCount++;
      existing.statusCounts[status] = (existing.statusCounts[status] || 0) + 1;
      if (severity > existing.worstSeverity) {
        existing.worstStatus = status;
        existing.worstSeverity = severity;
      }
    } else {
      // cellToBoundary returns [lat, lng][] — we need [lng, lat][] for GeoJSON
      const boundary = cellToBoundary(h3Index);
      const coords = boundary.map(
        ([bLat, bLng]) => [bLng, bLat] as [number, number],
      );
      coords.push(coords[0]); // close the ring
      hexMap.set(h3Index, {
        coords,
        count: 1,
        floodCount: isFlood ? 1 : 0,
        worstStatus: status,
        worstSeverity: severity,
        statusCounts: { [status]: 1 },
      });
    }
  }

  const features: HexFeature[] = [];
  for (const [h3Index, hex] of hexMap) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [hex.coords],
      },
      properties: {
        h3Index,
        count: hex.count,
        floodCount: hex.floodCount,
        worstStatus: hex.worstStatus,
        statusCounts: hex.statusCounts,
      } satisfies HexProperties,
    });
  }

  return { type: 'FeatureCollection', features };
}
