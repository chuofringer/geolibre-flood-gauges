// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { FakeHost } from "./support/fakeHost";
import type { GaugeProperties } from "../src/core/types";

// jsdom has no canvas backend (no `canvas` package installed), so a real
// uPlot instance throws deep inside its rAF-driven _commit. The chart's own
// mount/data logic isn't unit-tested here — that's covered by the browser
// based T4 Playwright suite — so this suite stubs Hydrograph to a no-op.
vi.mock("../src/panel/hydrograph", () => ({
  Hydrograph: class {
    mount() {}
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

describe("gaugePanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registerPanel renders an empty-state placeholder", () => {
    const host = new FakeHost();
    registerPanel(host.app);
    const panel = host.panels.get(PANEL_ID)!;
    expect(panel).toBeDefined();
    const container = document.createElement("div");
    panel.render(container);
    expect(container.textContent).toMatch(/Select a gauge/);
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
});
