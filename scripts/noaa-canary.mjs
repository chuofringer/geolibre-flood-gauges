#!/usr/bin/env node
// T5: live upstream canary (plan §5, weekly cron). Hits the real NOAA
// MapServer (one page) and NWPS (one known-stable gauge, no mocks) and
// asserts the shapes our port depends on haven't silently drifted:
// expected fields present, `status` values within our enum, sane
// geometry, parsed `obstime` recency, and unchanged `stageflow` shape.
// An encoding change that still passes "field present" but breaks
// parsing must fail loudly here, not silently trip the plugin's D4
// fail-open every refresh cycle forever.
//
// --record rewrites tests/fixtures/ from the live responses (used to
// refresh T2/T4 fixtures in a PR, never run unattended in CI).
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const fixturesDir = join(rootDir, "tests", "fixtures");

const NOAA_MAP_SERVER_URL =
  "https://mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer/0/query";
const NOAA_NWPS_BASE_URL = "https://api.water.noaa.gov/nwps/v1/gauges";
const MAP_SERVER_FIELDS =
  "gaugelid,status,location,waterbody,state,observed,latitude,longitude,action,flood,moderate,major,units,obstime,wfo";

// A gauge that's been continuously reporting for years — a reasonable
// "known-stable" pick for a recency assertion. If NOAA ever decommissions
// it, swap for another long-lived gauge; the canary failing here isn't
// itself the drift signal, "a minimum share of the page is stale" is.
const CANARY_GAUGE_ID = "PTTP1";

const STATUS_ENUM = new Set([
  "major",
  "moderate",
  "minor",
  "action",
  "no_flooding",
  "not_defined",
  "obs_not_current",
  "out_of_service",
]);

const RECENCY_HOURS = 48;
const MIN_RECENT_SHARE = 0.5;

const record = process.argv.includes("--record");
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`canary: FAIL — ${message}`);
}

function normalizeStatus(raw) {
  const key = raw?.toLowerCase().replace(/\s+/g, "_") ?? "";
  return STATUS_ENUM.has(key) ? key : "not_defined";
}

async function checkMapServer() {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: MAP_SERVER_FIELDS,
    f: "geojson",
    resultRecordCount: "200",
    resultOffset: "0",
  });
  const res = await fetch(`${NOAA_MAP_SERVER_URL}?${params}`);
  if (!res.ok) {
    fail(`MapServer HTTP ${res.status}`);
    return null;
  }
  const data = await res.json();
  const features = data.features ?? [];
  if (features.length === 0) {
    fail("MapServer returned zero features");
    return data;
  }

  let recentCount = 0;
  for (const feature of features) {
    const p = feature.properties ?? {};
    for (const field of ["gaugelid", "status", "observed", "obstime"]) {
      if (!(field in p)) fail(`MapServer feature missing field "${field}"`);
    }
    const status = normalizeStatus(p.status);
    if (!STATUS_ENUM.has(status)) fail(`MapServer status "${p.status}" outside our enum`);

    const [lng, lat] = feature.geometry?.coordinates ?? [];
    if (typeof lng !== "number" || typeof lat !== "number" || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
      fail(`MapServer feature ${p.gaugelid ?? "?"} has insane coordinates [${lng}, ${lat}]`);
    }

    const obsMs = Date.parse(p.obstime);
    if (!Number.isNaN(obsMs) && Date.now() - obsMs < RECENCY_HOURS * 3_600_000) recentCount++;
  }

  const share = recentCount / features.length;
  if (share < MIN_RECENT_SHARE) {
    fail(
      `only ${(share * 100).toFixed(0)}% of ${features.length} gauges have an obstime parsed as < ${RECENCY_HOURS}h old ` +
        `(need >= ${MIN_RECENT_SHARE * 100}%) — an obstime encoding change would show up as low recency even with all fields present`,
    );
  }

  return data;
}

async function checkNwps() {
  const res = await fetch(`${NOAA_NWPS_BASE_URL}/${CANARY_GAUGE_ID}/stageflow`);
  if (!res.ok) {
    fail(`NWPS stageflow HTTP ${res.status} for ${CANARY_GAUGE_ID}`);
    return null;
  }
  const data = await res.json();
  for (const section of ["observed", "forecast"]) {
    if (!data[section] || !Array.isArray(data[section].data)) {
      fail(`NWPS stageflow missing "${section}.data" array`);
      continue;
    }
    for (const point of data[section].data.slice(0, 5)) {
      if (!("validTime" in point) || !("primary" in point)) {
        fail(`NWPS stageflow ${section} point missing validTime/primary`);
        break;
      }
    }
  }
  return data;
}

async function main() {
  const mapServerData = await checkMapServer();
  const nwpsData = await checkNwps();

  if (record) {
    await writeFile(
      join(fixturesDir, "mapserver-page.json"),
      JSON.stringify(mapServerData, null, 2) + "\n",
    );
    await writeFile(join(fixturesDir, "nwps-stageflow.json"), JSON.stringify(nwpsData, null, 2) + "\n");
    console.log("canary: fixtures re-recorded from live NOAA responses");
  }

  if (failures.length > 0) {
    console.error(`canary: ${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("canary: OK — NOAA MapServer and NWPS shapes match expectations");
}

main().catch((err) => {
  console.error("canary: unhandled error", err);
  process.exit(1);
});
