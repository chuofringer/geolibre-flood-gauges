import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchAllGauges, normalizeStatus } from "../src/data/noaaMapServer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const page = JSON.parse(
  readFileSync(join(__dirname, "fixtures/mapserver-page.json"), "utf8"),
);

function offsetOf(url: string): number {
  return Number(new URL(url).searchParams.get("resultOffset"));
}

describe("normalizeStatus", () => {
  it("lowercases and underscores whitespace", () => {
    expect(normalizeStatus("Action")).toBe("action");
    expect(normalizeStatus("no flooding")).toBe("no_flooding");
    expect(normalizeStatus("OUT OF SERVICE")).toBe("out_of_service");
  });

  it("maps unknown strings to not_defined", () => {
    expect(normalizeStatus("bogus")).toBe("not_defined");
    expect(normalizeStatus("")).toBe("not_defined");
  });
});

describe("fetchAllGauges pagination", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const offset = offsetOf(url);
        if (offset === 0 || offset === 5000 || offset === 10000) {
          return new Response(JSON.stringify(page), { status: 200 });
        }
        return new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), {
          status: 200,
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("assembles 3 parallel pages in offset order", async () => {
    const result = await fetchAllGauges();
    expect(result.type).toBe("FeatureCollection");
    // 2 features per page * 3 pages, no tail (exceededTransferLimit false)
    expect(result.features).toHaveLength(6);
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(3);
    const offsets = calls
      .map((call: unknown[]) => offsetOf(call[0] as string))
      .sort((a: number, b: number) => a - b);
    expect(offsets).toEqual([0, 5000, 10000]);
  });

  it("normalizes status on every returned feature", async () => {
    const result = await fetchAllGauges();
    for (const f of result.features) {
      expect(["major", "moderate", "minor", "action", "no_flooding", "not_defined", "obs_not_current", "out_of_service"]).toContain(
        f.properties.status,
      );
    }
  });

  it("continues sequentially while the LAST parallel page's exceededTransferLimit flag is set (documented upstream quirk)", async () => {
    let tailCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const offset = offsetOf(url);
        if (offset === 10000) {
          return new Response(
            JSON.stringify({ ...page, exceededTransferLimit: true }),
            { status: 200 },
          );
        }
        if (offset === 15000) {
          tailCalls++;
          return new Response(
            JSON.stringify({ ...page, exceededTransferLimit: false }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(page), { status: 200 });
      }),
    );

    const result = await fetchAllGauges();
    expect(tailCalls).toBe(1);
    // 3 parallel pages (2 each) + 1 tail page (2) = 8
    expect(result.features).toHaveLength(8);
  });

  it("does not continue the tail when only a non-last parallel page is truncated (the quirk)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const offset = offsetOf(url);
        // Offset 0 (first parallel page) claims truncation, but offset 10000
        // (the last parallel page, which gates the tail loop) does not.
        if (offset === 0) {
          return new Response(
            JSON.stringify({ ...page, exceededTransferLimit: true }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(page), { status: 200 });
      }),
    );

    const result = await fetchAllGauges();
    // No tail page fetched — only the 3 parallel pages.
    expect(result.features).toHaveLength(6);
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it("throws a plain Error on a non-OK response, including 4xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await expect(fetchAllGauges()).rejects.toThrow(/NOAA MapServer error: 404/);
  });
});
