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
import { Linking } from "react-native";

import type {
  ClientMessage,
  Position,
  Run,
  ServerMessage,
  SnapshotMessage,
} from "../api/types";
import { ETA_SEND_INTERVAL_MS, WS_BASE } from "../config";
import { shouldSendPosition } from "../lib/cadence";
import { estimateEtaSeconds } from "../lib/eta";
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
  meetup: { lat: number; lng: number };
  socket: WebSocket | null;
  connected: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  stopping: boolean;
  /** Last position actually sent (cadence anchor). lat/lng/ts only. */
  lastSent: Position | null;
  /** Recent fixes for client-side ETA estimation. lat/lng/ts only. */
  recent: Position[];
  lastEtaSentAt: number;
  /** Own arrival status — stop sending `eta` once arrived. */
  arrived: boolean;
  /** Foreground-only fallback watcher when background permission denied. */
  fgWatcher: Location.LocationSubscription | null;
  usingBackgroundTask: boolean;
  lastSnapshotCacheAt: number;
}

let session: SessionState | null = null;
const listeners = new Set<Listener>();

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
  const ws = new WebSocket(wsUrl(s.token, s.runId));
  s.socket = ws;

  ws.onopen = () => {
    if (session !== s || s.stopping) return;
    s.connected = true;
    s.reconnectAttempt = 0;
    emit({ kind: "connection", connected: true });
  };

  ws.onmessage = (evt) => {
    if (session !== s) return;
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
    } else if (message.type === "run_state" && message.state === "ended") {
      // Hard privacy stop: run over → stop sharing immediately (R7).
      emit({ kind: "message", message, receivedAt });
      void stopLiveSession();
      return;
    }
    emit({ kind: "message", message, receivedAt });
  };

  ws.onclose = () => {
    if (session !== s) return;
    s.socket = null;
    if (s.connected) {
      s.connected = false;
      emit({ kind: "connection", connected: false });
    }
    scheduleReconnect(s);
  };

  ws.onerror = () => {
    // onclose follows; nothing to do (and nothing gets logged — no payloads).
  };
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

function handleSnapshot(
  s: SessionState,
  snapshot: SnapshotMessage,
  receivedAt: number,
) {
  const self = snapshot.members.find((m) => m.memberId === s.selfId);
  if (self?.status === "arrived") s.arrived = true;
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

    // Keep a short buffer for ETA math.
    s.recent.push(position);
    if (s.recent.length > 30) s.recent.splice(0, s.recent.length - 30);

    if (!shouldSendPosition(s.lastSent, position)) continue;
    const sent = sendMessage(s, {
      type: "position",
      lat: position.lat,
      lng: position.lng,
      ts: position.ts,
    });
    if (sent) s.lastSent = position;
  }

  // Client-computed ETA to the meetup, pre-arrival only (contract `eta`).
  const now = Date.now();
  if (!s.arrived && now - s.lastEtaSentAt >= ETA_SEND_INTERVAL_MS) {
    const etaSeconds = estimateEtaSeconds(s.recent, s.meetup);
    if (etaSeconds !== null) {
      if (sendMessage(s, { type: "eta", etaSeconds })) {
        s.lastEtaSentAt = now;
      }
    }
  }
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
  // One live run at a time.
  await stopLiveSession();

  const s: SessionState = {
    runId: run.id,
    token,
    selfId,
    meetup: { lat: run.meetup.lat, lng: run.meetup.lng },
    socket: null,
    connected: false,
    reconnectAttempt: 0,
    reconnectTimer: null,
    stopping: false,
    lastSent: null,
    recent: [],
    lastEtaSentAt: 0,
    arrived: run.attendees.some(
      (a) => a.memberId === selfId && a.status === "arrived",
    ),
    fgWatcher: null,
    usingBackgroundTask: false,
    lastSnapshotCacheAt: 0,
  };
  session = s;
  openSocket(s);

  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) {
      emit({ kind: "sharing", sharing: false });
      return {
        started: false,
        background: false,
        error: "Location permission denied",
      };
    }

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

    if (bg.granted) {
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
    }
    emit({ kind: "sharing", sharing: true });
    return { started: true, background: s.usingBackgroundTask };
  } catch (err) {
    emit({ kind: "sharing", sharing: false });
    return {
      started: false,
      background: false,
      error: err instanceof Error ? err.message : "Failed to start location",
    };
  }
}

/** Hard stop: background task, watcher, socket — idempotent (R7). */
export async function stopLiveSession(): Promise<void> {
  const s = session;
  if (!s) {
    // Belt and braces: make sure no orphaned task keeps running.
    await stopLocationUpdates();
    return;
  }
  session = null;
  s.stopping = true;
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
