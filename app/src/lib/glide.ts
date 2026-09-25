/**
 * Map dot glide — the pure half. A car's position arrives every ~5 s while
 * moving (see cadence.ts), and a dot that teleports 80 m per update reads as
 * lag. Instead the dot slides from where it is drawn to the new fix over a
 * short window, then rests on the real position.
 *
 * It only ever interpolates between two fixes that were actually received;
 * it never extrapolates ahead of the data. A dot showing a car somewhere it
 * isn't would be worse than a dot that jumps.
 */
import type { LatLng } from "../api/types";
import { haversineMeters } from "./geo";

/** How long one glide takes. Well under the 5 s send interval. */
export const GLIDE_MS = 700;

/**
 * Past this, a move is a reconnect or a re-acquired GPS lock, not driving:
 * snap instead of sweeping a dot across half the map.
 */
export const GLIDE_MAX_METERS = 1500;

/** Below this the move is GPS jitter; not worth a frame. */
export const GLIDE_MIN_METERS = 1;

export function shouldGlide(from: LatLng, to: LatLng): boolean {
  const d = haversineMeters(from, to);
  return d >= GLIDE_MIN_METERS && d <= GLIDE_MAX_METERS;
}

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/**
 * Straight-line interpolation in lat/lng. Fine at glide distances (≤ 1.5 km),
 * where the difference from a great-circle path is far below a dot's width.
 */
export function lerpLatLng(from: LatLng, to: LatLng, t: number): LatLng {
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t,
  };
}
