import { defineConfig, devices } from "@playwright/test";

// T4 end-to-end smoke (plan §5): a canary against a real GeoLibre web
// build, not a UI suite. Kept out of `npm test`; run via `npm run
// test:e2e`. GEOLIBRE_URL points the suite at a running GeoLibre web app;
// PLUGIN_MANIFEST_URL is this repo's served plugin manifest (see
// `npm run serve:geolibre` and .github/workflows/e2e.yml).
const BASE_URL = process.env.GEOLIBRE_URL ?? "http://localhost:5173";
const PLUGIN_MANIFEST_URL = process.env.PLUGIN_MANIFEST_URL ?? "http://localhost:8000/plugin.json";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    // Seed the host's localStorage-backed settings: skip the first-launch
    // onboarding wizard (its overlay intercepts clicks) and register this
    // repo's plugin manifest URL so the external-plugin loader picks it up
    // on startup — the same mechanism the Manage Plugins dialog writes.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [
            {
              name: "geolibre.desktopSettings",
              value: JSON.stringify({
                uiProfile: { onboarded: true },
                pluginManifestUrls: [PLUGIN_MANIFEST_URL],
              }),
            },
          ],
        },
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
