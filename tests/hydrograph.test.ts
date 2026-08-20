// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Hydrograph, axisTheme } from "../src/panel/hydrograph";
import { buildSeries, hasPlottableSeries } from "../src/panel/series";
import type { BuiltSeries, SeriesThresholds } from "../src/panel/series";
import type { StageFlowResponse } from "../src/core/types";

const NOW = Date.parse("2026-08-19T12:00:00Z");
const THRESHOLDS: SeriesThresholds = { action: 10, minor: 15, moderate: 20, major: 25 };

function emptySeries(): BuiltSeries {
  const stageflow: StageFlowResponse = {
    observed: {
      primaryUnits: "ft",
      data: [
        { validTime: "2026-08-19T11:00:00Z", primary: -999, secondary: null },
        { validTime: "2026-08-19T11:30:00Z", primary: -9999, secondary: null },
      ],
    },
    forecast: { primaryUnits: "ft", data: [] },
  };
  return buildSeries(stageflow, THRESHOLDS, NOW);
}

describe("Hydrograph.mount", () => {
  it("does not mount uPlot (no canvas / no blank hole) when the series is empty/sentinel", () => {
    const series = emptySeries();
    expect(hasPlottableSeries(series)).toBe(false);

    const container = document.createElement("div");
    container.className = "fg-hydrograph";
    const hydro = new Hydrograph();
    hydro.mount(container, series, "ft");

    expect(container.childElementCount).toBe(0);
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector(".u-wrap")).toBeNull();
    expect(container.querySelector(".fg-chart-readout")).toBeNull();
    expect(container.innerHTML).toBe("");

    hydro.destroy();
  });
});

describe("axisTheme", () => {
  it("uses high-contrast labels, not the faint grid gray, in both themes", () => {
    const light = axisTheme(false);
    const dark = axisTheme(true);
    expect(light.label).toBe("#374151");
    expect(dark.label).toBe("#e5e7eb");
    expect(light.label).not.toEqual(light.grid);
    expect(dark.label).not.toEqual(dark.grid);
    expect(dark.grid.includes("0.18")).toBe(false);
  });
});
