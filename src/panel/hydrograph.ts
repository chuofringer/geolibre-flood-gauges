import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { FLOOD_COLORS } from "../core/constants";
import { hasPlottableSeries, type BuiltSeries } from "./series";

const HEIGHT = 170;
const OBSERVED_COLOR = "#4a9eff";
const OBSERVED_FILL = "rgba(74, 158, 255, 0.10)";

/** Axis label + tick color. Do not reuse the faint grid stroke — uPlot can
 *  paint labels with ticks.stroke, and 0.18 gray disappears on `.dark`. */
export function axisTheme(isDark: boolean): { label: string; grid: string } {
  return isDark
    ? { label: "#e5e7eb", grid: "rgba(229, 231, 235, 0.25)" }
    : { label: "#374151", grid: "rgba(55, 65, 81, 0.22)" };
}

function hostIsDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

/**
 * Thin uPlot wrapper (plan D5/§3.6): observed solid with a soft area fill,
 * forecast dashed (future-only, bridged), 4 threshold horizontal lines.
 * The built-in legend is off — it burned three lines on "--" placeholders;
 * a single-line hover readout under the chart replaces it. Axis labels use
 * explicit light/dark colors and remount when the host toggles `.dark`
 * (uPlot paints on canvas, so CSS cannot restyle ticks). Trimmed v1 subset
 * of flood.live's StageFlowChart.tsx — no range selector, zoom slider,
 * "Now" markline, or rainfall annotation.
 */
export class Hydrograph {
  private plot: uPlot | null = null;
  private readout: HTMLElement | null = null;
  private units = "";
  private themeObserver: MutationObserver | null = null;
  private last: { container: HTMLElement; series: BuiltSeries; units: string; dark: boolean } | null =
    null;

  mount(container: HTMLElement, series: BuiltSeries, units = ""): void {
    this.teardownPlot();
    this.units = units;
    // Empty/sentinel series must not leave a blank 170px uPlot canvas.
    if (!hasPlottableSeries(series)) {
      this.last = null;
      this.unwatchTheme();
      return;
    }

    const thresholdSeries = (["action", "minor", "moderate", "major"] as const).map((key) => ({
      label: key,
      value: series.thresholds[key],
      color: FLOOD_COLORS[key],
    }));

    const data: uPlot.AlignedData = [
      series.x,
      series.observed,
      series.forecast,
      ...thresholdSeries.map((t) => series.x.map(() => t.value)),
    ];

    const dark = hostIsDark();
    const theme = axisTheme(dark);

    const readout = document.createElement("div");
    readout.className = "fg-chart-readout";
    readout.textContent = "\u00a0";
    this.readout = readout;

    const opts: uPlot.Options = {
      width: container.clientWidth || 320,
      height: HEIGHT,
      scales: { x: { time: true } },
      cursor: { points: { show: true } },
      legend: { show: false },
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx == null) {
              readout.textContent = "\u00a0";
              return;
            }
            const t = u.data[0][idx];
            const observed = u.data[1][idx];
            const forecast = u.data[2][idx];
            const value = observed ?? forecast;
            if (value == null || t == null) {
              readout.textContent = "\u00a0";
              return;
            }
            const kind = observed != null ? "Observed" : "Forecast";
            const when = new Date(t * 1000).toLocaleString(undefined, {
              month: "numeric",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            });
            readout.textContent = `${when} · ${kind}: ${value}${this.units ? ` ${this.units}` : ""}`;
          },
        ],
      },
      series: [
        {},
        {
          label: "Observed",
          stroke: OBSERVED_COLOR,
          fill: OBSERVED_FILL,
          width: 2,
          points: { show: false },
        },
        {
          label: "Forecast",
          stroke: OBSERVED_COLOR,
          width: 2,
          dash: [6, 4],
          points: { show: false },
        },
        ...thresholdSeries.map((t) => ({
          label: t.label,
          stroke: t.color,
          width: 1,
          dash: [2, 2] as [number, number],
          points: { show: false },
        })),
      ],
      axes: [
        {
          stroke: theme.label,
          grid: { stroke: theme.grid, width: 1 },
          ticks: { stroke: theme.label, width: 1 },
          font: "11px system-ui",
        },
        {
          stroke: theme.label,
          grid: { stroke: theme.grid, width: 1 },
          ticks: { stroke: theme.label, width: 1 },
          font: "11px system-ui",
          size: units ? 46 : 36,
          values: (_u: uPlot, vals: number[]) =>
            vals.map((v) => (v == null ? "" : units ? `${v} ${units}` : `${v}`)),
        },
      ],
    };

    this.plot = new uPlot(opts, data, container);
    container.appendChild(readout);
    this.last = { container, series, units, dark };
    this.watchTheme();
  }

  update(series: BuiltSeries): void {
    if (this.last) this.last.series = series;
    if (!this.plot) return;
    const thresholdSeries = (["action", "minor", "moderate", "major"] as const).map(
      (key) => series.thresholds[key],
    );
    const data: uPlot.AlignedData = [
      series.x,
      series.observed,
      series.forecast,
      ...thresholdSeries.map((v) => series.x.map(() => v)),
    ];
    this.plot.setData(data);
  }

  destroy(): void {
    this.unwatchTheme();
    this.teardownPlot();
    this.last = null;
  }

  private teardownPlot(): void {
    this.plot?.destroy();
    this.plot = null;
    this.readout?.remove();
    this.readout = null;
  }

  private watchTheme(): void {
    if (this.themeObserver) return;
    this.themeObserver = new MutationObserver(() => {
      const last = this.last;
      if (!last) return;
      const dark = hostIsDark();
      if (dark === last.dark) return;
      last.dark = dark;
      this.mount(last.container, last.series, last.units);
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  private unwatchTheme(): void {
    this.themeObserver?.disconnect();
    this.themeObserver = null;
  }
}
