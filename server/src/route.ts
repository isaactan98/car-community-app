/**
 * Road route between a run's meetup and its destination (the line drawn on
 * the live map).
 *
 * Why the server and not the app, for the same three reasons as `places.ts`:
 * the router URL must be repointable without reinstalling 50 APKs, free OSM
 * routers are offered to *one* identifiable client rather than fifty phones,
 * and caching only works where requests converge.
 *
 * The thing that makes a public router viable here at all is that this route
 * cannot change. A run's meetup and destination are fixed at creation — there
 * is no edit endpoint — so the answer for a given run is the same forever, and
 * for a whole group on a whole run it costs exactly one upstream call. That is
 * why there is no per-member ceiling like place search has: the cache key is
 * the pair of points, not a free-text query, so the ceiling is "how many runs
 * exist", and only a member who can already read the run can ask.
 *
 * Three defences keep that "one call" honest:
 *   - a long positive cache, because the road does not move;
 *   - a short negative cache, so a router that is down is asked again in a
 *     minute rather than by every phone that opens the map;
 *   - in-flight coalescing, because fifty phones open the live map within the
 *     same second at the start of a run, before any cache entry exists.
 *
 * Upstream is OSRM-shaped (`/{lng},{lat};{lng},{lat}?geometries=geojson`),
 * which the FOSSGIS demo server and a self-hosted OSRM both answer. Results
 * are OpenStreetMap data: whatever shows them must credit OpenStreetMap.
 *
 * `duration` is deliberately dropped from the upstream response and never
 * reaches our own. Distance over duration is a speed, and Hard Constraint 1
 * says no speed value exists anywhere in this system. The app's ETA is its
 * own business (`app/src/lib/eta.ts`) and stays that way.
 */
import type { Config } from './config.js';
import type { Point } from './service.js';
import { isValidLat, isValidLng } from './geo.js';
import { log } from './logger.js';

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RouteLine {
  /** Road geometry, meetup first, destination last. At least two points. */
  points: RoutePoint[];
  /** Length of the road route in meters — NOT of the straight line. */
  distanceMeters: number;
}

/**
 * Keep the payload sane for a phone on a tunnel. A JB–Kuantan route at
 * `overview=simplified` is a few hundred points; this only ever bites on a
 * pathological one, and evenly dropping points from a line that is already
 * simplified for display costs nothing visible.
 */
const MAX_POINTS = 1_000;

type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface CacheEntry {
  /** null = upstream failed; held briefly so a dead router isn't hammered. */
  route: RouteLine | null;
  expiresAt: number;
}

export class RouteLookup {
  private cache = new Map<string, CacheEntry>();
  /** key -> the upstream call already in flight for it. */
  private inFlight = new Map<string, Promise<RouteLine | null>>();

  constructor(
    private config: Config,
    private fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {}

  /**
   * The road route from `from` to `to`, or null when the router is
   * unreachable, disabled, or has no road answer. Never throws: a missing
   * route is a degraded map, not a failed request — the app falls back to a
   * straight line and says so.
   */
  async between(from: Point, to: Point, now = Date.now()): Promise<RouteLine | null> {
    if (this.config.routerUrl === '') return null;

    const key = cacheKey(from, to);
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.route;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const call = this.fetchUpstream(from, to)
      .then((route) => {
        this.remember(key, route, now);
        return route;
      })
      .catch((err: unknown) => {
        log.warn('router unreachable', {
          message: err instanceof Error ? err.message : String(err),
        });
        this.remember(key, null, now);
        return null;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, call);
    return call;
  }

  private remember(key: string, route: RouteLine | null, now: number): void {
    if (this.cache.size >= this.config.routerCacheMaxEntries) {
      // Map iterates in insertion order, so the first key is the oldest.
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    const ttl = route ? this.config.routerCacheTtlMs : this.config.routerFailureTtlMs;
    this.cache.set(key, { route, expiresAt: now + ttl });
  }

  private async fetchUpstream(from: Point, to: Point): Promise<RouteLine | null> {
    // OSRM takes coordinates in the path, lng first, semicolon-separated.
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = new URL(`${this.config.routerUrl.replace(/\/+$/, '')}/${coords}`);
    // `simplified` is the overview OSM's own site draws with: enough shape to
    // follow the road, few enough points to send to a phone.
    url.searchParams.set('overview', 'simplified');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('alternatives', 'false');
    url.searchParams.set('steps', 'false');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.routerTimeoutMs);
    let body: unknown;
    try {
      const res = await this.fetchImpl(url.toString(), {
        headers: {
          'User-Agent': this.config.routerUserAgent,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        log.warn('router rejected a route', { status: res.status });
        return null;
      }
      body = await res.json();
    } finally {
      clearTimeout(timer);
    }
    return toRouteLine(body);
  }
}

/** Rounded to ~1 m: two runs meeting at the same pin share one upstream call. */
function cacheKey(from: Point, to: Point): string {
  const p = (n: number) => n.toFixed(5);
  return `${p(from.lat)},${p(from.lng)}|${p(to.lat)},${p(to.lng)}`;
}

/**
 * OSRM GeoJSON in, our two fields out. Deliberately forgiving in the same way
 * `toPlaces` is — a router we do not control can answer `code: "NoRoute"` for
 * a pin in the sea, and that is a straight-line map, not a 500.
 */
export function toRouteLine(body: unknown): RouteLine | null {
  const routes = (body as { routes?: unknown })?.routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;
  const first = routes[0] as {
    geometry?: { coordinates?: unknown };
    distance?: unknown;
  };
  const coords = first?.geometry?.coordinates;
  if (!Array.isArray(coords)) return null;

  const points: RoutePoint[] = [];
  for (const raw of coords) {
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const lng = Number(raw[0]);
    const lat = Number(raw[1]);
    if (!isValidLat(lat) || !isValidLng(lng)) continue;
    points.push({ lat, lng });
  }
  // A one-point "route" draws nothing; treat it as no answer.
  if (points.length < 2) return null;

  const distance = Number(first.distance);
  return {
    points: decimate(points, MAX_POINTS),
    distanceMeters: Number.isFinite(distance) && distance >= 0 ? distance : 0,
  };
}

/** Evenly thin `points` to at most `max`, always keeping both endpoints. */
export function decimate(points: RoutePoint[], max: number): RoutePoint[] {
  const last = points[points.length - 1];
  if (points.length <= max || max < 2 || last === undefined) return points;
  const out: RoutePoint[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max - 1; i += 1) {
    const p = points[Math.round(i * step)];
    if (p !== undefined) out.push(p);
  }
  out.push(last);
  return out;
}
