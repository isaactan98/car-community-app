/**
 * Normalise the configured backend base URL before anything builds a request
 * from it.
 *
 * This exists because of one character. `EXPO_PUBLIC_SERVER_URL` was once set
 * to `http:/100.124.2.91:4000` — a single slash — and the two halves of the app
 * disagreed about what that meant. `fetch` uses WHATWG URL parsing, which
 * tolerates any number of slashes after a special scheme, so REST worked
 * perfectly and the server log filled with healthy 200s and 304s. iOS's
 * WebSocket goes through NSURL, which does not: it read no host at all, so the
 * socket failed before a single byte left the phone. `ws.onerror` is a
 * deliberate no-op, the upgrade never reached the server to be logged, and the
 * only symptom was a live map stuck on "Offline" with no dot for yourself —
 * while every other screen behaved. Typos in this var are cheap to make and
 * were, for a day, almost impossible to see; fixing them here means REST and
 * the socket can never again disagree about where the server is.
 *
 * Also trims whitespace (`.env` files carry it) and trailing slashes, so
 * `API_BASE` cannot end up with `//api/v1`.
 */
export function normalizeServerUrl(raw: string): string {
  return raw
    .trim()
    .replace(/^(https?:)\/*/i, "$1//")
    .replace(/\/+$/, "");
}
