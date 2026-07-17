/**
 * Single place to configure where the Runs backend lives.
 *
 * Set this per-environment via the `EXPO_PUBLIC_SERVER_URL` env var (Expo
 * inlines any `EXPO_PUBLIC_*` var into the bundle at build time). Put your
 * real value in `.env.local` (git-ignored) — see `.env.example`. If the var
 * is unset it falls back to `http://localhost:4000` for same-machine dev.
 *
 * Examples:
 *   - Physical device on the same LAN:  http://192.168.1.20:4000
 *   - Over Tailscale (device + NAS on the tailnet):  http://100.124.2.91:4000
 *   - Android emulator reaching the host:  http://10.0.2.2:4000
 *   - Public tunnel/domain:  https://runs.example.com
 *
 * Note: `localhost` on a physical device/emulator means the device itself,
 * not your dev machine — use a reachable IP/hostname there.
 */
export const SERVER_URL =
  process.env.EXPO_PUBLIC_SERVER_URL ?? "http://localhost:4000";

/** REST base path, per docs/CONTRACT.md. */
export const API_BASE = `${SERVER_URL}/api/v1`;

/** WebSocket endpoint, per docs/CONTRACT.md. */
export const WS_BASE = `${SERVER_URL.replace(/^http/, "ws")}/ws`;

/** Free OpenFreeMap style — no Mapbox / Google Maps SDKs (hard constraint). */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** REST request timeout — fail fast so degraded mode kicks in quickly. */
export const REQUEST_TIMEOUT_MS = 8000;

/** Position send cadence (client-side throttle on top of raw GPS updates). */
export const MOVING_SEND_INTERVAL_MS = 5_000;
export const STATIONARY_SEND_INTERVAL_MS = 30_000;
/** Displacement below this between sends counts as "stationary". */
export const STATIONARY_DISPLACEMENT_M = 15;

/** A member dot is stale when its last position is older than this. */
export const STALENESS_THRESHOLD_MS = 60_000;

/** Minimum interval between client-computed `eta` messages. */
export const ETA_SEND_INTERVAL_MS = 15_000;
