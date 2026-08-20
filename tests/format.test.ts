import { describe, it, expect } from "vitest";
import { formatStaleness, formatRelativeTime, stalenessTier } from "../src/panel/format";

const NOW = Date.parse("2026-08-19T12:00:00Z");

describe("stalenessTier", () => {
  it("normal below 2h", () => {
    expect(stalenessTier(NOW - 60 * 60_000, NOW)).toBe("normal");
  });

  it("amber tier ported from flood.live: >= 2h and < 24h", () => {
    expect(stalenessTier(NOW - 2 * 60 * 60_000, NOW)).toBe("amber");
    expect(stalenessTier(NOW - 23 * 60 * 60_000, NOW)).toBe("amber");
  });

  it("new red tier: >= 24h", () => {
    expect(stalenessTier(NOW - 24 * 60 * 60_000, NOW)).toBe("red");
    expect(stalenessTier(NOW - 48 * 60 * 60_000, NOW)).toBe("red");
  });
});

describe("formatRelativeTime buckets", () => {
  it("just now under a minute", () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("just now");
  });

  it("minutes bucket", () => {
    expect(formatRelativeTime(NOW - 43 * 60_000, NOW)).toBe("43 min ago");
  });

  it("hours bucket", () => {
    expect(formatRelativeTime(NOW - 5 * 60 * 60_000, NOW)).toBe("5h ago");
  });

  it("days bucket", () => {
    expect(formatRelativeTime(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe("3d ago");
  });
});

describe("formatStaleness", () => {
  it("returns null for an unparseable obstime", () => {
    expect(formatStaleness("not-a-date", NOW)).toBeNull();
  });

  it("combines absolute and relative time into a label", () => {
    const info = formatStaleness(new Date(NOW - 43 * 60_000).toISOString(), NOW);
    expect(info).not.toBeNull();
    expect(info!.label).toContain("43 min ago");
    expect(info!.tier).toBe("normal");
  });
});
