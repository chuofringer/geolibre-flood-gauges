// Source of truth: flood.live src/api/noaaNwps.ts
// Deviation: `GAUGE_ID_RE` is exported (upstream it's module-private); the
// deep-link handler (src/deepLink.ts) needs it to validate untrusted URL
// input before ever calling fetchGaugeDetail/fetchStageFlow.

import { NOAA_NWPS_BASE_URL } from "../core/constants";
import type { GaugeDetail, StageFlowResponse } from "../core/types";

export const GAUGE_ID_RE = /^[A-Za-z0-9]{1,10}$/;

function validateGaugeId(gaugeId: string): string {
  if (!GAUGE_ID_RE.test(gaugeId)) {
    throw new Error(`Invalid gauge ID: ${gaugeId}`);
  }
  return encodeURIComponent(gaugeId);
}

export async function fetchGaugeDetail(
  gaugeId: string,
  signal?: AbortSignal,
): Promise<GaugeDetail> {
  const safeId = validateGaugeId(gaugeId);
  const res = await fetch(`${NOAA_NWPS_BASE_URL}/${safeId}`, { signal });
  if (!res.ok) throw new Error(`NWPS gauge detail error: ${res.status}`);
  return res.json();
}

export async function fetchStageFlow(
  gaugeId: string,
  signal?: AbortSignal,
): Promise<StageFlowResponse> {
  const safeId = validateGaugeId(gaugeId);
  const res = await fetch(`${NOAA_NWPS_BASE_URL}/${safeId}/stageflow`, { signal });
  if (!res.ok) throw new Error(`NWPS stageflow error: ${res.status}`);
  return res.json();
}
