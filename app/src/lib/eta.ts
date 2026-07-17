/**
 * Client-computed ETA (R3) and ETA formatting. Pure module — unit tested.
 *
 * The ETA estimate divides remaining distance by the recent rate of progress
 * toward the target, derived from a short window of position samples. The
 * rate is a transient local intermediate only: it is never stored, logged,
 * or sent anywhere (hard constraint — no speed). Only `etaSeconds` leaves
 * this module.
 */
import type { LatLng, Position } from "../api/types";
import { haversineMeters } from "./geo";

/** How far back the sample window reaches when estimating progress. */
const WINDOW_MS = 90_000;
/** Below this rate of progress (m/s) we consider the ETA unknowable. */
const MIN_PROGRESS_RATE = 1;
/** Cap so a glitchy sample can't produce absurd ETAs. */
const MAX_ETA_SECONDS = 24 * 3600;

/**
 * Estimate seconds until arrival at `target` from recent position samples
 * (oldest → newest). Returns null when there is not enough movement data
 * to estimate honestly (fewer than 2 samples, tiny time window, or no
 * meaningful progress toward the target).
 */
export function estimateEtaSeconds(
  samples: Position[],
  target: LatLng,
): number | null {
  if (samples.length < 2) return null;
  const newest = samples[samples.length - 1];
  // Find the oldest sample inside the window.
  let oldest = samples[0];
  for (const s of samples) {
    if (newest.ts - s.ts <= WINDOW_MS) {
      oldest = s;
      break;
    }
  }
  const dtSec = (newest.ts - oldest.ts) / 1000;
  if (dtSec < 5) return null;

  const remaining = haversineMeters(newest, target);
  if (remaining < 30) return 0; // effectively there

  const progressMeters =
    haversineMeters(oldest, target) - remaining; // closing distance
  const progressRate = progressMeters / dtSec;
  if (progressRate < MIN_PROGRESS_RATE) return null; // stationary or diverging

  const eta = remaining / progressRate;
  if (!Number.isFinite(eta)) return null;
  return Math.min(Math.round(eta), MAX_ETA_SECONDS);
}

/** "—" | "now" | "4 min" | "1 h 05 min". */
export function formatEta(etaSeconds: number | null | undefined): string {
  if (etaSeconds === null || etaSeconds === undefined || etaSeconds < 0) {
    return "—";
  }
  if (etaSeconds < 45) return "now";
  const totalMin = Math.round(etaSeconds / 60);
  if (totalMin < 60) return `${Math.max(1, totalMin)} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")} min`;
}
