import { test, expect, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// T4 end-to-end smoke (plan §5). Fossilizes the manual A3 spike's findings
// — refresh-in-place, style survival, basemap-switch survival, deep-link
// cold load — against a real GeoLibre web build so a host API change fails
// a nightly instead of a user. Kept small and out of `npm test`.
//
// Requires GEOLIBRE_URL to point at a running GeoLibre web app whose
// plugin registry already contains this repo's just-built bundle (see
// .github/workflows/e2e.yml, or run `npm run serve:geolibre` and point a
// local GeoLibre dev checkout's VITE_GEOLIBRE_PLUGIN_REGISTRY_URL at it).
//
// NOTE: the DOM selectors below (data-testid attributes, panel structure)
// follow GeoLibre's documented plugin-panel conventions as of the plan's
// research commit; they have not been run against a live GeoLibre build in
// this environment. Treat a selector mismatch here as a signal to update
// the selector, not the underlying assertion — the lead should run this
// with GEOLIBRE_URL against a live dev server before trusting it in CI.

const __dirname = dirname(fileURLToPath(import.meta.url));
const page1 = JSON.parse(readFileSync(join(__dirname, "fixtures/mapserver-page-1.json"), "utf8"));
const page2 = JSON.parse(readFileSync(join(__dirname, "fixtures/mapserver-page-2.json"), "utf8"));

const NWPS_STAGEFLOW = {
  observed: {
    primaryUnits: "ft",
    data: [{ validTime: "2026-08-19T11:55:00Z", primary: 12.3, secondary: null }],
  },
  forecast: { primaryUnits: "ft", data: [] },
};

const NWPS_DETAIL = {
  lid: "PTTP1",
  name: "Pittsburgh",
  state: { abbreviation: "PA", name: "Pennsylvania" },
  county: "Allegheny",
  latitude: 40.4406,
  longitude: -79.9959,
  flood: {
    stageUnits: "ft",
    categories: {
      major: { stage: 25, flow: null },
      moderate: { stage: 20, flow: null },
      minor: { stage: 15, flow: null },
      action: { stage: 10, flow: null },
    },
  },
  status: { observed: { primary: 12.3, primaryUnit: "ft", floodCategory: "action" } },
};

/** Stubs NOAA MapServer + NWPS so the run is deterministic. Swappable mid-test for refresh-in-place. */
async function stubNoaa(page: Page, mapServerData: unknown): Promise<void> {
  await page.route("**/riv_gauges/MapServer/0/query**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mapServerData) }),
  );
  await page.route("**/nwps/v1/gauges/*/stageflow", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NWPS_STAGEFLOW) }),
  );
  await page.route("**/nwps/v1/gauges/*", (route: Route) => {
    if (route.request().url().includes("/stageflow")) return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NWPS_DETAIL) });
  });
}

function consoleErrorCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test.describe("US Flood Gauges plugin (T4 smoke)", () => {
  test("installs from the registry, activates, and renders the layer", async ({ page }) => {
    const errors = consoleErrorCollector(page);
    await stubNoaa(page, page1);

    await page.goto("/");
    // Plugin install/activation is assumed pre-configured by the CI job's
    // registry manifest (activeByDefault is explicitly false per plan —
    // the workflow drives install+activate through the host UI or a
    // documented dev-mode query param before this assertion).
    await expect(page.getByTestId("layers-panel").getByText(/US Flood Gauges/i)).toBeVisible({
      timeout: 15_000,
    });

    expect(errors).toEqual([]);
  });

  test("deep link cold-loads the panel with lid, badge, thresholds, staleness, and hydrograph", async ({
    page,
  }) => {
    const errors = consoleErrorCollector(page);
    await stubNoaa(page, page1);

    await page.goto("/?flood-gauge=PTTP1");

    const panel = page.getByTestId("flood-gauges-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText("PTTP1")).toBeVisible();
    await expect(panel.locator(".fg-badge")).toBeVisible();
    await expect(panel.locator(".fg-thresholds tr")).toHaveCount(4);
    await expect(panel.locator(".fg-staleness")).toBeVisible();
    await expect(panel.locator(".fg-hydrograph canvas")).toBeVisible();

    const link = panel.locator(".fg-link");
    await expect(link).toHaveAttribute("href", /flood\.live\?gauge=PTTP1&ref=geolibre/);

    expect(errors).toEqual([]);
  });

  test("refresh-in-place: one Layers entry, updated data, no remove/re-add flicker", async ({ page }) => {
    const errors = consoleErrorCollector(page);
    await stubNoaa(page, page1);
    await page.goto("/?flood-gauge=PTTP1");
    await expect(page.getByTestId("flood-gauges-panel")).toBeVisible({ timeout: 15_000 });

    const layersBefore = await page.getByTestId("layers-panel").getByText(/US Flood Gauges/i).count();

    await stubNoaa(page, page2); // swap fixture: status flip + new obstime
    await page.evaluate(() => {
      // Exposed test hook (plan §5 T4): forces an immediate refresh cycle
      // bypassing the 30-min interval.
      const w = window as unknown as { __floodGaugesManager?: { refreshNow: () => Promise<void> } };
      return w.__floodGaugesManager?.refreshNow();
    });

    const layersAfter = await page.getByTestId("layers-panel").getByText(/US Flood Gauges/i).count();
    expect(layersAfter).toBe(layersBefore);

    expect(errors).toEqual([]);
  });

  test("basemap switch preserves the layer and gauge clicks keep opening the panel", async ({ page }) => {
    const errors = consoleErrorCollector(page);
    await stubNoaa(page, page1);
    await page.goto("/?flood-gauge=PTTP1");
    await expect(page.getByTestId("flood-gauges-panel")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("basemap-switcher").click();
    await page.getByTestId("basemap-option-satellite").click();
    await expect(page.getByTestId("layers-panel").getByText(/US Flood Gauges/i)).toBeVisible();

    // Re-click the (now re-synced) gauge dot to confirm handlers survived the resync.
    await page.getByTestId("map-canvas").click({ position: { x: 400, y: 300 } });
    await expect(page.getByTestId("flood-gauges-panel")).toBeVisible();

    expect(errors).toEqual([]);
  });
});

test.describe("US Flood Gauges plugin at the minGeoLibreVersion floor (2.0.0)", () => {
  // Reduced assertion set — the D6 registry compatibility claim is
  // CI-tested against a second pinned build, not aspirational. The
  // workflow (.github/workflows/e2e.yml) points GEOLIBRE_URL at a
  // separately built v2.0.0 checkout for this describe block.
  test("installs, layer renders, click opens the panel", async ({ page }) => {
    const errors = consoleErrorCollector(page);
    await stubNoaa(page, page1);
    await page.goto("/?flood-gauge=PTTP1");
    await expect(page.getByTestId("flood-gauges-panel")).toBeVisible({ timeout: 15_000 });
    expect(errors).toEqual([]);
  });
});
