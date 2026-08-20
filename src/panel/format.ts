// Staleness/time formatting for the gauge panel (plan §3.6 item 3). The
// amber >= 2h tier is the flood.live port (GaugePanelHeader.tsx:34); the
// inline absolute timestamp and the red >= 24h tier are new plugin
// behavior, not flood.live parity (issue #117 sets the principle, not the
// thresholds).

export type StalenessTier = "normal" | "amber" | "red";

const AMBER_MS = 2 * 60 * 60_000;
const RED_MS = 24 * 60 * 60_000;

export function stalenessTier(obsMs: number, now: number): StalenessTier {
  const age = now - obsMs;
  if (age >= RED_MS) return "red";
  if (age >= AMBER_MS) return "amber";
  return "normal";
}

export function formatRelativeTime(obsMs: number, now: number): string {
  const diffMs = now - obsMs;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatAbsoluteTime(obsMs: number): string {
  return new Date(obsMs).toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export interface StalenessInfo {
  tier: StalenessTier;
  absolute: string;
  relative: string;
  label: string; // "2:15 PM EDT · 43 min ago"
}

export function formatStaleness(obstime: string, now: number = Date.now()): StalenessInfo | null {
  const obsMs = Date.parse(obstime);
  if (Number.isNaN(obsMs)) return null;
  const absolute = formatAbsoluteTime(obsMs);
  const relative = formatRelativeTime(obsMs, now);
  return {
    tier: stalenessTier(obsMs, now),
    absolute,
    relative,
    label: `${absolute} · ${relative}`,
  };
}
