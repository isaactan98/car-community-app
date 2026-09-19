/**
 * Reducer for the live/cached view of a single run (R4 + R6 degraded mode).
 * Pure module — unit tested. Screens render exclusively from this state, so
 * a dead server simply means the state stops advancing (never a blank
 * screen or crash).
 */
import type {
  Run,
  RunPhase,
  RunState,
  ServerMessage,
  SnapshotMessage,
} from "../api/types";
import { currentLeg, legCounts, runPhase, type Leg, type LegCounts } from "./leg";

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

function withRunPhase(run: Run | null, phase: RunPhase): Run | null {
  if (run === null || run.phase === phase) return run;
  return { ...run, phase };
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
            run: withRunPhase(
              withRunState(state.run, message.runState),
              // A server from before R8 sends no runPhase; treat that as the
              // one-leg world it came from rather than crashing the board.
              message.runPhase ?? "gathering",
            ),
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
        case "member_at_destination": {
          const next: LiveRunState = { ...state };
          if (state.snapshot) {
            next.snapshot = {
              ...state.snapshot,
              members: state.snapshot.members.map((m) =>
                m.memberId === message.memberId
                  ? { ...m, atDestination: true, etaSeconds: null }
                  : m,
              ),
            };
          }
          if (state.run) {
            next.run = {
              ...state.run,
              attendees: state.run.attendees.map((a) =>
                a.memberId === message.memberId ? { ...a, atDestination: true } : a,
              ),
            };
          }
          return next;
        }
        case "run_phase":
          return {
            ...state,
            run: withRunPhase(state.run, message.phase),
            snapshot: state.snapshot
              ? { ...state.snapshot, runPhase: message.phase }
              : null,
          };
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

/**
 * Arrival-board counts for the leg the run is actually on: "12/18 at the
 * meetup" while gathering, "12/18 at Desaru" once the group has left
 * (attendees who left the run are excluded from both).
 *
 * The leg here is the *group's*, not any one member's — this is the headline
 * tally, and it has to read the same on everybody's phone.
 */
export function runLegCounts(run: Run | null): LegCounts & { leg: Leg } {
  if (!run) return { leg: "meetup", there: 0, total: 0 };
  const leg: Leg = runPhase(run) === "driving" ? "destination" : "meetup";
  return { leg, ...legCounts(run.attendees, leg) };
}

/** The leg *this* member is on, straight from the cached run + snapshot. */
export function myLeg(state: LiveRunState, selfId: string): Leg {
  const fromSnapshot = state.snapshot?.members.find((m) => m.memberId === selfId);
  const fromRun = state.run?.attendees.find((a) => a.memberId === selfId);
  return currentLeg(state.run, fromSnapshot ?? fromRun ?? null);
}
