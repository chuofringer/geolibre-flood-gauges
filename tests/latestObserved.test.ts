import { describe, it, expect } from "vitest";
import { getLatestObserved } from "../src/core/latestObserved";
import type { StageFlowResponse } from "../src/core/types";

function response(values: (number | null)[]): StageFlowResponse {
  return {
    observed: {
      primaryUnits: "ft",
      data: values.map((v, i) => ({ validTime: `t${i}`, primary: v, secondary: null })),
    },
    forecast: { primaryUnits: "ft", data: [] },
  };
}

describe("getLatestObserved", () => {
  it("returns the last valid value", () => {
    expect(getLatestObserved(response([1, 2, 3]))).toBe(3);
  });

  it("walks backwards over trailing nulls", () => {
    expect(getLatestObserved(response([1, 2, 3, null, null]))).toBe(3);
  });

  it("walks backwards over trailing sentinels", () => {
    expect(getLatestObserved(response([1, 2, 3, -999, -9999]))).toBe(3);
  });

  it("returns null for empty series", () => {
    expect(getLatestObserved(response([]))).toBeNull();
  });

  it("returns null when all values are sentinel/null", () => {
    expect(getLatestObserved(response([null, -999, -9999]))).toBeNull();
  });

  it("returns null for undefined stageflow data", () => {
    expect(getLatestObserved(undefined)).toBeNull();
  });
});
