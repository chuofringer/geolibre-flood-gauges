// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GaugeLayerManager, LAYER_ID, NATIVE_ID, computeDigest } from "../src/layer";
import { FakeHost } from "./support/fakeHost";
import type { GaugeGeoJSON, GaugeFeature } from "../src/core/types";

function gauge(overrides: Partial<GaugeFeature["properties"]> = {}): GaugeFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-91, 38] },
    properties: {
      gaugelid: "PTTP1",
      status: "action",
      location: "Pittsburgh",
      waterbody: "Allegheny River",
      state: "PA",
      observed: 12.3,
      latitude: 38,
      longitude: -91,
      action: 10,
      flood: 15,
      moderate: 20,
      major: 25,
      units: "ft",
      obstime: "2026-08-19T12:00:00Z",
      wfo: "PBZ",
      ...overrides,
    },
  };
}

function collection(features: GaugeFeature[]): GaugeGeoJSON {
  return { type: "FeatureCollection", features };
}

function stubFetchOnce(data: GaugeGeoJSON): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })),
  );
}

describe("computeDigest (plan D4)", () => {
  it("is stable for identical payloads", () => {
    const data = collection([gauge()]);
    expect(computeDigest(data)).toBe(computeDigest(data));
  });

  it("changes on a status flip with unchanged obstime/count", () => {
    const a = computeDigest(collection([gauge({ status: "action" })]));
    const b = computeDigest(collection([gauge({ status: "minor" })]));
    expect(a).not.toBe(b);
  });

  it("changes on an in-place value correction", () => {
    const a = computeDigest(collection([gauge({ observed: 12.3 })]));
    const b = computeDigest(collection([gauge({ observed: 12.9 })]));
    expect(a).not.toBe(b);
  });

  it("changes on an add-one/remove-one swap even though count is stable", () => {
    const a = computeDigest(collection([gauge({ gaugelid: "A" }), gauge({ gaugelid: "B" })]));
    const b = computeDigest(collection([gauge({ gaugelid: "A" }), gauge({ gaugelid: "C" })]));
    expect(a).not.toBe(b);
  });

  it("fails open (never matches) when any obstime doesn't parse", () => {
    const data = collection([gauge({ obstime: "not-a-date" })]);
    expect(computeDigest(data)).not.toBe(computeDigest(data));
  });
});

describe("GaugeLayerManager", () => {
  let host: FakeHost;

  beforeEach(() => {
    host = new FakeHost();
  });

  afterEach(() => {
    host.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers exactly once on activation with a style payload and originalUrl metadata", async () => {
    stubFetchOnce(collection([gauge()]));
    const manager = new GaugeLayerManager(host.app, vi.fn());
    void manager.start();
    await manager.ready;

    expect(host.layers.size).toBe(3);
    const layer = host.layers.get(LAYER_ID)!;
    expect(layer.nativeLayerIds).toEqual([NATIVE_ID]);
    expect(layer.metadata?.originalUrl).toBeTruthy();
    expect(layer.style).toBeDefined();
    expect(typeof layer.style?.vectorStyleExpression).toBe("string");

    manager.stop();
  });

  it("skips re-registration when the digest is unchanged", async () => {
    const data = collection([gauge()]);
    stubFetchOnce(data);
    const manager = new GaugeLayerManager(host.app, vi.fn());
    void manager.start();
    await manager.ready;

    const registerSpy = vi.fn(host.app.registerExternalNativeLayer);
    host.app.registerExternalNativeLayer = registerSpy;

    stubFetchOnce(data); // identical content
    await manager.refreshNow();
    expect(registerSpy).not.toHaveBeenCalled();

    manager.stop();
  });

  it("re-registers on refresh but omits style (user-edit guard)", async () => {
    stubFetchOnce(collection([gauge({ status: "action" })]));
    const manager = new GaugeLayerManager(host.app, vi.fn());
    void manager.start();
    await manager.ready;

    stubFetchOnce(collection([gauge({ status: "minor" })]));
    await manager.refreshNow();

    const layer = host.layers.get(LAYER_ID)!;
    expect(layer.style).toBeUndefined();

    manager.stop();
  });

  it("a fetch resolving after stop() never re-registers (generation token)", async () => {
    let resolveFetch!: (r: Response) => void;
    // All 3 parallel MapServer page requests share this single pending
    // promise so one resolve() call unblocks every in-flight page.
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => pending));
    const manager = new GaugeLayerManager(host.app, vi.fn());
    const startPromise = manager.start();
    manager.stop();
    resolveFetch(new Response(JSON.stringify(collection([gauge()])), { status: 200 }));
    await startPromise.catch(() => undefined);

    expect(host.layers.size).toBe(0);
  });

  it("deactivate removes all map handlers and window listeners (teardown completeness)", async () => {
    stubFetchOnce(collection([gauge()]));
    const manager = new GaugeLayerManager(host.app, vi.fn());
    void manager.start();
    await manager.ready;

    expect(host.map!.liveHandlerCount).toBeGreaterThan(0);
    expect(host.windowListeners.length).toBeGreaterThan(0);

    manager.stop();

    expect(host.map!.liveHandlerCount).toBe(0);
    expect(host.windowListeners.length).toBe(0);
    expect(host.layers.size).toBe(0);
  });

  it("unbind-then-bind never stacks handlers across resyncs", async () => {
    stubFetchOnce(collection([gauge()]));
    const manager = new GaugeLayerManager(host.app, vi.fn());
    void manager.start();
    await manager.ready;

    const before = host.map!.liveHandlerCount;
    window.dispatchEvent(new Event("geolibre-layer-labels-change"));
    window.dispatchEvent(new Event("geolibre-layer-labels-change"));
    expect(host.map!.liveHandlerCount).toBe(before);

    manager.stop();
  });

  it("click dispatches the gauge properties to the click handler", async () => {
    stubFetchOnce(collection([gauge({ gaugelid: "PTTP1" })]));
    const onClick = vi.fn();
    const manager = new GaugeLayerManager(host.app, onClick);
    void manager.start();
    await manager.ready;

    host.map!.fire("click", NATIVE_ID, { features: [{ properties: { gaugelid: "PTTP1" } }] });
    expect(onClick).toHaveBeenCalledWith({ gaugelid: "PTTP1" });

    manager.stop();
  });

  it("degrades without throwing against a minimal host with all optional members deleted", async () => {
    const minimalHost = new FakeHost({ minimal: true, map: null });
    stubFetchOnce(collection([gauge()]));
    const manager = new GaugeLayerManager(minimalHost.app, vi.fn());
    await expect(manager.start()).resolves.not.toThrow();
    expect(() => manager.stop()).not.toThrow();
    minimalHost.dispose();
  });

  it("a failed first fetch logs, keeps the interval, and registers on the next successful tick", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const manager = new GaugeLayerManager(host.app, vi.fn());
    const startPromise = manager.start();
    // start() resolves ready only after a *successful* fetch is intended,
    // but a failing first fetch must not hang forever or reject.
    await expect(startPromise).resolves.toBeUndefined();
    expect(host.layers.size).toBe(0);
    expect(errSpy).toHaveBeenCalled();

    stubFetchOnce(collection([gauge()]));
    await manager.refreshNow();
    expect(host.layers.size).toBe(3);

    manager.stop();
  });
});
