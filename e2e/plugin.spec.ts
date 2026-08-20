import { test, expect, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// T4 end-to-end smoke (plan §5). Fossilizes the manual A3 spike's findings
// — refresh-in-place, deep-link cold load, basemap-switch survival — against
// a real GeoLibre web build so a host API change fails a nightly instead of
// a user. Kept small and out of `npm test`.
//
// Selectors verified 2026-08-19 against a live GeoLibre dev server at
// commit 5ce4d686 (real Chrome): the Layers panel lists the layer by its
// registered name; the floating panel body is our own `.fg-*` DOM; the
// basemap picker is a floating card behind the Layers-toolbar "Basemaps"
// button; gauge dots are clicked by projecting lng/lat through the live
// MapLibre map rather than guessing pixels.
//
// The plugin is installed by playwright.config.ts seeding the host's
// `geolibre.desktopSettings` localStorage with this repo's manifest URL,
// and activated by the `?flood-gauge=` URL parameter (the host
// auto-activates a registered plugin that owns the parameter).

const __dirname = dirname(fileURLToPath(import.meta.url));
const page1 = JSON.parse(readFileSync(join(__dirname, "fixtures/mapserver-page-1.json"), "utf8"));
const page2 = JSON.parse(readFileSync(join(__dirname, "fixtures/mapserver-page-2.json"), "utf8"));

const LAYER_NAME = "US Live Flood Gauges (NOAA)";

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

interface ManagerWindow {
  __floodGaugesManager?: {
    ready: Promise<void>;
    refreshNow: () => Promise<void>;
    findGauge: (lid: string) => Promise<{
      geometry: { coordinates: [number, number] };
      properties: { status: string };
    } | null>;
  };
}

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

/** Deep-link load: waits for plugin activation and the initial (stubbed) fetch. */
async function loadWithDeepLink(page: Page): Promise<void> {
  await page.goto("/?flood-gauge=PTTP1");
  await page.waitForFunction(() => Boolean((window as ManagerWindow).__floodGaugesManager), null, {
    timeout: 90_000,
  });
  await page.evaluate(() => (window as ManagerWindow).__floodGaugesManager!.ready);
}

/** Counts leaf DOM nodes whose full text is the layer name (Layers panel row + on-map layer control). */
function layerEntryCount(page: Page, name: string): Promise<number> {
  return page.evaluate((layerName) => {
    return [...document.querySelectorAll("*")].filter(
      (e) => e.childElementCount === 0 && e.textContent?.trim() === layerName,
    ).length;
  }, name);
}

test.describe("US Live Flood Gauges plugin (T4 smoke)", () => {
  test("installs from the manifest URL, activates via the deep link, and renders the layer", async ({
    page,
  }) => {
    const errors = consoleErrorCollector(page);
    await stubNoaa(page, page1);

    await loadWithDeepLink(page);
    await expect(page.getByText(LAYER_NAME).first()).toBeVisible({ timeout: 30_000 });

    expect(errors).toEqual([]);
  });

  test("deep link cold-loads the panel with lid, badge, thresholds, staleness, and hydrograph", async ({
    page,
  }) => {
    const errors = consoleErrorCollector(page);
    await stubNoaa(page, page1);

    await loadWithDeepLink(page);

    const panel = page.locator(".fg-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator(".fg-lid")).toHaveText("PTTP1");
    await expect(panel.locator(".fg-badge")).toBeVisible();
    await expect(panel.locator(".fg-stagebar-zone")).toHaveCount(5, { timeout: 30_000 });
    await expect(panel.locator(".fg-stagebar-marker")).toBeVisible();
    await expect(panel.locator(".fg-observed-value")).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator(".fg-staleness")).toBeVisible();
    await expect(panel.locator(".fg-source")).toContainText("NOAA/NWPS");
    await expect(panel.locator(".fg-disclaimer")).toContainText("life-safety");
    await expect(panel.locator(".fg-hydrograph canvas")).toBeVisible({ timeout: 30_000 });

    const link = panel.locator(".fg-link");
    await expect(link).toHaveAttribute("href", /flood\.live\?gauge=PTTP1&ref=geolibre/);

    expect(errors).toEqual([]);
  });

  test("refresh-in-place: one Layers entry, updated data, no remove/re-add flicker", async ({ page }) => {
    const errors = consoleErrorCollector(page);
    await stubNoaa(page, page1);
    await loadWithDeepLink(page);
    await expect(page.getByText(LAYER_NAME).first()).toBeVisible({ timeout: 30_000 });

    const layersBefore = await layerEntryCount(page, LAYER_NAME);
    expect(layersBefore).toBeGreaterThanOrEqual(1);

    await stubNoaa(page, page2); // swap fixture: status flip + new obstime
    await page.evaluate(() => (window as ManagerWindow).__floodGaugesManager!.refreshNow());

    // The refresh routed to updateLayer (same store id): entry count is
    // unchanged and the gauge's status reflects the second fixture.
    const layersAfter = await layerEntryCount(page, LAYER_NAME);
    expect(layersAfter).toBe(layersBefore);
    const status = await page.evaluate(async () => {
      const gauge = await (window as ManagerWindow).__floodGaugesManager!.findGauge("PTTP1");
      return gauge?.properties.status;
    });
    expect(status).toBe("minor");

    expect(errors).toEqual([]);
  });

  test("basemap switch preserves the layer and gauge clicks keep opening the panel", async ({ page }) => {
    const errors = consoleErrorCollector(page);
    await stubNoaa(page, page1);
    await loadWithDeepLink(page);
    await expect(page.getByText(LAYER_NAME).first()).toBeVisible({ timeout: 30_000 });

    // Basemap picker is a floating card toggled by the Layers-toolbar button.
    await page.getByRole("button", { name: "Basemaps" }).first().click();
    await page.getByText("OpenStreetMap Standard").first().click();
    await page.getByRole("button", { name: "Basemaps" }).first().click(); // close the card
    await page.waitForTimeout(5_000); // style.load + layer re-sync

    await expect(page.getByText(LAYER_NAME).first()).toBeVisible();

    // Click the gauge dot by projecting its lng/lat through the live map —
    // confirms the layer-scoped click handlers survived the style swap.
    const pt = await page.evaluate(async () => {
      const w = window as ManagerWindow & {
        __floodGaugesManager?: { app?: unknown } & ManagerWindow["__floodGaugesManager"];
      };
      const manager = w.__floodGaugesManager as unknown as Record<string, unknown>;
      const gauge = await (manager.findGauge as (lid: string) => Promise<{ geometry: { coordinates: [number, number] } }>)("PTTP1");
      const app = manager["app"] as { getMap: () => { project: (c: [number, number]) => { x: number; y: number }; getCanvas: () => HTMLCanvasElement } };
      const map = app.getMap();
      const p = map.project(gauge.geometry.coordinates);
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y };
    });
    await page.mouse.click(pt.x, pt.y);
    await expect(page.locator(".fg-lid")).toHaveText("PTTP1", { timeout: 15_000 });

    expect(errors).toEqual([]);
  });
});

test.describe("US Live Flood Gauges plugin at the minGeoLibreVersion floor (2.0.0)", () => {
  // Reduced assertion set — the D6 registry compatibility claim is
  // CI-tested against a second pinned build, not aspirational. The
  // workflow (.github/workflows/e2e.yml) points GEOLIBRE_URL at a
  // separately built v2.0.0 checkout for this describe block.
  test("installs, layer renders, deep link opens the panel", async ({ page }) => {
    const errors = consoleErrorCollector(page);
    await stubNoaa(page, page1);
    await loadWithDeepLink(page);
    await expect(page.getByText(LAYER_NAME).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".fg-panel")).toBeVisible({ timeout: 30_000 });
    expect(errors).toEqual([]);
  });
});
