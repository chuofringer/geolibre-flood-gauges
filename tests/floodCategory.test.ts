import { describe, it, expect } from "vitest";
import { computeFloodCategory } from "../src/core/floodCategory";

describe("computeFloodCategory", () => {
  it("boundary equality: observed === major returns major", () => {
    expect(computeFloodCategory(10, 5, 6, 8, 10)).toBe("major");
  });

  it("boundary equality: observed === moderate returns moderate", () => {
    expect(computeFloodCategory(8, 5, 6, 8, 10)).toBe("moderate");
  });

  it("boundary equality: observed === minor (flood) returns minor", () => {
    expect(computeFloodCategory(6, 5, 6, 8, 10)).toBe("minor");
  });

  it("boundary equality: observed === action returns action", () => {
    expect(computeFloodCategory(5, 5, 6, 8, 10)).toBe("action");
  });

  it("below all thresholds returns no_flooding", () => {
    expect(computeFloodCategory(1, 5, 6, 8, 10)).toBe("no_flooding");
  });

  it("rejects sentinel observed values (-999, -9999, -10000)", () => {
    expect(computeFloodCategory(-999, 5, 6, 8, 10)).toBeNull();
    expect(computeFloodCategory(-9999, 5, 6, 8, 10)).toBeNull();
    expect(computeFloodCategory(-10000, 5, 6, 8, 10)).toBeNull();
  });

  it("null/undefined observed returns null", () => {
    expect(computeFloodCategory(null, 5, 6, 8, 10)).toBeNull();
    expect(computeFloodCategory(undefined, 5, 6, 8, 10)).toBeNull();
  });

  it("rejects sentinel thresholds while keeping legitimate negative observed", () => {
    // observed is a legitimate negative stage (below datum); thresholds are sentinels.
    expect(computeFloodCategory(-2, -9999, -9999, -9999, -9999)).toBeNull();
  });

  it("all thresholds null/undefined returns null", () => {
    expect(computeFloodCategory(5, null, null, null, null)).toBeNull();
    expect(computeFloodCategory(5, undefined, undefined, undefined, undefined)).toBeNull();
  });

  it("partial thresholds: only flood(minor) defined", () => {
    expect(computeFloodCategory(10, null, 6, null, null)).toBe("minor");
    expect(computeFloodCategory(3, null, 6, null, null)).toBe("no_flooding");
  });

  it("legitimate negative observed below a legitimate negative-ish datum threshold set", () => {
    expect(computeFloodCategory(-1, -0.5, 0, 2, 4)).toBe("no_flooding");
  });
});
