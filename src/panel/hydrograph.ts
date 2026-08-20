import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { FLOOD_COLORS } from "../core/constants";
import type { BuiltSeries } from "./series";

const HEIGHT = 170;
const OBSERVED_COLOR = "#4a9eff";
const OBSERVED_FILL = "rgba(74, 158, 255, 0.10)";
const GRID_COLOR = "rgba(128, 128, 128, 0.18)";

/**
 * Thin uPlot wrapper (plan D5/§3.6): observed solid with a soft area fill,
 * forecast dashed (future-only, bridged), 4 threshold horizontal lines.
 * The built-in legend is off — it burned three lines on "--" placeholders;
 * a single-line hover readout under the chart replaces it. Axis/grid colors
 * are resolved from the panel's computed foreground at mount so the chart
 * stays legible in both host themes. Trimmed v1 subset of flood.live's
 * StageFlowChart.tsx — no range selector, zoom slider, "Now" markline, or
 * rainfall annotation.
 */
export class Hydrograph {
  private plot: uPlot | null = null;
  private readout: HTMLElement | null = null;
  private units = "";

  mount(container: HTMLElement, series: BuiltSeries, units = ""): void {
    this.destroy();
    this.units = units;

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

    // Resolved theme foreground (the .fg-panel color), so axes track the host theme.
    const fg = getComputedStyle(container).color || "#888";

    const readout = document.createElement("div");
    readout.className = "fg-chart-readout";
    readout.textContent = " "; // reserve the line so hover doesn't shift layout
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
              readout.textContent = " ";
              return;
            }
            const t = u.data[0][idx];
            const observed = u.data[1][idx];
            const forecast = u.data[2][idx];
            const value = observed ?? forecast;
            if (value == null || t == null) {
              readout.textContent = " ";
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
          stroke: fg,
          grid: { stroke: GRID_COLOR, width: 1 },
          ticks: { stroke: GRID_COLOR, width: 1 },
          font: "10px system-ui",
        },
        {
          stroke: fg,
          grid: { stroke: GRID_COLOR, width: 1 },
          ticks: { stroke: GRID_COLOR, width: 1 },
          font: "10px system-ui",
          // Tick labels carry the stage unit ("2 ft"), so the axis needs no
          // separate rotated label; widen to fit the suffix.
          size: units ? 46 : 36,
          values: (_u: uPlot, vals: number[]) =>
            vals.map((v) => (v == null ? "" : units ? `${v} ${units}` : `${v}`)),
        },
      ],
    };

    this.plot = new uPlot(opts, data, container);
    container.appendChild(readout);
  }

  update(series: BuiltSeries): void {
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
    this.plot?.destroy();
    this.plot = null;
    this.readout?.remove();
    this.readout = null;
  }
}
