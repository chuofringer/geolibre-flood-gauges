// Source of truth: flood.live src/config/statusColors.ts
// Deviation: the color map comes from the ported FLOOD_COLORS in ./constants
// (upstream STATUS_COLORS is module-private and duplicates it).

import { FLOOD_COLORS } from "./constants";

export function statusColor(status: string): string {
  return FLOOD_COLORS[status] ?? "#6b7280";
}
