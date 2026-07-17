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
  /** Geofence radius around the meetup point, in meters. */
  geofenceRadiusM: number;
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
    ...overrides,
  };
}
