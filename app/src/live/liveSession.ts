/**
 * The live-run session singleton: owns the WebSocket and the background
 * location pipeline for the one run the user is currently sharing into.
 *
 * Privacy (R7, hard constraint 4):
 * - startLiveSession() is only ever called for a run that is `active` and
 *   that this member has joined.
 * - stopLiveSession() hard-stops everything (background task, foreground
 *   watcher, socket) and is invoked on: leave RSVP, run end (REST or
 *   `run_state` WS message), logout, and unmount of the last live screen
 *   when the run is no longer active. No ambient tracking, ever.
 *
 * No-speed rule (hard constraint 1): outgoing `position` messages are built
 * literally as { type, lat, lng, ts } from the GPS fix — `coords.speed` and
 * every other field never leaves this module, is never stored, and is never
 * logged.
 */
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { AppState, Linking, Platform } from "react-native";

import type {
  ClientMessage,
  LatLng,
  Position,
  Run,
  RunPhase,
  ServerMessage,
  SnapshotMessage,
} from "../api/types";
import {
  ETA_SEND_INTERVAL_MS,
  SERVER_URL,
  WS_BASE,
  WS_INBOUND_TIMEOUT_MS,
  WS_WATCHDOG_INTERVAL_MS,
} from "../config";
import { shouldSendPosition } from "../lib/cadence";
import { estimateEtaSeconds } from "../lib/eta";
import { currentLeg } from "../lib/leg";
import { cacheSnapshot } from "../storage/storage";

export const LOCATION_TASK = "runs-live-location";

export type LiveSessionEvent =
  | { kind: "message"; message: ServerMessage; receivedAt: number }
  | { kind: "connection"; connected: boolean }
  | { kind: "sharing"; sharing: boolean };

type Listener = (event: LiveSessionEvent) => void;

interface SessionState {
  runId: string;
  token: string;
  selfId: string;
  meetup: LatLng;
  /** Null for a one-leg run: there is nowhere to go after the meetup. */
  destination: LatLng | null;
  /** The group's leg, tracked from `run_phase` and every snapshot. */
  phase: RunPhase;
  socket: WebSocket | null;
  connected: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  stopping: boolean;
  /** Last position actually sent (cadence anchor). lat/lng/ts only. */
  lastSent: Position | null;
  /**
   * The newest fix that passed the cadence check but found no open socket.
   * Sent the moment the socket opens, so a fix that lands mid-reconnect (or
   * before the first handshake finishes) is delayed, not lost. lat/lng/ts only.
   */
  pending: Position | null;
  /** Timestamp of the newest fix accepted, to drop duplicates across feeds. */
  newestFixTs: number;
  /** Recent fixes for client-side ETA estimation. lat/lng/ts only. */
  recent: Position[];
  lastEtaSentAt: number;
  /** Checked in at the meetup. */
  arrived: boolean;
  /** Reached the destination — the run is over for this member's ETA. */
  atDestination: boolean;
  /** Foreground-only fallback watcher when background permission denied. */
  fgWatcher: Location.LocationSubscription | null;
  usingBackgroundTask: boolean;
  lastSnapshotCacheAt: number;
  /**
   * Bumped on every `openSocket`. Handlers capture their generation and become
   * no-ops once superseded, so a forced reconnect can close the old socket
   * without its `onclose` racing a second one into existence.
   */
  socketGen: number;
  /** Wall-clock of the last frame received from the server (liveness, not data). */
  lastInboundAt: number;
  watchdog: ReturnType<typeof setInterval> | null;
}

let session: SessionState | null = null;
/** In-flight `startLiveSession` call, so two effects cannot open two sockets. */
let starting: { runId: string; promise: Promise<StartResult> } | null = null;
const listeners = new Set<Listener>();

/**
 * Why the live map says what it says.
 *
 * Diagnosing "it shows Offline on one phone but not another" used to mean
 * guessing: `ws.onerror` is a deliberate no-op and a refused upgrade leaves no
 * trace on the device at all. This is the smallest record that makes the
 * question answerable from the Profile screen, and it deliberately holds *no*
 * location data — counters, socket close codes and the server URL only, so it
 * can never become a back door around the no-speed and share-only-during-a-run
 * guarantees (spec hard constraints 1 and 4).
 *
 * It outlives `stopLiveSession()` on purpose: the failure you need to read is
 * usually the one that already happened.
 */
export interface LiveDiagnostics {
  /** Base URL this build was compiled against — `EXPO_PUBLIC_SERVER_URL`. */
  serverUrl: string;
  /** WS endpoint without the query string; the token never appears here. */
  wsEndpoint: string;
  runId: string | null;
  connected: boolean;
  /** ms since the last frame from the server, or null if none ever arrived. */
  inboundAgeMs: number | null;
  lastCloseCode: number | null;
  lastCloseReason: string | null;
  /** True if a socket has ever reached `onopen` in this app session. */
  everConnected: boolean;
  reconnectAttempt: number;
  forcedReconnects: number;
  /** Why the watchdog last replaced a socket it no longer trusted. */
  lastForcedReason: string | null;
  positionsSent: number;

  // ---- the location half ----
  // A connected socket says nothing about GPS: the socket opens before
  // permissions are even requested. Without these, "No signal yet" and
  // "Finding your position…" are dead ends — you cannot tell a refused
  // permission from a foreground service that never started from a phone
  // that simply has not got a fix yet indoors.
  /** What the OS has granted us, as of the last start. No coordinates. */
  locationPermission: "unknown" | "denied" | "whileInUse" | "always";
  /** How fixes are being collected, if at all. */
  locationMode:
    | "not started"
    | "foreground only"
    | "background service"
    | "background service + live watcher";
  /** Why the location pipeline failed to start, verbatim from the OS. */
  lastLocationError: string | null;
  /** Raw fixes handed to us by the OS (before the send cadence thins them). */
  fixesReceived: number;
  /** ms since the last fix arrived, or null if none ever has. */
  lastFixAgeMs: number | null;
}

const diag = {
  lastCloseCode: null as number | null,
  lastCloseReason: null as string | null,
  everConnected: false,
  forcedReconnects: 0,
  lastForcedReason: null as string | null,
  positionsSent: 0,
  locationPermission: "unknown" as LiveDiagnostics["locationPermission"],
  locationMode: "not started" as LiveDiagnostics["locationMode"],
  lastLocationError: null as string | null,
  fixesReceived: 0,
  /** Wall-clock only — never the fix itself (hard constraints 1 and 4). */
  lastFixAt: null as number | null,
};

export function liveDiagnostics(): LiveDiagnostics {
  const s = session;
  return {
    serverUrl: SERVER_URL,
    wsEndpoint: WS_BASE,
    runId: s?.runId ?? null,
    connected: s?.connected ?? false,
    inboundAgeMs: s?.lastInboundAt ? Date.now() - s.lastInboundAt : null,
    lastCloseCode: diag.lastCloseCode,
    lastCloseReason: diag.lastCloseReason,
    everConnected: diag.everConnected,
    reconnectAttempt: s?.reconnectAttempt ?? 0,
    forcedReconnects: diag.forcedReconnects,
    lastForcedReason: diag.lastForcedReason,
    positionsSent: diag.positionsSent,
    locationPermission: diag.locationPermission,
    locationMode: diag.locationMode,
    lastLocationError: diag.lastLocationError,
    fixesReceived: diag.fixesReceived,
    lastFixAgeMs: diag.lastFixAt === null ? null : Date.now() - diag.lastFixAt,
  };
}

function emit(event: LiveSessionEvent) {
  for (const l of Array.from(listeners)) {
    try {
      l(event);
    } catch {
      // listener errors must never break the pipeline
    }
  }
}

export function subscribeLiveSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribe on behalf of one run's screen. Socket messages belong to the
 * active session's run only — letting them through elsewhere would paint that
 * run's board (and its `runState`) onto a different run, which can flip an
 * upcoming run to "active" and start sharing into it (R7). Connection and
 * sharing changes also pass when no session is active, since a stop affects
 * every screen.
 */
export function subscribeToRun(runId: string, listener: Listener): () => void {
  return subscribeLiveSession((event) => {
    const active = session?.runId ?? null;
    if (active === runId || (event.kind !== "message" && active === null)) {
      listener(event);
    }
  });
}

export function activeSessionRunId(): string | null {
  return session?.runId ?? null;
}

export function isSocketConnected(): boolean {
  return session?.connected ?? false;
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

function wsUrl(token: string, runId: string): string {
  return `${WS_BASE}?token=${encodeURIComponent(token)}&runId=${encodeURIComponent(runId)}`;
}

function openSocket(s: SessionState) {
  if (s.stopping) return;
  const gen = ++s.socketGen;
  const current = () => session === s && !s.stopping && gen === s.socketGen;
  const ws = new WebSocket(wsUrl(s.token, s.runId));
  s.socket = ws;

  ws.onopen = () => {
    if (!current()) return;
    s.connected = true;
    s.reconnectAttempt = 0;
    s.lastInboundAt = Date.now();
    diag.everConnected = true;
    emit({ kind: "connection", connected: true });
    flushPending(s);
  };

  ws.onmessage = (evt) => {
    if (!current()) return;
    // Any frame proves the socket is alive — record before parsing, so a
    // malformed frame still counts as liveness and can't trip the watchdog.
    s.lastInboundAt = Date.now();
    let message: ServerMessage;
    try {
      message = JSON.parse(String(evt.data)) as ServerMessage;
    } catch {
      return; // ignore malformed frames
    }
    if (!message || typeof message.type !== "string") return;
    const receivedAt = Date.now();

    if (message.type === "snapshot") {
      handleSnapshot(s, message, receivedAt);
    } else if (
      message.type === "member_arrived" &&
      message.memberId === s.selfId
    ) {
      s.arrived = true;
      // The meetup ETA is spent; the next one is to the destination, and only
      // once the group has actually left (see etaTarget).
      s.lastEtaSentAt = 0;
    } else if (
      message.type === "member_at_destination" &&
      message.memberId === s.selfId
    ) {
      s.atDestination = true;
    } else if (message.type === "run_phase") {
      s.phase = message.phase;
      s.lastEtaSentAt = 0; // new leg, new target: do not wait out the interval
    } else if (message.type === "run_state" && message.state === "ended") {
      // Hard privacy stop: run over → stop sharing immediately (R7).
      emit({ kind: "message", message, receivedAt });
      void stopLiveSession();
      return;
    }
    emit({ kind: "message", message, receivedAt });
  };

  ws.onclose = (evt) => {
    // Guard first: a socket we deliberately orphaned in forceReconnect will
    // close too, and letting its (meaningless) code overwrite the record would
    // bury the one we need. A refused upgrade arrives here as a close on a
    // socket that never opened, and is the only place the server's reason is
    // ever visible on the device.
    if (!current()) return;
    diag.lastCloseCode = typeof evt?.code === "number" ? evt.code : null;
    diag.lastCloseReason = evt?.reason ? String(evt.reason) : null;
    s.socket = null;
    if (s.connected) {
      s.connected = false;
      emit({ kind: "connection", connected: false });
    }
    scheduleReconnect(s);
  };

  ws.onerror = () => {
    // onclose follows with the code/reason; nothing is logged here, because an
    // error event can carry frame payloads and positions never reach a log (R7).
  };
}

/** True when the server has gone quiet for longer than a snapshot cycle allows. */
function inboundIsStale(s: SessionState): boolean {
  return Date.now() - s.lastInboundAt > WS_INBOUND_TIMEOUT_MS;
}

/**
 * Tear down a socket we no longer trust and immediately open a fresh one.
 *
 * Bumping `socketGen` first orphans the old handlers, so the `close()` below
 * cannot drive `onclose` into scheduling a second, competing reconnect. The
 * backoff is reset deliberately: this is a known-dead connection on a network
 * that just came back, not a server we should be backing off from.
 */
function forceReconnect(s: SessionState, reason: string) {
  if (s.stopping || session !== s) return;
  diag.forcedReconnects += 1;
  diag.lastForcedReason = reason;
  const ws = s.socket;
  s.socket = null;
  s.socketGen += 1;
  if (ws) {
    try {
      ws.close();
    } catch {
      // already gone
    }
  }
  if (s.reconnectTimer) {
    clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
  }
  if (s.connected) {
    s.connected = false;
    emit({ kind: "connection", connected: false });
  }
  s.reconnectAttempt = 0;
  openSocket(s);
}

function startWatchdog(s: SessionState) {
  stopWatchdog(s);
  s.watchdog = setInterval(() => {
    if (session !== s || s.stopping) return;
    if (s.connected && inboundIsStale(s)) {
      forceReconnect(s, "no server traffic");
    }
  }, WS_WATCHDOG_INTERVAL_MS);
}

function stopWatchdog(s: SessionState) {
  if (s.watchdog) {
    clearInterval(s.watchdog);
    s.watchdog = null;
  }
}

/**
 * One listener for the whole module, armed while a session is live.
 *
 * Coming back to the foreground is the moment iOS hands the JS runtime back
 * after a suspend, and the moment a socket the OS quietly killed has to be
 * replaced. Timers do not fire while suspended, so the watchdog alone would
 * not notice until a full interval after resume — this closes that gap.
 */
let appStateSub: { remove: () => void } | null = null;

function startAppStateWatch() {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    const s = session;
    if (!s || s.stopping) return;
    if (!s.connected || inboundIsStale(s)) {
      forceReconnect(s, "resumed from background");
    }
  });
}

function stopAppStateWatch() {
  appStateSub?.remove();
  appStateSub = null;
}

function scheduleReconnect(s: SessionState) {
  if (s.stopping || session !== s || s.reconnectTimer) return;
  const delay = Math.min(15_000, 1000 * 2 ** s.reconnectAttempt);
  s.reconnectAttempt += 1;
  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null;
    if (session === s && !s.stopping) openSocket(s);
  }, delay);
}

function sendMessage(s: SessionState, message: ClientMessage): boolean {
  const ws = s.socket;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

/** Send the fix that was held back while the socket was down, if still newest. */
function flushPending(s: SessionState) {
  const p = s.pending;
  if (!p) return;
  s.pending = null;
  if (s.lastSent && p.ts <= s.lastSent.ts) return;
  if (sendPosition(s, p)) return;
  s.pending = p; // socket dropped again already; keep it for the next open
}

function sendPosition(s: SessionState, position: Position): boolean {
  const sent = sendMessage(s, {
    type: "position",
    lat: position.lat,
    lng: position.lng,
    ts: position.ts,
  });
  if (sent) {
    s.lastSent = position;
    diag.positionsSent += 1;
  }
  return sent;
}

function handleSnapshot(
  s: SessionState,
  snapshot: SnapshotMessage,
  receivedAt: number,
) {
  // Snapshots are the authority, and the only signal a client that missed a
  // one-shot `member_arrived` / `run_phase` frame ever gets.
  if (snapshot.runPhase === "driving" || snapshot.runPhase === "gathering") {
    s.phase = snapshot.runPhase;
  }
  const self = snapshot.members.find((m) => m.memberId === s.selfId);
  if (self?.status === "arrived") s.arrived = true;
  if (self?.atDestination) s.atDestination = true;
  // Persist for degraded mode (R6); throttled to every 10 s.
  if (receivedAt - s.lastSnapshotCacheAt >= 10_000) {
    s.lastSnapshotCacheAt = receivedAt;
    void cacheSnapshot(s.runId, snapshot);
  }
}

// ---------------------------------------------------------------------------
// Location pipeline
// ---------------------------------------------------------------------------

/**
 * Consume raw GPS fixes. Extracts lat/lng/ts ONLY — everything else in the
 * fix (speed, heading, accuracy, altitude) is dropped on the floor here.
 */
function handleFixes(fixes: Location.LocationObject[]) {
  const s = session;
  if (!s || s.stopping) return;

  for (const fix of fixes) {
    const position: Position = {
      lat: fix.coords.latitude,
      lng: fix.coords.longitude,
      ts: fix.timestamp,
    };
    // Android can feed the same fix twice (service + live watcher), and the
    // service's JobScheduler path can deliver late and out of order. Only
    // ever move forward in time.
    if (position.ts <= s.newestFixTs) continue;
    s.newestFixTs = position.ts;
    diag.fixesReceived += 1;
    diag.lastFixAt = Date.now();

    // Keep a short buffer for ETA math.
    s.recent.push(position);
    if (s.recent.length > 30) s.recent.splice(0, s.recent.length - 30);

    if (!shouldSendPosition(s.lastSent, position)) continue;
    // Not sent means no open socket: hold the newest one for onopen. Until
    // something is sent, lastSent does not move, so every later fix passes
    // the cadence check and replaces it — the queue is only ever one deep.
    s.pending = sendPosition(s, position) ? null : position;
  }

  // Client-computed ETA to whichever leg target is ours right now (contract
  // `eta`). Null means there is nothing worth estimating — we are at the
  // meetup and the group has not moved, or we are already at the destination —
  // and the server would drop the message anyway.
  const target = etaTarget(s);
  const now = Date.now();
  if (target && now - s.lastEtaSentAt >= ETA_SEND_INTERVAL_MS) {
    const etaSeconds = estimateEtaSeconds(s.recent, target);
    if (etaSeconds !== null) {
      if (sendMessage(s, { type: "eta", etaSeconds })) {
        s.lastEtaSentAt = now;
      }
    }
  }
}

/**
 * Where my ETA points, or null when an ETA would be meaningless.
 *
 * Mirrors the server's own rule (docs/CONTRACT.md) so we never burn a socket
 * frame on a message it will silently drop: the meetup until I check in, the
 * destination once the group has left it, and nothing at all in between or
 * after I arrive.
 */
function etaTarget(s: SessionState): LatLng | null {
  if (s.atDestination) return null;
  const leg = currentLeg(
    { phase: s.phase, destination: s.destination ? { ...s.destination, label: "" } : null },
    { status: s.arrived ? "arrived" : "rsvped", atDestination: s.atDestination },
  );
  if (leg === "destination") return s.destination;
  return s.arrived ? null : s.meetup;
}

// Registered at module load (this module is imported from App.tsx) so the
// task exists whenever Android revives the JS runtime for the fg service.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  ({ data, error }) => {
    if (error || !data?.locations) return Promise.resolve();
    handleFixes(data.locations);
    return Promise.resolve();
  },
);

/**
 * Resolve once the app is in the foreground (or immediately if it already is).
 *
 * Starting a location foreground service (`startLocationUpdatesAsync` with
 * `foregroundService`) calls `Context.startForegroundService()` natively. On
 * Android 12+ — and enforced strictly on Android 15/16 — doing that while the
 * app is in the background throws `ForegroundServiceStartNotAllowedException`,
 * a native crash JS cannot catch. The "Allow all the time" grant routes the
 * user through the system Settings screen, so when
 * `requestBackgroundPermissionsAsync()` resolves the app may still be
 * transitioning back to the foreground. Wait for `active` before starting.
 */
function waitForForeground(timeoutMs = 10_000): Promise<boolean> {
  if (AppState.currentState === "active") return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      sub.remove();
      clearTimeout(timer);
      resolve(ok);
    };
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") finish(true);
    });
    // Give up rather than hang forever; caller falls back to foreground-only.
    const timer = setTimeout(
      () => finish(AppState.currentState === "active"),
      timeoutMs,
    );
  });
}

async function stopLocationUpdates() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // already stopped / task not registered — fine
  }
}

// ---------------------------------------------------------------------------
// Public lifecycle
// ---------------------------------------------------------------------------

export interface StartResult {
  started: boolean;
  /** False when only foreground ("while in use") permission was granted. */
  background: boolean;
  error?: string;
}

/**
 * UI callbacks for the two-step Android background-permission flow (A6). Both
 * are optional — omitting them preserves the old straight-through behaviour
 * (ask foreground, then background, no explainer). The screen supplies these
 * so the human-facing copy lives in the UI while liveSession stays the single
 * owner of the permission *sequence* (and thus the R7 privacy invariant).
 */
export interface StartHooks {
  /**
   * Shown after foreground is granted but before the OS background prompt.
   * Resolve `true` to proceed to the system dialog, `false` to stay
   * foreground-only (user shows as "sharing off" when backgrounded).
   */
  explainBackground?: () => Promise<boolean>;
  /**
   * Shown when Android will no longer surface the runtime dialog (background
   * denied with `canAskAgain === false`) — the only way left to grant "Allow
   * all the time" is Settings. Resolve `true` to deep-link there.
   */
  offerSettings?: () => Promise<boolean>;
}

/**
 * Start sharing into `run`. Caller must ensure run.state === "active" and
 * the member has joined (R7) — this function double-checks and refuses
 * otherwise.
 */
export async function startLiveSession(
  run: Run,
  token: string,
  selfId: string,
  hooks?: StartHooks,
): Promise<StartResult> {
  if (run.state !== "active") {
    return { started: false, background: false, error: "Run is not active" };
  }
  const joined = run.attendees.some(
    (a) => a.memberId === selfId && a.status !== "left",
  );
  if (!joined) {
    return { started: false, background: false, error: "Not joined" };
  }
  if (session?.runId === run.id) {
    return { started: true, background: session.usingBackgroundTask };
  }
  /**
   * Coalesce concurrent starts for the same run.
   *
   * The `session?.runId` guard above is not enough: RunDetail's effect can fire
   * twice in a row (the run object changes identity on RSVP, then again on the
   * refetch), and `session` is only assigned *after* the `await` below. Both
   * calls therefore saw `session === null`, both built a state, and both opened
   * a socket — the second overwrote `session` while the first's socket stayed
   * connected and kept sending. That is the pair of `ws connected` lines,
   * milliseconds apart for one member, in the server log.
   */
  if (starting && starting.runId === run.id) return starting.promise;
  const promise = beginSession(run, token, selfId, hooks);
  starting = { runId: run.id, promise };
  try {
    return await promise;
  } finally {
    if (starting?.promise === promise) starting = null;
  }
}

/** The actual start, serialised by `startLiveSession`'s in-flight guard. */
async function beginSession(
  run: Run,
  token: string,
  selfId: string,
  hooks?: StartHooks,
): Promise<StartResult> {
  // One live run at a time.
  await stopLiveSession();

  const s: SessionState = {
    runId: run.id,
    token,
    selfId,
    meetup: { lat: run.meetup.lat, lng: run.meetup.lng },
    destination: run.destination
      ? { lat: run.destination.lat, lng: run.destination.lng }
      : null,
    phase: run.destination && run.phase === "driving" ? "driving" : "gathering",
    socket: null,
    connected: false,
    reconnectAttempt: 0,
    reconnectTimer: null,
    stopping: false,
    lastSent: null,
    pending: null,
    newestFixTs: 0,
    recent: [],
    lastEtaSentAt: 0,
    arrived: run.attendees.some(
      (a) => a.memberId === selfId && a.status === "arrived",
    ),
    atDestination: run.attendees.some(
      (a) => a.memberId === selfId && a.atDestination === true,
    ),
    fgWatcher: null,
    usingBackgroundTask: false,
    lastSnapshotCacheAt: 0,
    socketGen: 0,
    // 0 until a frame actually arrives, so "never" stays an honest answer.
    lastInboundAt: 0,
    watchdog: null,
  };
  session = s;
  openSocket(s);
  startWatchdog(s);
  startAppStateWatch();

  diag.locationMode = "not started";
  diag.lastLocationError = null;
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) {
      diag.locationPermission = "denied";
      emit({ kind: "sharing", sharing: false });
      return {
        started: false,
        background: false,
        error: "Location permission denied",
      };
    }
    diag.locationPermission = "whileInUse";

    // Two-step background flow (A6). Foreground is enough to *start* sharing;
    // background is what keeps it alive with the screen off. We only reach for
    // it after an in-app explanation, and fall back to a Settings deep-link
    // when Android will no longer show the runtime dialog.
    let bg = await Location.getBackgroundPermissionsAsync();
    if (!bg.granted) {
      const proceed = hooks?.explainBackground
        ? await hooks.explainBackground()
        : true;
      if (proceed) {
        bg = await Location.requestBackgroundPermissionsAsync();
        // Android 11+: once "Allow all the time" is refused the OS stops
        // re-prompting — only Settings can grant it now.
        if (!bg.granted && !bg.canAskAgain && hooks?.offerSettings) {
          const goToSettings = await hooks.offerSettings();
          if (goToSettings) {
            try {
              await Linking.openSettings();
            } catch {
              // no-op: user can still open settings by hand
            }
          }
          // Re-read in case they granted it and came straight back; if not,
          // we degrade to foreground-only and the next start will upgrade.
          bg = await Location.getBackgroundPermissionsAsync();
        }
      }
    }

    // Only start the foreground service while the app is actually foreground
    // (see waitForForeground) — starting it during the post-Settings
    // background transition crashes natively on Android 12+.
    if (bg.granted && (await waitForForeground())) {
      diag.locationPermission = "always";
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 0,
        foregroundService: {
          notificationTitle: "Runs — sharing location",
          // Name the run so the persistent notification doubles as the R7
          // privacy indicator: at a glance you know exactly what you're
          // sharing into.
          notificationBody: `Your position is visible to "${run.name}" while it is active.`,
          killServiceOnDestroy: true,
        },
      });
      s.usingBackgroundTask = true;
      diag.locationMode = "background service";
      if (Platform.OS === "android") {
        // The service alone is not enough on Android. expo-location hands
        // every fix from it to JS through JobScheduler, and Samsung (One UI)
        // defers those jobs hard — in testing, 2 fixes in over a minute
        // instead of one every 5 s. A direct watcher gets the same fixes
        // with no scheduler in between, and keeps working with the screen
        // off because the foreground service keeps this process alive. The
        // service stays for exactly that reason; duplicates are dropped by
        // timestamp in handleFixes.
        s.fgWatcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 0,
          },
          (fix) => handleFixes([fix]),
        );
        diag.locationMode = "background service + live watcher";
      }
    } else {
      // Foreground-only fallback: works while the app is open.
      s.fgWatcher = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 0,
        },
        (fix) => handleFixes([fix]),
      );
      diag.locationMode = "foreground only";
    }
    // A stop that landed while we awaited the watcher found nothing to remove.
    if (s.stopping && s.fgWatcher) {
      s.fgWatcher.remove();
      s.fgWatcher = null;
    }
    void seedFromLastKnown();
    emit({ kind: "sharing", sharing: true });
    return { started: true, background: s.usingBackgroundTask };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start location";
    diag.lastLocationError = message;
    emit({ kind: "sharing", sharing: false });
    return { started: false, background: false, error: message };
  }
}

/**
 * Put a dot on the map now, instead of after the first GPS lock.
 *
 * `Accuracy.High` asks Android for GPS, and GPS does not answer instantly —
 * outdoors it is tens of seconds, indoors or in a carpark it may be never.
 * Until then the map said "Finding your position…" and the board said "No
 * signal yet", which is indistinguishable from the app being broken. The OS
 * already holds a recent fix; using it costs nothing and is the same
 * lat/lng/ts we would have sent anyway.
 *
 * Capped at two minutes and 200 m: older or vaguer than that and a stale dot
 * in the wrong town would be worse than an honest empty map. If the real
 * watcher beats it, the cadence check drops this one on age.
 */
async function seedFromLastKnown(): Promise<void> {
  try {
    const last = await Location.getLastKnownPositionAsync({
      maxAge: 120_000,
      requiredAccuracy: 200,
    });
    if (last) handleFixes([last]);
  } catch {
    // No cached fix, or the provider refused — the watcher is still running.
  }
}

/** Hard stop: background task, watcher, socket — idempotent (R7). */
export async function stopLiveSession(): Promise<void> {
  const s = session;
  if (!s) {
    // Belt and braces: make sure no orphaned task or listener keeps running.
    stopAppStateWatch();
    await stopLocationUpdates();
    return;
  }
  session = null;
  s.stopping = true;
  stopWatchdog(s);
  stopAppStateWatch();
  if (s.reconnectTimer) {
    clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
  }
  if (s.fgWatcher) {
    s.fgWatcher.remove();
    s.fgWatcher = null;
  }
  await stopLocationUpdates();
  if (s.socket) {
    try {
      s.socket.close();
    } catch {
      // already closed
    }
    s.socket = null;
  }
  if (s.connected) emit({ kind: "connection", connected: false });
  emit({ kind: "sharing", sharing: false });
}
