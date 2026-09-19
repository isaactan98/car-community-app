/**
 * Place search (spec R9) — the one thing on this server that talks to the
 * outside world.
 *
 * Why it lives here rather than in the app:
 *
 * - The app ships as a sideloaded APK to a private group. A geocoder baked
 *   into the bundle cannot be changed without 50 people reinstalling; behind
 *   this endpoint it is one environment variable.
 * - Free OSM geocoders are offered under policies written around a single
 *   identifiable client — a real `User-Agent` and a request ceiling. Fifty
 *   phones calling upstream directly is precisely how a group gets banned.
 * - Caching and per-member rate limiting only work where requests converge.
 *
 * Upstream is Photon-shaped (`?q=&lat=&lon=&limit=&lang=`), which the public
 * komoot instance and a self-hosted Photon both answer. Results are
 * OpenStreetMap data: whatever shows them must credit OpenStreetMap.
 *
 * No position of any member ever reaches this module — the bias point is the
 * map's centre, which is wherever the user has scrolled to.
 */
import type { Config } from './config.js';
import { HttpError } from './service.js';
import { isValidLat, isValidLng } from './geo.js';
import { log } from './logger.js';

export interface PlaceResult {
  /** The place's name, e.g. "Caltex". */
  label: string;
  /** Locality line, e.g. "Taman Molek, Johor Bahru, Malaysia". */
  detail: string;
  lat: number;
  lng: number;
}

export interface PlaceQuery {
  q: unknown;
  lat?: unknown;
  lng?: unknown;
  limit?: unknown;
}

/** Longest query we forward. Longer is a paste accident, not a place name. */
const MAX_QUERY_CHARS = 120;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 10;
/** Cache entries, evicted oldest-first. A few hundred covers a whole group. */
const MAX_CACHE_ENTRIES = 500;

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface CacheEntry {
  places: PlaceResult[];
  expiresAt: number;
}

export class PlaceSearch {
  private cache = new Map<string, CacheEntry>();
  /** memberId -> { windowStartedAt, count } for the per-minute ceiling. */
  private rate = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private config: Config,
    private fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {}

  /**
   * Resolve a query to places. Throws HttpError 400 (bad query), 429 (this
   * member is searching too fast) or 502 (upstream unreachable or malformed).
   */
  async search(memberId: string, query: PlaceQuery, now = Date.now()): Promise<PlaceResult[]> {
    const q = parseQuery(query.q);
    const lat = parseCoord(query.lat, isValidLat, 'lat');
    const lng = parseCoord(query.lng, isValidLng, 'lng');
    const limit = parseLimit(query.limit);

    const key = cacheKey(q, lat, lng, limit);
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.places;

    // Only uncached searches count against the ceiling: repeating a query the
    // server already knows costs upstream nothing, so it should cost the user
    // nothing either.
    this.consumeRateBudget(memberId, now);

    const places = await this.fetchUpstream(q, lat, lng, limit);
    this.remember(key, places, now);
    return places;
  }

  private consumeRateBudget(memberId: string, now: number): void {
    const window = this.rate.get(memberId);
    if (!window || now - window.startedAt >= 60_000) {
      this.rate.set(memberId, { startedAt: now, count: 1 });
      return;
    }
    if (window.count >= this.config.geocoderRatePerMinute) {
      throw new HttpError(429, 'too many searches — wait a moment');
    }
    window.count += 1;
  }

  private remember(key: string, places: PlaceResult[], now: number): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      // Map iterates in insertion order, so the first key is the oldest.
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, { places, expiresAt: now + this.config.geocoderCacheTtlMs });
  }

  private async fetchUpstream(
    q: string,
    lat: number | null,
    lng: number | null,
    limit: number,
  ): Promise<PlaceResult[]> {
    const url = new URL(this.config.geocoderUrl);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('lang', 'en');
    if (lat !== null && lng !== null) {
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.geocoderTimeoutMs);
    let body: unknown;
    try {
      const res = await this.fetchImpl(url.toString(), {
        headers: {
          'User-Agent': this.config.geocoderUserAgent,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        // The status is the useful part; the query is the user's business and
        // stays out of the log.
        log.warn('geocoder rejected a search', { status: res.status });
        throw new HttpError(502, 'place search is unavailable right now');
      }
      body = await res.json();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      log.warn('geocoder unreachable', {
        message: err instanceof Error ? err.message : String(err),
      });
      throw new HttpError(502, 'place search is unavailable right now');
    } finally {
      clearTimeout(timer);
    }
    return toPlaces(body);
  }
}

function parseQuery(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'q is required');
  const q = value.trim();
  if (q.length === 0) throw new HttpError(400, 'q is required');
  if (q.length > MAX_QUERY_CHARS) throw new HttpError(400, `q must be at most ${MAX_QUERY_CHARS} characters`);
  return q;
}

function parseCoord(
  value: unknown,
  valid: (n: unknown) => boolean,
  field: string,
): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!valid(n)) throw new HttpError(400, `${field} must be a valid coordinate`);
  return n;
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > MAX_LIMIT) {
    throw new HttpError(400, `limit must be between 1 and ${MAX_LIMIT}`);
  }
  return n;
}

/** Bias coordinates are rounded so a tiny map nudge still hits the cache. */
function cacheKey(q: string, lat: number | null, lng: number | null, limit: number): string {
  const near = lat !== null && lng !== null ? `${lat.toFixed(2)},${lng.toFixed(2)}` : '-';
  return `${q.toLowerCase()}|${near}|${limit}`;
}

interface PhotonFeature {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
}

/**
 * GeoJSON in, our four fields out. Deliberately forgiving: a geocoder we do
 * not control can return half-populated features, and one odd entry must not
 * fail the whole search.
 */
export function toPlaces(body: unknown): PlaceResult[] {
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const places: PlaceResult[] = [];
  for (const raw of features as PhotonFeature[]) {
    const coords = raw?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!isValidLat(lat) || !isValidLng(lng)) continue;
    const p = raw.properties ?? {};
    const label = featureLabel(p);
    if (label === '') continue;
    places.push({ label, detail: featureDetail(p, label), lat, lng });
  }
  return places;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function featureLabel(p: Record<string, unknown>): string {
  const name = str(p.name);
  if (name !== '') return name;
  const street = str(p.street);
  const housenumber = str(p.housenumber);
  if (street !== '') return housenumber !== '' ? `${housenumber} ${street}` : street;
  return str(p.locality) || str(p.district) || str(p.city) || str(p.county) || str(p.state);
}

/** Everything that helps tell two identically-named places apart, once each. */
function featureDetail(p: Record<string, unknown>, label: string): string {
  const parts: string[] = [];
  for (const key of ['street', 'locality', 'district', 'city', 'county', 'state', 'country']) {
    const value = str(p[key]);
    if (value !== '' && value !== label && !parts.includes(value)) parts.push(value);
  }
  return parts.slice(0, 3).join(', ');
}
