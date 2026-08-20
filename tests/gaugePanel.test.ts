// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { FakeHost } from "./support/fakeHost";
import type { GaugeProperties } from "../src/core/types";

// jsdom has no canvas backend (no `canvas` package installed), so a real
// uPlot instance throws deep inside its rAF-driven _commit. The chart's own
// mount/data logic isn't unit-tested here — that's covered by the browser
// based T4 Playwright suite — so this suite stubs Hydrograph to a no-op.
const { hydrographMount } = vi.hoisted(() => ({ hydrographMount: vi.fn() }));
vi.mock("../src/panel/hydrograph", () => ({
  Hydrograph: class {
    mount(...args: unknown[]) {
      hydrographMount(...args);
    }
    update() {}
    destroy() {}
  },
}));

const { registerPanel, openGaugePanel, PANEL_ID } = await import("../src/panel/gaugePanel");

const gauge: GaugeProperties = {
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
};

const detail = {
  lid: "PTTP1",
  name: "Pittsburgh",
  state: { abbreviation: "PA", name: "Pennsylvania" },
  county: "Allegheny",
  latitude: 38,
  longitude: -91,
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

const stageflow = {
  observed: {
    primaryUnits: "ft",
    data: [
      { validTime: "2026-08-19T11:00:00Z", primary: 12.0, secondary: null },
      { validTime: "2026-08-19T11:55:00Z", primary: 12.3, secondary: null },
    ],
  },
  forecast: { primaryUnits: "ft", data: [{ validTime: "2026-08-19T13:00:00Z", primary: 12.8, secondary: null }] },
};


const alekGauge: GaugeProperties = {
  gaugelid: "ALEK1",
  status: "obs_not_current",
  location: "Abilene",
  waterbody: "Mud Creek",
  state: "KS",
  observed: -999,
  latitude: 38.92,
  longitude: -97.21,
  action: 11,
  flood: 13,
  moderate: 17,
  major: 21,
  units: "ft",
  obstime: "2026-08-19T12:00:00Z",
  wfo: "ICT",
};

const alekDetail = {
  lid: "ALEK1",
  name: "Abilene",
  state: { abbreviation: "KS", name: "Kansas" },
  county: "Dickinson",
  latitude: 38.92,
  longitude: -97.21,
  flood: {
    stageUnits: "ft",
    categories: {
      major: { stage: 21, flow: null },
      moderate: { stage: 17, flow: null },
      minor: { stage: 13, flow: null },
      action: { stage: 11, flow: null },
    },
  },
  status: { observed: { primary: -999, primaryUnit: "ft", floodCategory: "obs_not_current" } },
};

const alekStageflowSentinel = {
  observed: {
    primaryUnits: "ft",
    data: [{ validTime: "2026-08-19T11:00:00Z", primary: -999, secondary: null }],
  },
  forecast: { primaryUnits: "ft", data: [] },
};

async function flushPanel(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("gaugePanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    hydrographMount.mockClear();
  });

  it("registerPanel renders an empty-state placeholder", () => {
    const host = new FakeHost();
    registerPanel(host.app);
    const panel = host.panels.get(PANEL_ID)!;
    expect(panel).toBeDefined();
    const container = document.createElement("div");
    panel.render(container);
    expect(container.textContent).toMatch(/Select a gauge/);
    expect(container.querySelector(".fg-source")?.textContent).toContain("NOAA/NWPS");
    expect(container.querySelector(".fg-source")?.textContent).toContain("river and coastal");
    expect(container.querySelector(".fg-disclaimer")?.textContent).toMatch(/informational purposes/);
    expect(container.querySelector(".fg-disclaimer")?.textContent).toMatch(/life-safety/);
  });

  it("openGaugePanel re-registers with a gauge-bound render fn and opens it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("stageflow")) return new Response(JSON.stringify(stageflow), { status: 200 });
        return new Response(JSON.stringify(detail), { status: 200 });
      }),
    );
    const host = new FakeHost();
    registerPanel(host.app);
    openGaugePanel(host.app, gauge);
    expect(host.openPanels.has(PANEL_ID)).toBe(true);

    const panel = host.panels.get(PANEL_ID)!;
    const container = document.createElement("div");
    const cleanup = panel.render(container);
    expect(container.querySelector(".fg-lid")?.textContent).toBe("PTTP1");

    // Let the async NWPS fetch resolve and fill in the detail.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelector(".fg-staleness")?.textContent).not.toMatch(/Loading/);
    expect(container.querySelector(".fg-staleness")?.textContent).toContain("Data: NOAA/NWPS");
    expect(container.querySelector(".fg-source")?.textContent).toContain("NOAA/NWPS");
    expect(container.querySelector(".fg-source")?.textContent).toContain("river and coastal");
    expect(container.querySelector(".fg-disclaimer")?.textContent).toMatch(/informational purposes/);
    expect(container.querySelector(".fg-disclaimer")?.textContent).toMatch(/life-safety/);
    expect(container.querySelector(".fg-link")?.getAttribute("href")).toBe(
      "https://flood.live?gauge=PTTP1&ref=geolibre",
    );

    // Cleanup must not throw (host wipes the container and calls this on close).
    expect(() => (cleanup as () => void)?.()).not.toThrow();
  });

  it("close -> reopen produces a fully rendered panel from a fresh container", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("stageflow")) return new Response(JSON.stringify(stageflow), { status: 200 });
        return new Response(JSON.stringify(detail), { status: 200 });
      }),
    );
    const host = new FakeHost();
    registerPanel(host.app);
    openGaugePanel(host.app, gauge);
    const panel1 = host.panels.get(PANEL_ID)!;
    const container1 = document.createElement("div");
    const cleanup1 = panel1.render(container1);
    (cleanup1 as () => void)?.(); // simulate close: host wipes container, calls cleanup

    // Reopen: host re-invokes render on a fresh container.
    openGaugePanel(host.app, gauge);
    const panel2 = host.panels.get(PANEL_ID)!;
    const container2 = document.createElement("div");
    panel2.render(container2);
    expect(container2.querySelector(".fg-lid")?.textContent).toBe("PTTP1");
  });

  it("openExternalUrl is used when available (no window.open fallback)", () => {
    const host = new FakeHost();
    registerPanel(host.app);
    openGaugePanel(host.app, gauge);
    const panel = host.panels.get(PANEL_ID)!;
    const container = document.createElement("div");
    panel.render(container);
    const link = container.querySelector<HTMLAnchorElement>(".fg-link")!;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(host.openedUrls[0]).toContain("gauge=PTTP1");
    expect(host.openedUrls[0]).toContain("ref=geolibre");
  });

  it("NWPS -999 primary fallback: Observed is an em dash, no stage-bar marker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("stageflow")) return new Response(JSON.stringify(alekStageflowSentinel), { status: 200 });
        return new Response(JSON.stringify(alekDetail), { status: 200 });
      }),
    );
    const host = new FakeHost();
    registerPanel(host.app);
    openGaugePanel(host.app, alekGauge);
    const panel = host.panels.get(PANEL_ID)!;
    const container = document.createElement("div");
    panel.render(container);
    await flushPanel();

    const observed = container.querySelector(".fg-observed-row")?.textContent ?? "";
    expect(observed).toMatch(/Observed:\s*[–—-]/);
    expect(observed).not.toContain("-999");
    expect(container.textContent).not.toContain("-999");
    expect(container.querySelector(".fg-observed-value")).toBeNull();

    // Thresholds-only bar is OK; a marker at a fake left-edge position is not.
    expect(container.querySelector(".fg-stagebar-track")).not.toBeNull();
    expect(container.querySelector(".fg-stagebar-marker")).toBeNull();

    expect(container.querySelector(".fg-staleness")?.textContent).toContain(
      "No recent observation available. · Data: NOAA/NWPS",
    );

    expect(hydrographMount).toHaveBeenCalled();
    const series = hydrographMount.mock.calls[0][1] as { x: unknown[] };
    expect(series.x).toHaveLength(0);
  });

  it("valid NWPS primary still fills Observed when stageflow has no valid point", async () => {
    const validFallbackDetail = {
      ...alekDetail,
      lid: "VALK1",
      status: { observed: { primary: 12.3, primaryUnit: "ft", floodCategory: "action" } },
    };
    const emptyStageflow = {
      observed: { primaryUnits: "ft", data: [] },
      forecast: { primaryUnits: "ft", data: [] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("stageflow")) return new Response(JSON.stringify(emptyStageflow), { status: 200 });
        return new Response(JSON.stringify(validFallbackDetail), { status: 200 });
      }),
    );
    const host = new FakeHost();
    registerPanel(host.app);
    openGaugePanel(host.app, { ...alekGauge, gaugelid: "VALK1" });
    const panel = host.panels.get(PANEL_ID)!;
    const container = document.createElement("div");
    panel.render(container);
    await flushPanel();

    expect(container.querySelector(".fg-observed-value")?.textContent).toMatch(/12\.3/);
    expect(container.querySelector(".fg-stagebar-marker")).not.toBeNull();
  });
});
