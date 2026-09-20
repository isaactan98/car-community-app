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
import { normalizeServerUrl } from "./lib/serverUrl";

export const SERVER_URL = normalizeServerUrl(
  process.env.EXPO_PUBLIC_SERVER_URL ?? "http://localhost:4000",
);

/** REST base path, per docs/CONTRACT.md. */
export const API_BASE = `${SERVER_URL}/api/v1`;

/** WebSocket endpoint, per docs/CONTRACT.md. */
export const WS_BASE = `${SERVER_URL.replace(/^http/, "ws")}/ws`;

/** Free OpenFreeMap styles — no Mapbox / Google Maps SDKs (hard constraint). */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
/** Dark variant, used whenever the system is in Dark Mode. */
export const MAP_STYLE_DARK_URL = "https://tiles.openfreemap.org/styles/dark";
/** Muted light style for the live map, so people stand out (HIG › Maps). */
export const MAP_STYLE_MUTED_URL = "https://tiles.openfreemap.org/styles/positron";

/** REST request timeout — fail fast so degraded mode kicks in quickly. */
export const REQUEST_TIMEOUT_MS = 8000;

/** Position send cadence (client-side throttle on top of raw GPS updates). */
export const MOVING_SEND_INTERVAL_MS = 5_000;
export const STATIONARY_SEND_INTERVAL_MS = 30_000;
/** Displacement below this between sends counts as "stationary". */
export const STATIONARY_DISPLACEMENT_M = 15;

/** A member dot is stale when its last position is older than this. */
export const STALENESS_THRESHOLD_MS = 60_000;

/**
 * Place search (R9). The debounce is not cosmetic: the geocoder behind our
 * server is a free OSM service used under a policy that forbids a request per
 * keystroke, and the minimum length keeps "ca" from ever leaving the phone.
 */
export const PLACE_SEARCH_DEBOUNCE_MS = 400;
export const PLACE_SEARCH_MIN_CHARS = 3;
export const PLACE_SEARCH_LIMIT = 6;

/** Minimum interval between client-computed `eta` messages. */
export const ETA_SEND_INTERVAL_MS = 15_000;

/**
 * Half-open socket detection.
 *
 * The server broadcasts a `snapshot` every ~5 s (docs/CONTRACT.md), so inbound
 * silence is a reliable liveness signal — no protocol-level ping needed, and
 * the contract stays untouched (the client may only send `position` and `eta`).
 *
 * This exists because of iOS: when the OS suspends the app it tears the TCP
 * connection down underneath us, but JS still reports `readyState === OPEN`,
 * so `send()` succeeds into the void and the UI keeps claiming "connected".
 * Android never shows this — the location foreground service keeps the process
 * and its socket alive — which is exactly why the bug read as iOS-only.
 */
export const WS_INBOUND_TIMEOUT_MS = 20_000;
export const WS_WATCHDOG_INTERVAL_MS = 5_000;

/**
 * Per-OEM battery / "Allow all the time" setup guide (docs/android-battery-setup.md),
 * surfaced in-app when a phone is likely to kill background location. Points at
 * the repo copy on `main` so it stays reachable without bundling a markdown
 * renderer; expand the doc as group devices reveal new quirks.
 */
export const BATTERY_GUIDE_URL =
  "https://github.com/isaactan98/car-community-app/blob/main/docs/android-battery-setup.md";
