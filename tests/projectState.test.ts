import { describe, it, expect } from "vitest";
import { parseProjectState, buildProjectState } from "../src/projectState";

describe("parseProjectState", () => {
  it("accepts a valid v1 payload", () => {
    const state = parseProjectState({ v: 1, selectedGauge: "PTTP1", refreshMinutes: 15 });
    expect(state).toEqual({ v: 1, selectedGauge: "PTTP1", refreshMinutes: 15 });
  });

  it("accepts a v1 payload with only some fields present", () => {
    expect(parseProjectState({ v: 1 })).toEqual({ v: 1 });
    expect(parseProjectState({ v: 1, selectedGauge: "PTTP1" })).toEqual({ v: 1, selectedGauge: "PTTP1" });
  });

  it("rejects an unknown version (a newer plugin's payload)", () => {
    expect(parseProjectState({ v: 2, selectedGauge: "PTTP1" })).toBeNull();
  });

  it("returns null for null/undefined/non-object payloads without throwing", () => {
    expect(parseProjectState(null)).toBeNull();
    expect(parseProjectState(undefined)).toBeNull();
    expect(parseProjectState("garbage")).toBeNull();
    expect(parseProjectState(42)).toBeNull();
    expect(parseProjectState([1, 2, 3])).toBeNull();
  });

  it("drops an invalid selectedGauge (untrusted field) but keeps the rest", () => {
    const state = parseProjectState({ v: 1, selectedGauge: "../../etc/passwd", refreshMinutes: 10 });
    expect(state).toEqual({ v: 1, refreshMinutes: 10 });
  });

  it("drops a non-positive or non-numeric refreshMinutes", () => {
    expect(parseProjectState({ v: 1, refreshMinutes: -5 })).toEqual({ v: 1 });
    expect(parseProjectState({ v: 1, refreshMinutes: "30" })).toEqual({ v: 1 });
    expect(parseProjectState({ v: 1, refreshMinutes: NaN })).toEqual({ v: 1 });
  });

  it("ignores unknown extra fields", () => {
    const state = parseProjectState({ v: 1, selectedGauge: "PTTP1", extra: "field" });
    expect(state).toEqual({ v: 1, selectedGauge: "PTTP1" });
  });
});

describe("buildProjectState / getProjectState size budget", () => {
  it("stays well under 1 KB", () => {
    const state = buildProjectState("PTTP1", 30);
    const bytes = new TextEncoder().encode(JSON.stringify(state)).length;
    expect(bytes).toBeLessThan(1024);
  });

  it("omits empty fields", () => {
    expect(buildProjectState(null, null)).toEqual({ v: 1 });
  });
});
