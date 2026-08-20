// Source of truth: flood.live src/types/gauge.ts
// Ported verbatim; no deviations.

export type FloodCategory =
  | "major"
  | "moderate"
  | "minor"
  | "action"
  | "no_flooding"
  | "not_defined"
  | "obs_not_current"
  | "out_of_service";

export interface GaugeProperties {
  gaugelid: string;
  status: FloodCategory;
  location: string;
  waterbody: string;
  state: string;
  observed: number | null;
  latitude: number;
  longitude: number;
  action: number | null;
  flood: number | null;
  moderate: number | null;
  major: number | null;
  units: string;
  obstime: string;
  wfo: string;
}

export interface GaugeFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: GaugeProperties;
}

export interface GaugeGeoJSON {
  type: "FeatureCollection";
  features: GaugeFeature[];
}

// Actual NWPS stageflow data point — primary/secondary are direct numbers
export interface StageFlowPoint {
  validTime: string;
  primary: number | null;
  secondary: number | null;
}

// Actual NWPS gauge detail response
export interface GaugeDetail {
  lid: string;
  name: string;
  state: { abbreviation: string; name: string };
  county: string;
  latitude: number;
  longitude: number;
  flood: {
    stageUnits: string;
    categories: {
      major: { stage: number | null; flow: number | null };
      moderate: { stage: number | null; flow: number | null };
      minor: { stage: number | null; flow: number | null };
      action: { stage: number | null; flow: number | null };
    };
  };
  status: {
    observed: {
      primary: number | null;
      primaryUnit: string;
      floodCategory: string;
    };
  };
}

export interface StageFlowResponse {
  observed: {
    primaryUnits: string;
    data: StageFlowPoint[];
  };
  forecast: {
    primaryUnits: string;
    data: StageFlowPoint[];
  };
}
