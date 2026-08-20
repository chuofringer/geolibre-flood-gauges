import { describe, it, expect } from "vitest";
import { statusColor } from "../src/core/statusColors";
import { FLOOD_COLORS } from "../src/core/constants";

describe("statusColor", () => {
  it("returns the FLOOD_COLORS entry for known statuses", () => {
    for (const [status, color] of Object.entries(FLOOD_COLORS)) {
      expect(statusColor(status)).toBe(color);
    }
  });

  it("falls back to a neutral gray for unknown statuses", () => {
    expect(statusColor("bogus")).toBe("#6b7280");
  });
});
