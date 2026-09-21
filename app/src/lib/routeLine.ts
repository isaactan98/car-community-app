/**
 * The line between the meetup and the destination on the live map. Pure
 * module — unit tested.
 *
 * Two kinds of line, and the difference is the whole point of this file:
 *
 * - **road** — the actual driveable route, from the server (`GET
 *   /runs/:id/route`). This is what you want: a straight line from a meetup in
 *   Gelang Patah to a kopitiam in Singapore cuts across the Straits of Johor,
 *   which is not a road, and a map that draws roads through water is a map
 *   nobody trusts at 100 km/h on the Second Link.
 * - **direct** — the great-circle fallback, drawn when the router is off,
 *   unreachable, or has no answer. It is honest about being an "as the crow
 *   flies" bearing rather than a route, and the UI must style it differently
 *   (dashed) and say so, or it becomes the lie above.
 *
 * This line is decoration for orientation, not navigation. Nothing here feeds
 * the "distance to the car ahead" readout or the ETA — those stay on
 * straight-line geometry (`lib/geo.ts`, `lib/eta.ts`) so the number a driver
 * reads never silently changes meaning depending on whether a public router
 * happened to answer. Turn-by-turn is still Waze's job (R5).
 *
 * The direct line is sampled along the great circle rather than drawn as two
 * points, because MapLibre joins a two-point LineString in *screen* space —
 * a rhumb line, not a great circle. Near the equator, which is where this app
 * lives, the two barely differ, so this is insurance rather than a visible
 * fix today: it keeps the drawn line and the bearing maths telling the same
 * story if a run ever stretches east–west across a few time zones.
 */
import type { LatLng, Place } from "../api/types";

/** A route as the server hands it over (`GET /runs/:id/route`). */
export interface RunRoute {
  points: LatLng[];
  /** Length of the road route in meters. Never a duration — see the server. */
  distanceMeters: number;
}

export type RouteLineKind = "road" | "direct";

export interface RouteLine {
  kind: RouteLineKind;
  /** GeoJSON order: [lng, lat]. At least two positions. */
  coordinates: [number, number][];
}

/** Sample count for the direct fallback, endpoints included. */
const DIRECT_SAMPLES = 33;
/**
 * Below this, the two are the same line to well under a pixel, and two points
 * is the cheaper thing to hand the renderer. Every run inside the Johor–
 * Singapore corridor lands here.
 */
const INTERPOLATE_ABOVE_M = 50_000;

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * The line to draw between `meetup` and `destination`, or null when there is
 * nothing to draw (no destination, or the two pins are the same spot).
 *
 * `route` is the server's road answer; pass null whenever it is missing and
 * the direct fallback is used instead.
 */
export function routeLine(
  meetup: Place | LatLng | null | undefined,
  destination: Place | LatLng | null | undefined,
  route: RunRoute | null | undefined,
): RouteLine | null {
  if (!meetup || !destination) return null;

  const road = route?.points ?? [];
  if (road.length >= 2) {
    return { kind: "road", coordinates: road.map((p) => [p.lng, p.lat]) };
  }

  // Two pins dropped on the same spot: a zero-length line is a rendering
  // artefact, not information.
  if (greatCircleMeters(meetup, destination) < 1) return null;
  return { kind: "direct", coordinates: directCoordinates(meetup, destination) };
}

/** Great-circle samples from `a` to `b`, in GeoJSON [lng, lat] order. */
export function directCoordinates(a: LatLng, b: LatLng): [number, number][] {
  if (greatCircleMeters(a, b) <= INTERPOLATE_ABOVE_M) {
    return [
      [a.lng, a.lat],
      [b.lng, b.lat],
    ];
  }
  // Endpoints are pinned to the inputs rather than taken from the slerp:
  // round-tripping a coordinate through the sphere and back moves it by a
  // float epsilon, and the line has to start exactly on the meetup pin.
  const out: [number, number][] = [[a.lng, a.lat]];
  for (let i = 1; i < DIRECT_SAMPLES - 1; i += 1) {
    const p = interpolate(a, b, i / (DIRECT_SAMPLES - 1));
    out.push([p.lng, p.lat]);
  }
  out.push([b.lng, b.lat]);
  return out;
}

/**
 * Point a fraction `t` of the way along the great circle from `a` to `b`.
 * Standard slerp on the sphere; `t` is clamped to [0, 1].
 */
export function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  const f = Math.min(1, Math.max(0, t));
  const φ1 = toRad(a.lat);
  const λ1 = toRad(a.lng);
  const φ2 = toRad(b.lat);
  const λ2 = toRad(b.lng);
  const δ = greatCircleMeters(a, b) / EARTH_RADIUS_M;
  // Coincident points have no defined direction; sin(δ) would be 0.
  if (δ === 0) return { lat: a.lat, lng: a.lng };

  const A = Math.sin((1 - f) * δ) / Math.sin(δ);
  const B = Math.sin(f * δ) / Math.sin(δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return {
    lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
    lng: toDeg(Math.atan2(y, x)),
  };
}

/**
 * Local copy of the haversine so this module stays free of `lib/geo.ts` — that
 * file is the "car ahead" maths, and the two must never start sharing
 * assumptions by accident.
 */
function greatCircleMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** GeoJSON a `<GeoJSONSource>` can take straight as its `data`. */
export function routeFeature(line: RouteLine): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: { kind: line.kind },
    geometry: { type: "LineString", coordinates: line.coordinates },
  };
}

/**
 * Parse `GET /runs/:id/route`. Forgiving on purpose: a build talking to an
 * older server gets 404/no field and must degrade to the direct line rather
 * than show an error over a map that is otherwise fine.
 */
export function parseRunRoute(body: unknown): RunRoute | null {
  const route = (body as { route?: unknown })?.route;
  if (!route || typeof route !== "object") return null;
  const raw = (route as { points?: unknown }).points;
  if (!Array.isArray(raw)) return null;
  const points: LatLng[] = [];
  for (const p of raw) {
    const lat = Number((p as LatLng)?.lat);
    const lng = Number((p as LatLng)?.lng);
    if (!isFiniteLat(lat) || !isFiniteLng(lng)) continue;
    points.push({ lat, lng });
  }
  if (points.length < 2) return null;
  const distance = Number((route as { distanceMeters?: unknown }).distanceMeters);
  return {
    points,
    distanceMeters: Number.isFinite(distance) && distance >= 0 ? distance : 0,
  };
}

const isFiniteLat = (n: number) => Number.isFinite(n) && n >= -90 && n <= 90;
const isFiniteLng = (n: number) => Number.isFinite(n) && n >= -180 && n <= 180;
