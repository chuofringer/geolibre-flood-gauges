import { describe, it, expect } from "vitest";
import { getLatestObserved, getLatestObservedTime, isValidPrimary } from "../src/core/latestObserved";
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

describe("isValidPrimary", () => {
  it("accepts a real stage, including legitimate negatives above the sentinel", () => {
    expect(isValidPrimary(12.3)).toBe(true);
    expect(isValidPrimary(0)).toBe(true);
    expect(isValidPrimary(-2)).toBe(true);
  });

  it("rejects NOAA sentinels and nullish", () => {
    expect(isValidPrimary(-999)).toBe(false);
    expect(isValidPrimary(-9999)).toBe(false);
    expect(isValidPrimary(null)).toBe(false);
    expect(isValidPrimary(undefined)).toBe(false);
  });
});

describe("getLatestObservedTime", () => {
  it("returns the validTime of the last valid reading, skipping trailing sentinels", () => {
    const sf = response([1, 2, -999]);
    // response() stamps validTime as t0, t1, t2
    expect(getLatestObservedTime(sf)).toBe("t1");
  });

  it("returns null when every point is sentinel/null", () => {
    expect(getLatestObservedTime(response([null, -999, -9999]))).toBeNull();
  });
});
