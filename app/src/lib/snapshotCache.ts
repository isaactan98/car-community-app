/**
 * Reducer for the live/cached view of a single run (R4 + R6 degraded mode).
 * Pure module — unit tested. Screens render exclusively from this state, so
 * a dead server simply means the state stops advancing (never a blank
 * screen or crash).
 */
import type {
  Run,
  RunState,
  ServerMessage,
  SnapshotMessage,
} from "../api/types";

export interface LiveRunState {
  run: Run | null;
  /** Latest snapshot (live from WS, or hydrated from cache). */
  snapshot: SnapshotMessage | null;
  /** Wall-clock ms when `snapshot` was received/saved. */
  snapshotAt: number | null;
  /** True while the WebSocket is open. */
  connected: boolean;
  /** True when the last REST fetch failed and we're showing cached data. */
  offline: boolean;
}

export const initialLiveRunState: LiveRunState = {
  run: null,
  snapshot: null,
  snapshotAt: null,
  connected: false,
  offline: false,
};

export type LiveRunAction =
  | { type: "run_loaded"; run: Run; fromCache: boolean }
  | { type: "run_fetch_failed" }
  | { type: "ws_connected" }
  | { type: "ws_disconnected" }
  | { type: "ws_message"; message: ServerMessage; receivedAt: number }
  | {
      type: "hydrate_cache";
      snapshot: SnapshotMessage | null;
      snapshotAt: number | null;
    };

function withRunState(run: Run | null, state: RunState): Run | null {
  if (run === null || run.state === state) return run;
  return { ...run, state };
}

export function liveRunReducer(
  state: LiveRunState,
  action: LiveRunAction,
): LiveRunState {
  switch (action.type) {
    case "run_loaded":
      return {
        ...state,
        run: action.run,
        offline: action.fromCache ? state.offline : false,
      };
    case "run_fetch_failed":
      return { ...state, offline: true };
    case "ws_connected":
      return { ...state, connected: true, offline: false };
    case "ws_disconnected":
      return { ...state, connected: false };
    case "hydrate_cache":
      // Never let stale cache clobber fresher live data.
      if (state.snapshot !== null) return state;
      return {
        ...state,
        snapshot: action.snapshot,
        snapshotAt: action.snapshot ? action.snapshotAt : null,
      };
    case "ws_message": {
      const { message, receivedAt } = action;
      switch (message.type) {
        case "snapshot":
          return {
            ...state,
            snapshot: message,
            snapshotAt: receivedAt,
            run: withRunState(state.run, message.runState),
          };
        case "member_arrived": {
          const next: LiveRunState = { ...state };
          if (state.snapshot) {
            next.snapshot = {
              ...state.snapshot,
              members: state.snapshot.members.map((m) =>
                m.memberId === message.memberId
                  ? { ...m, status: "arrived", etaSeconds: null }
                  : m,
              ),
            };
          }
          if (state.run) {
            next.run = {
              ...state.run,
              attendees: state.run.attendees.map((a) =>
                a.memberId === message.memberId
                  ? { ...a, status: "arrived" }
                  : a,
              ),
            };
          }
          return next;
        }
        case "run_state":
          return {
            ...state,
            run: withRunState(state.run, message.state),
            snapshot: state.snapshot
              ? { ...state.snapshot, runState: message.state }
              : null,
          };
        default:
          return state;
      }
    }
    default:
      return state;
  }
}

/** Arrival-board counts: "12/18 arrived" (attendees who left are excluded). */
export function arrivalCounts(run: Run | null): {
  arrived: number;
  total: number;
} {
  if (!run) return { arrived: 0, total: 0 };
  const active = run.attendees.filter((a) => a.status !== "left");
  return {
    arrived: active.filter((a) => a.status === "arrived").length,
    total: active.length,
  };
}
