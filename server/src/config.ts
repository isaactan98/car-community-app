/**
 * All runtime configuration, overridable via environment variables.
 * Timers are configurable so integration tests can run them fast.
 */
export interface Config {
  port: number;
  dbPath: string;
  /** Comma-separated invite codes seeded at boot (idempotent). */
  seedInviteCodes: string[];
  /** Base for the run deep link, e.g. "runs://run/". Run id is appended. */
  deepLinkBase: string;
  /** How often the server broadcasts a snapshot to each run's sockets. */
  snapshotIntervalMs: number;
  /** How often the auto-end / retention sweep runs. */
  sweepIntervalMs: number;
  /** Auto-end an active run after this long with no position updates. */
  autoEndAfterMs: number;
  /** Purge position history this long after a run ends. */
  retentionMs: number;
  /** Geofence radius around the meetup (and destination) point, in meters. */
  geofenceRadiusM: number;
  /**
   * How far a checked-in member must be from the meetup to count as having
   * left it. Deliberately larger than the geofence radius: walking across a
   * car park, or a kopitiam run down the road, must not read as "the convoy
   * has departed" and flip the whole run to its second leg.
   */
  departRadiusM: number;
  /**
   * Upstream geocoder for place search, Photon-compatible (`?q=&lat=&lon=&limit=`).
   * Behind our own endpoint so it can be repointed -- at a self-hosted Photon
   * on the homelab, or another provider -- without shipping 50 people a new APK.
   */
  geocoderUrl: string;
  /**
   * Sent as `User-Agent` upstream. Free geocoders' usage policies require a
   * real, identifying agent; an anonymous one is how a deployment gets banned.
   */
  geocoderUserAgent: string;
  /** Give up on the upstream geocoder after this long. */
  geocoderTimeoutMs: number;
  /** How long a search result stays cached (same query = no upstream call). */
  geocoderCacheTtlMs: number;
  /** Max upstream-hitting searches per member per minute. */
  geocoderRatePerMinute: number;
  /**
   * Serve the unauthenticated `/__diag/ws` reachability page. Off by default:
   * it is a debugging aid for the tailnet phase, and must not become a public
   * surface once the Cloudflare tunnel cutover lands (see "Release Gates" in
   * runs-v1-spec.md).
   */
  enableWsDiag: boolean;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid integer for env ${name}: ${raw}`);
  return n;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: intEnv('PORT', 4000),
    dbPath: process.env.DB_PATH ?? 'data/runs.db',
    seedInviteCodes: (process.env.INVITE_CODES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    deepLinkBase: process.env.DEEP_LINK_BASE ?? 'runs://run/',
    snapshotIntervalMs: intEnv('SNAPSHOT_INTERVAL_MS', 5_000),
    sweepIntervalMs: intEnv('SWEEP_INTERVAL_MS', 60_000),
    autoEndAfterMs: intEnv('AUTO_END_AFTER_MS', 2 * 60 * 60 * 1000),
    retentionMs: intEnv('RETENTION_MS', 24 * 60 * 60 * 1000),
    geofenceRadiusM: intEnv('GEOFENCE_RADIUS_M', 150),
    departRadiusM: intEnv('DEPART_RADIUS_M', 500),
    geocoderUrl: process.env.GEOCODER_URL ?? 'https://photon.komoot.io/api/',
    geocoderUserAgent:
      process.env.GEOCODER_USER_AGENT ??
      'runs-app/1.0 (private car-group coordination; https://github.com/isaactan98/car-community-app)',
    geocoderTimeoutMs: intEnv('GEOCODER_TIMEOUT_MS', 6_000),
    geocoderCacheTtlMs: intEnv('GEOCODER_CACHE_TTL_MS', 24 * 60 * 60 * 1000),
    geocoderRatePerMinute: intEnv('GEOCODER_RATE_PER_MINUTE', 30),
    enableWsDiag: (process.env.ENABLE_WS_DIAG ?? '') === '1',
    ...overrides,
  };
}
