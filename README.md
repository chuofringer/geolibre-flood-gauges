# US Live Flood Gauges — a GeoLibre plugin

**By [flood.live](https://flood.live)** — real-time US flood monitoring
with email alerts · made by [chuofringer](https://github.com/chuofringer)
([vibemapper.dev](https://vibemapper.dev))

A live layer of 10,000+ US river and coastal flood gauges from NOAA/NWPS
on your [GeoLibre](https://geolibre.app) map, with flood-category
symbology, per-gauge hydrographs, and shareable deep links. Want alerts
when a gauge near you rises? That's what
[flood.live](https://flood.live) does.

At low zoom the map shows an **H3 flood overview** (ported from
flood.live's hex presentation): only regions with active flood
conditions light up, colored by the worst gauge status in each cell —
quiet country stays clean. Click a hex to zoom in; from zoom 6 the
individual gauge dots take over, and clicking a dot opens its panel.

This plugin ports flood.live's production domain logic (flood-category
thresholds, trend detection, NOAA fetch pipeline) into GeoLibre; every
ported file carries a `// Source of truth: flood.live <path>` header
noting any deviation.

![H3 flood overview: only flood-active regions light up at national zoom](docs/screenshot-conus.png)

![Gauge panel with thresholds, staleness, and hydrograph](docs/screenshot-panel.png)

## Data & provenance

- Gauge points and current status: NOAA MapServer
  (`mapservices.weather.noaa.gov`), refreshed every 30 minutes.
- Thresholds, gauge detail, and stage/flow history: NOAA/NWPS
  (`api.water.noaa.gov`), fetched when you open a gauge's panel.
- **This is not for life-safety decisions.** Always follow official NOAA
  and local emergency management guidance during an active flood event.

## Install

- **Registry** — coming soon (pending the `opengeos/geolibre-plugins`
  registry PR).
- **Side-load a zip** — download a release's
  `geolibre-flood-gauges-<version>.zip` from the
  [Releases](../../releases) page and install it from a local file in
  GeoLibre's plugin manager.
- **Manifest URL** — point GeoLibre's "install from URL" at a
  `plugin.json` you're serving yourself (see Development below).

## Usage

Click any gauge dot to open its panel: category badge, threshold table,
staleness indicator, and a hydrograph.

Deep link straight to a gauge:

```
https://web.geolibre.app/?flood-gauge=PTTP1
```

`flood-gauge` takes a NOAA gauge LID (letters/digits, up to 10
characters). The panel footer's "Open on flood.live" link takes you to
the full flood.live experience for that gauge.

## Development

This repo builds a GeoLibre plugin bundle only — there's no standalone
dev server; iterate with `build:geolibre` + `serve:geolibre` against a
GeoLibre checkout.

```bash
npm install
npm run build:geolibre  # -> geolibre-plugin/dist/{index.js,style.css}
npm run serve:geolibre   # CORS static server; prints a manifest URL you
                          # can paste into GeoLibre's "install from URL"
npm run package:geolibre # -> geolibre-plugin/geolibre-flood-gauges-<version>.zip
npm run lint
npm run typecheck
```

The vendored GeoLibre host contract lives in `src/host/geolibre-api.ts`
(types only, no runtime) — see that file's header for why it's vendored
rather than imported from `geolibre-plugin-template`.

## Testing

```bash
npm test          # vitest: unit, network-contract, and host-contract suites
npm run test:e2e   # Playwright smoke vs. a real GeoLibre build (see below)
npm run canary      # live NOAA shape/recency check (no mocks)
```

- **Unit + network-contract + host-contract** (`tests/`) run on every PR:
  ported flood.live logic, NOAA pagination/error handling, and the full
  plugin lifecycle against a `FakeHost` harness (`tests/support/fakeHost.ts`)
  covering registration, teardown, deep links, and project-state edge
  cases.
- **End-to-end** (`e2e/`, Playwright) runs nightly and on `src/` PRs
  against a real, pinned GeoLibre web build with NOAA traffic stubbed via
  route interception. It accepts a `GEOLIBRE_URL` env override so you can
  point it at an already-running local GeoLibre dev server instead of the
  CI-managed checkout:

  ```bash
  GEOLIBRE_URL=http://localhost:5173 npm run test:e2e
  ```

- **NOAA canary** (`scripts/noaa-canary.mjs`) runs weekly against the
  live NOAA endpoints (no mocks) and opens an issue on failure. Run it
  with `--record` to refresh the fixtures in `tests/fixtures/` and
  `e2e/fixtures/` from live data.
- **Package/registry conformance** (`scripts/validate-plugin.mjs`) runs
  after every build in CI: imports the bundle, checks id/name/version
  consistency across `plugin.json`/`package.json`/the exported plugin
  object, and enforces a 1 MB bundle budget.

## License

MIT — see [LICENSE](LICENSE).

Made by [chuofringer](https://github.com/chuofringer) · [vibemapper.dev](https://vibemapper.dev)
