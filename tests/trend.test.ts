import { describe, it, expect } from "vitest";
import { computeTrend } from "../src/core/trend";
import type { StageFlowPoint } from "../src/core/types";

function pts(values: (number | null)[]): StageFlowPoint[] {
  return values.map((v, i) => ({ validTime: `t${i}`, primary: v, secondary: null }));
}

describe("computeTrend", () => {
  it("rising: second half average exceeds first half by > 0.1", () => {
    expect(computeTrend(pts([1, 1, 1, 2, 2, 2]))).toBe("rising");
  });

  it("falling: second half average below first half by > 0.1", () => {
    expect(computeTrend(pts([2, 2, 2, 1, 1, 1]))).toBe("falling");
  });

  it("stable: diff within +/-0.1 threshold", () => {
    expect(computeTrend(pts([1, 1, 1.05, 1.05]))).toBe("stable");
  });

  it("respects a custom threshold argument", () => {
    // diff = 0.2, which is stable at the default 0.1 threshold's neighbor (0.3)
    // but rising once the threshold is lowered below 0.2.
    expect(computeTrend(pts([1, 1, 1.2, 1.2]), 0.3)).toBe("stable");
    expect(computeTrend(pts([1, 1, 1.2, 1.2]), 0.1)).toBe("rising");
  });

  it("fewer than 2 points returns stable", () => {
    expect(computeTrend([])).toBe("stable");
    expect(computeTrend(pts([1]))).toBe("stable");
  });

  it("fewer than 2 valid points after sentinel filtering returns stable", () => {
    expect(computeTrend(pts([-999, -9999, 5]))).toBe("stable");
  });

  it("filters sentinel values (<= -999) before computing", () => {
    // Valid subsequence [1, 1, 3, 3] rising; sentinels interspersed should be dropped.
    expect(computeTrend(pts([1, -999, 1, -9999, 3, 3]))).toBe("rising");
  });

  it("only considers the last 12 points", () => {
    const values = [10, 10, 10, 10, 10, 10, 10, 10, 1, 1, 1, 1, 1, 1];
    // last 12: [10,10,10,10,10,10,1,1,1,1,1,1] -> falling
    expect(computeTrend(pts(values))).toBe("falling");
  });
});
