/**
 * Staleness rules (R4/R6). Client-derived per docs/CONTRACT.md:
 * a member is stale when now - lastPosition.ts > 60_000.
 */
import { STALENESS_THRESHOLD_MS } from "../config";

export function isStale(
  lastTs: number,
  now: number,
  thresholdMs: number = STALENESS_THRESHOLD_MS,
): boolean {
  return now - lastTs > thresholdMs;
}

/** Compact age label for a timestamp: "12s", "3m", "2h", "5d". */
export function formatAge(ts: number, now: number): string {
  const ms = Math.max(0, now - ts);
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
