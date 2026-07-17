/**
 * Pure geo math: haversine distance, bearing, and the "distance to the car
 * ahead of me" heuristic (R4). No speed values anywhere.
 */
import type { LatLng } from "../api/types";

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `from` to `to`, in degrees [0, 360). */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = (Math.atan2(y, x) * 180) / Math.PI;
  return (θ + 360) % 360;
}

/** Smallest absolute difference between two bearings, in degrees [0, 180]. */
export function bearingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export interface CarAheadCandidate {
  memberId: string;
  displayName: string;
  position: LatLng;
}

export interface CarAheadResult {
  memberId: string;
  displayName: string;
  distanceMeters: number;
}

/**
 * "Distance to the car ahead" — simple version per spec R4:
 * the nearest other participant that lies ahead of me along my bearing to
 * the group's target (destination if set, else meetup). "Ahead" means the
 * bearing from me to them deviates < 90° from my bearing to the target,
 * i.e. their along-track component is positive.
 */
export function distanceToCarAhead(
  me: LatLng,
  target: LatLng,
  others: CarAheadCandidate[],
): CarAheadResult | null {
  const travelBearing = bearingDegrees(me, target);
  let best: CarAheadResult | null = null;
  for (const other of others) {
    const d = haversineMeters(me, other.position);
    if (d < 1) continue; // same spot — not "ahead"
    const b = bearingDegrees(me, other.position);
    if (bearingDiff(travelBearing, b) >= 90) continue; // behind or abeam
    if (best === null || d < best.distanceMeters) {
      best = {
        memberId: other.memberId,
        displayName: other.displayName,
        distanceMeters: d,
      };
    }
  }
  return best;
}

/** "850 m" under 1 km, "1.2 km" above. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
