import { defineConfig, devices } from "@playwright/test";

// T4 end-to-end smoke (plan §5): a canary against a real GeoLibre web
// build, not a UI suite. Kept out of `npm test`; run via `npm run
// test:e2e`. GEOLIBRE_URL lets a developer point the suite at an
// already-running local GeoLibre dev server instead of the CI-managed
// checkout+build+serve pipeline (.github/workflows/e2e.yml).
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.GEOLIBRE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
