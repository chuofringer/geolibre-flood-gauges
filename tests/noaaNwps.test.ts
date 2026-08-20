import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchGaugeDetail, fetchStageFlow } from "../src/data/noaaNwps";

const __dirname = dirname(fileURLToPath(import.meta.url));
const detail = readFileSync(join(__dirname, "fixtures/nwps-gauge-detail.json"), "utf8");
const stageflow = readFileSync(join(__dirname, "fixtures/nwps-stageflow.json"), "utf8");

describe("noaaNwps", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchGaugeDetail happy path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(detail, { status: 200 })),
    );
    const result = await fetchGaugeDetail("PTTP1");
    expect(result.lid).toBe("PTTP1");
    expect(result.flood.categories.major.stage).toBe(25);
  });

  it("fetchStageFlow happy path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stageflow, { status: 200 })),
    );
    const result = await fetchStageFlow("PTTP1");
    expect(result.observed.data).toHaveLength(3);
    expect(result.forecast.data).toHaveLength(2);
  });

  it("404 gauge throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    await expect(fetchGaugeDetail("NOPE1")).rejects.toThrow(/NWPS gauge detail error: 404/);
  });

  it("rejects invalid gauge ids before ever calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchGaugeDetail("../../etc/passwd")).rejects.toThrow(/Invalid gauge ID/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("propagates an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { signal?: AbortSignal }) => {
        if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        return new Response(stageflow, { status: 200 });
      }),
    );
    await expect(fetchStageFlow("PTTP1", controller.signal)).rejects.toThrow(/Aborted/);
  });
});
