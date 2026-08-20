// @vitest-environment jsdom
//
// T3 host-contract suite (plan §5): exercises the assembled plugin object
// (src/geolibre.ts) end to end against FakeHost, covering the lifecycle
// concerns layer.test.ts/gaugePanel.test.ts don't already cover at the
// module level: activate/deactivate/reactivate, project-state host
// orderings, deep-link handling through the real plugin, and graceful
// degradation against a minimal host.
//
// Each test loads a fresh module instance (vi.resetModules + dynamic
// import) so the plugin's module-level session state (selected gauge,
// pending project state) never leaks between tests.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeHost } from "./support/fakeHost";
import type { GeoLibrePlugin } from "../src/host/geolibre-api";
import type { GaugeGeoJSON, GaugeFeature } from "../src/core/types";

function gauge(lid: string): GaugeFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-91.5, 38.2] },
    properties: {
      gaugelid: lid,
      status: "action",
      location: "Somewhere",
      waterbody: "Some River",
      state: "PA",
      observed: 5,
      latitude: 38.2,
      longitude: -91.5,
      action: 4,
      flood: 6,
      moderate: 8,
      major: 10,
      units: "ft",
      obstime: "2026-08-19T12:00:00Z",
      wfo: "PBZ",
    },
  };
}

function collection(features: GaugeFeature[]): GaugeGeoJSON {
  return { type: "FeatureCollection", features };
}

function stubGaugeFetch(data: GaugeGeoJSON): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("mapservices.weather.noaa.gov")) {
        return new Response(JSON.stringify(data), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }),
  );
}

async function loadPlugin(): Promise<GeoLibrePlugin> {
  vi.resetModules();
  const mod = await import("../src/geolibre.ts");
  return mod.plugin;
}

describe("plugin (T3 host contract)", () => {
  let host: FakeHost;

  beforeEach(() => {
    host = new FakeHost();
  });

  afterEach(() => {
    host.dispose();
    vi.unstubAllGlobals();
  });

  it("activate registers exactly one layer with the D3 style snapshot", async () => {
    stubGaugeFetch(collection([gauge("PTTP1")]));
    const plugin = await loadPlugin();
    plugin.activate(host.app);
    await vi.waitFor(() => expect(host.layers.size).toBe(3));

    const layer = host.layers.get("flood-gauges-layer")!;
    expect(layer.nativeLayerIds.length).toBeGreaterThan(0);
    expect(layer.metadata?.originalUrl).toBeTruthy();
    expect(layer.style).toBeDefined();
    expect(typeof layer.style?.vectorStyleExpression).toBe("string");
    expect(() => JSON.parse(layer.style!.vectorStyleExpression!)).not.toThrow();

    plugin.deactivate(host.app);
  });

  it("activate -> deactivate -> activate leaves exactly one of everything", async () => {
    stubGaugeFetch(collection([gauge("PTTP1")]));
    const plugin = await loadPlugin();

    plugin.activate(host.app);
    await vi.waitFor(() => expect(host.layers.size).toBe(3));
    expect(host.panels.size).toBe(1);

    plugin.deactivate(host.app);
    expect(host.layers.size).toBe(0);
    expect(host.panels.size).toBe(0);
    expect(host.map!.liveHandlerCount).toBe(0);
    expect(host.windowListeners.length).toBe(0);

    plugin.activate(host.app);
    await vi.waitFor(() => expect(host.layers.size).toBe(3));
    expect(host.panels.size).toBe(1);
    // No handler stacking across the reactivate cycle.
    expect(host.map!.liveHandlerCount).toBe(9); // click/enter/leave × points + 2 hex tiers
    expect(host.windowListeners.length).toBe(1); // geolibre-layer-labels-change

    plugin.deactivate(host.app);
  });

  it("deactivate racing a fetch: zero registrations land after stop", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const body = JSON.stringify(collection([gauge("PTTP1")]));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await gate;
        return new Response(body, { status: 200 });
      }),
    );
    const plugin = await loadPlugin();
    plugin.activate(host.app);
    plugin.deactivate(host.app);
    releaseGate();
    await new Promise((r) => setTimeout(r, 10));

    expect(host.layers.size).toBe(0);
  });

  it("handleUrlParameters: valid id fits bounds and opens the panel", async () => {
    stubGaugeFetch(collection([gauge("PTTP1")]));
    const plugin = await loadPlugin();
    plugin.activate(host.app);
    await vi.waitFor(() => expect(host.layers.size).toBe(3));

    await plugin.handleUrlParameters?.(host.app, new URLSearchParams({ "flood-gauge": "PTTP1" }));
    expect(host.fitBoundsCalls).toHaveLength(1);
    expect(host.openPanels.has("flood-gauges-panel")).toBe(true);

    plugin.deactivate(host.app);
  });

  it("handleUrlParameters: unknown id opens the not-found panel, never throws", async () => {
    stubGaugeFetch(collection([gauge("PTTP1")]));
    const plugin = await loadPlugin();
    plugin.activate(host.app);
    await vi.waitFor(() => expect(host.layers.size).toBe(3));

    await expect(
      plugin.handleUrlParameters?.(host.app, new URLSearchParams({ "flood-gauge": "NOPE1" })),
    ).resolves.toBeUndefined();
    expect(host.fitBoundsCalls).toHaveLength(0);
    expect(host.openPanels.has("flood-gauges-panel")).toBe(true);

    const panel = host.panels.get("flood-gauges-panel")!;
    const container = document.createElement("div");
    panel.render(container);
    expect(container.querySelector(".fg-lid")?.textContent).toBe("NOPE1");
    expect(container.textContent).toContain("No gauge found for this id.");
    expect(container.textContent).toContain(
      "Check the NOAA LID (letters and digits, up to 10 characters).",
    );
    expect(container.querySelector(".fg-link")).toBeNull();

    plugin.deactivate(host.app);
  });

  it("applyProjectState before activate is cached, then honored once the manager is ready", async () => {
    stubGaugeFetch(collection([gauge("PTTP1")]));
    const plugin = await loadPlugin();

    plugin.applyProjectState?.(host.app, { v: 1, selectedGauge: "PTTP1" });
    expect(host.openPanels.size).toBe(0); // not yet active — nothing happens yet

    plugin.activate(host.app);
    await vi.waitFor(() => expect(host.openPanels.has("flood-gauges-panel")).toBe(true));

    plugin.deactivate(host.app);
  });

  it("applyProjectState on an already-active plugin takes effect immediately", async () => {
    stubGaugeFetch(collection([gauge("PTTP1")]));
    const plugin = await loadPlugin();
    plugin.activate(host.app);
    await vi.waitFor(() => expect(host.layers.size).toBe(3));

    expect(host.openPanels.size).toBe(0);
    plugin.applyProjectState?.(host.app, { v: 1, selectedGauge: "PTTP1" });
    await vi.waitFor(() => expect(host.openPanels.has("flood-gauges-panel")).toBe(true));

    plugin.deactivate(host.app);
  });

  it("applyProjectState never throws on garbage payloads and activation still succeeds", async () => {
    stubGaugeFetch(collection([gauge("PTTP1")]));
    const plugin = await loadPlugin();

    for (const garbage of [null, undefined, "nope", 42, { v: 2 }, { v: 1, selectedGauge: "../../x" }]) {
      expect(() => plugin.applyProjectState?.(host.app, garbage)).not.toThrow();
    }

    expect(() => plugin.activate(host.app)).not.toThrow();
    await vi.waitFor(() => expect(host.layers.size).toBe(3));

    plugin.deactivate(host.app);
  });

  it("getProjectState stays under a 1 KB size budget", async () => {
    const plugin = await loadPlugin();
    const state = plugin.getProjectState?.();
    const bytes = new TextEncoder().encode(JSON.stringify(state)).length;
    expect(bytes).toBeLessThan(1024);
  });

  it("id/name/version are internally consistent", async () => {
    const plugin = await loadPlugin();
    expect(plugin.id).toBe("geolibre-flood-gauges");
    expect(plugin.name).toBe("US Live Flood Gauges");
    expect(plugin.version).toBe("0.3.0");
    expect(plugin.urlParameterNames).toContain("flood-gauge");
  });

  it("degrades without throwing against a minimal host with every optional member deleted", async () => {
    stubGaugeFetch(collection([gauge("PTTP1")]));
    const minimalHost = new FakeHost({ minimal: true, map: null });
    const plugin = await loadPlugin();

    expect(() => plugin.activate(minimalHost.app)).not.toThrow();
    await expect(
      plugin.handleUrlParameters?.(minimalHost.app, new URLSearchParams({ "flood-gauge": "PTTP1" })),
    ).resolves.not.toThrow();
    expect(() => plugin.applyProjectState?.(minimalHost.app, { v: 1, selectedGauge: "PTTP1" })).not.toThrow();
    expect(() => plugin.getProjectState?.()).not.toThrow();
    expect(() => plugin.deactivate(minimalHost.app)).not.toThrow();

    minimalHost.dispose();
  });
});
