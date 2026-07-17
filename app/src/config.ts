/**
 * Single place to configure where the Runs backend lives.
 *
 * For a physical Android device on the same network, replace `localhost`
 * with your machine's LAN IP (e.g. http://192.168.1.20:4000) or your
 * Cloudflare Tunnel hostname (https://runs.example.com).
 *
 * Note: `localhost` on an Android device/emulator is the device itself.
 * On the stock Android emulator use http://10.0.2.2:4000 to reach the host.
 */
export const SERVER_URL = "http://localhost:4000";

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
