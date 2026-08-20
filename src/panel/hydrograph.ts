import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { FLOOD_COLORS } from "../core/constants";
import type { BuiltSeries } from "./series";

const HEIGHT = 180;
const OBSERVED_COLOR = "#4a9eff";

/**
 * Thin uPlot wrapper (plan D5/§3.6): observed solid, forecast dashed
 * (future-only, bridged), 4 threshold horizontal lines, hover cursor with
 * a legend. Trimmed v1 subset of flood.live's StageFlowChart.tsx — no
 * range selector, zoom slider, "Now" markline, or rainfall annotation.
 */
export class Hydrograph {
  private plot: uPlot | null = null;

  mount(container: HTMLElement, series: BuiltSeries): void {
    this.destroy();

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

    const opts: uPlot.Options = {
      width: container.clientWidth || 320,
      height: HEIGHT,
      scales: { x: { time: true } },
      cursor: { points: { show: true } },
      legend: { show: true },
      series: [
        {},
        { label: "Observed", stroke: OBSERVED_COLOR, width: 2, points: { show: false } },
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
      axes: [{}, {}],
    };

    this.plot = new uPlot(opts, data, container);
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
  }
}
