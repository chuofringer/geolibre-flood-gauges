import { describe, it, expect } from "vitest";
import { GAUGE_ID_RE } from "../src/data/noaaNwps";

describe("GAUGE_ID_RE (deep-link input validation)", () => {
  it("accepts plain alphanumeric ids up to 10 chars", () => {
    expect(GAUGE_ID_RE.test("PTTP1")).toBe(true);
    expect(GAUGE_ID_RE.test("A")).toBe(true);
    expect(GAUGE_ID_RE.test("ABCDEFGHIJ")).toBe(true); // exactly 10
  });

  it("rejects empty strings", () => {
    expect(GAUGE_ID_RE.test("")).toBe(false);
  });

  it("rejects ids longer than 10 characters", () => {
    expect(GAUGE_ID_RE.test("ABCDEFGHIJK")).toBe(false); // 11 chars
  });

  it("rejects path traversal / non-alphanumeric input", () => {
    expect(GAUGE_ID_RE.test("../../etc/passwd")).toBe(false);
    expect(GAUGE_ID_RE.test("PTTP1;DROP")).toBe(false);
    expect(GAUGE_ID_RE.test("PT TP1")).toBe(false);
    expect(GAUGE_ID_RE.test("<script>")).toBe(false);
  });
});
