// Source of truth: flood.live src/config/constants.ts
// Ported subset only (per build spec): NOAA_MAP_SERVER_URL, NOAA_NWPS_BASE_URL,
// FLOOD_COLORS, MAP_SERVER_FIELDS, PAGE_SIZE, REFRESH_INTERVAL.

export const NOAA_MAP_SERVER_URL =
  "https://mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer/0/query";
export const NOAA_NWPS_BASE_URL = "https://api.water.noaa.gov/nwps/v1/gauges";

export const FLOOD_COLORS: Record<string, string> = {
  major: "#cc33ff",
  moderate: "#ff0000",
  minor: "#ff9900",
  action: "#ffe033",
  no_flooding: "#00ff00",
  not_defined: "#888888",
  obs_not_current: "#888888",
  out_of_service: "#888888",
};

export const MAP_SERVER_FIELDS =
  "gaugelid,status,location,waterbody,state,observed,latitude,longitude,action,flood,moderate,major,units,obstime,wfo";
export const PAGE_SIZE = 5000;
export const REFRESH_INTERVAL = 30 * 60 * 1000;
