// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { handleDeepLink, DEEP_LINK_PARAM } from "../src/deepLink";
import { GaugeLayerManager } from "../src/layer";
import { FakeHost } from "./support/fakeHost";
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

async function readyManager(host: FakeHost, data: GaugeGeoJSON): Promise<GaugeLayerManager> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })),
  );
  const manager = new GaugeLayerManager(host.app, vi.fn());
  void manager.start();
  await manager.ready;
  return manager;
}

describe("handleDeepLink", () => {
  const hosts: FakeHost[] = [];
  function trackedHost(): FakeHost {
    const host = new FakeHost();
    hosts.push(host);
    return host;
  }

  afterEach(() => {
    for (const host of hosts.splice(0)) host.dispose();
  });

  it("fits bounds to a degenerate box and opens the panel for a valid, known gauge", async () => {
    const host = trackedHost();
    const manager = await readyManager(host, collection([gauge("PTTP1")]));
    const params = new URLSearchParams({ [DEEP_LINK_PARAM]: "PTTP1" });
    const onFound = vi.fn();

    await handleDeepLink(host.app, params, manager, onFound);

    expect(host.fitBoundsCalls).toEqual([[-91.5, 38.2, -91.5, 38.2]]);
    expect(onFound).toHaveBeenCalledTimes(1);
    expect(onFound.mock.calls[0][1].properties.gaugelid).toBe("PTTP1");

    manager.stop();
    vi.unstubAllGlobals();
  });

  it("calls onGaugeMissing on an unknown gauge id (no throw, no fly)", async () => {
    const host = trackedHost();
    const manager = await readyManager(host, collection([gauge("PTTP1")]));
    const params = new URLSearchParams({ [DEEP_LINK_PARAM]: "NOPE1" });
    const onFound = vi.fn();
    const onMissing = vi.fn();

    await expect(handleDeepLink(host.app, params, manager, onFound, onMissing)).resolves.toBeUndefined();
    expect(onFound).not.toHaveBeenCalled();
    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(onMissing).toHaveBeenCalledWith(host.app, "NOPE1");
    expect(host.fitBoundsCalls).toHaveLength(0);

    manager.stop();
    vi.unstubAllGlobals();
  });

  it("calls onGaugeMissing for invalid ids without looking them up", async () => {
    const host = trackedHost();
    const manager = await readyManager(host, collection([gauge("PTTP1")]));
    const onFound = vi.fn();
    const onMissing = vi.fn();
    const findSpy = vi.spyOn(manager, "findGauge");

    for (const bad of ["../../etc/passwd", "ABCDEFGHIJK"]) {
      const params = new URLSearchParams({ [DEEP_LINK_PARAM]: bad });
      await handleDeepLink(host.app, params, manager, onFound, onMissing);
    }
    expect(onFound).not.toHaveBeenCalled();
    expect(onMissing).toHaveBeenCalledTimes(2);
    expect(onMissing).toHaveBeenNthCalledWith(1, host.app, "../../etc/passwd");
    expect(onMissing).toHaveBeenNthCalledWith(2, host.app, "ABCDEFGHIJK");
    expect(findSpy).not.toHaveBeenCalled();

    // Empty string is treated as absent: no panel, no lookup.
    onMissing.mockClear();
    const empty = new URLSearchParams();
    empty.set(DEEP_LINK_PARAM, "");
    await handleDeepLink(host.app, empty, manager, onFound, onMissing);
    expect(onMissing).not.toHaveBeenCalled();
    expect(onFound).not.toHaveBeenCalled();
    expect(findSpy).not.toHaveBeenCalled();

    manager.stop();
    vi.unstubAllGlobals();
  });

  it("no-op when the param is absent", async () => {
    const host = trackedHost();
    const manager = await readyManager(host, collection([gauge("PTTP1")]));
    const onFound = vi.fn();
    const onMissing = vi.fn();
    const findSpy = vi.spyOn(manager, "findGauge");
    await handleDeepLink(host.app, new URLSearchParams(), manager, onFound, onMissing);
    expect(onFound).not.toHaveBeenCalled();
    expect(onMissing).not.toHaveBeenCalled();
    expect(findSpy).not.toHaveBeenCalled();
    manager.stop();
    vi.unstubAllGlobals();
  });

  it("resolves after the initial fetch when called while it's still in flight", async () => {
    const host = trackedHost();
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
    const manager = new GaugeLayerManager(host.app, vi.fn());
    void manager.start(); // fetch is in flight, manager.ready not yet resolved

    const onFound = vi.fn();
    const params = new URLSearchParams({ [DEEP_LINK_PARAM]: "PTTP1" });
    const deepLinkPromise = handleDeepLink(host.app, params, manager, onFound);

    releaseGate();
    await deepLinkPromise;

    expect(onFound).toHaveBeenCalledTimes(1);
    manager.stop();
    vi.unstubAllGlobals();
  });
});
