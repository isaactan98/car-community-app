/**
 * Types mirroring docs/CONTRACT.md exactly. Do not add fields the contract
 * does not define — especially anything speed-shaped.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Position = lat/lng/ts ONLY (hard constraint: never speed). */
export interface Position extends LatLng {
  /** epoch millis */
  ts: number;
}

export interface Place extends LatLng {
  label: string;
}

export interface Car {
  id: string;
  name: string;
}

export interface Member {
  id: string;
  displayName: string;
}

export interface Me extends Member {
  cars: Car[];
}

export type RunState = "upcoming" | "active" | "ended";
export type AttendeeStatus = "rsvped" | "arrived" | "left";

/**
 * Which leg the *group* is on: converging on the meetup, or driving to the
 * destination. Server-derived and one-way (docs/CONTRACT.md). A run without a
 * destination is `gathering` for its whole life.
 *
 * A member's own leg is not this — see lib/leg.ts. Somebody still on the way to
 * the meetup is on leg 1 no matter what the rest of the convoy is doing.
 */
export type RunPhase = "gathering" | "driving";

export interface Attendee {
  memberId: string;
  displayName: string;
  carName: string | null;
  /** Checked in at the MEETUP. Reaching the destination is `atDestination`. */
  status: AttendeeStatus;
  atDestination: boolean;
}

export interface Run {
  id: string;
  name: string;
  creatorId: string;
  meetup: Place;
  destination: Place | null;
  startsAt: string; // ISO-8601
  state: RunState;
  phase: RunPhase;
  inviteDeepLink: string;
  attendees: Attendee[];
}

export interface JoinResponse {
  token: string;
  member: Member;
}

// ---- WebSocket messages (docs/CONTRACT.md) ----

export interface SnapshotMember {
  memberId: string;
  displayName: string;
  carName: string | null;
  status: AttendeeStatus;
  atDestination: boolean;
  lastPosition: Position | null;
  etaSeconds: number | null;
}

export interface SnapshotMessage {
  type: "snapshot";
  runState: RunState;
  runPhase: RunPhase;
  members: SnapshotMember[];
}

/** Reached the meetup. */
export interface MemberArrivedMessage {
  type: "member_arrived";
  memberId: string;
}

/** Reached the destination. */
export interface MemberAtDestinationMessage {
  type: "member_at_destination";
  memberId: string;
}

export interface RunPhaseMessage {
  type: "run_phase";
  phase: RunPhase;
}

export interface RunStateMessage {
  type: "run_state";
  state: "active" | "ended";
}

export type ServerMessage =
  | SnapshotMessage
  | MemberArrivedMessage
  | MemberAtDestinationMessage
  | RunPhaseMessage
  | RunStateMessage;

/** A place returned by `GET /places/search` (R9). */
export interface PlaceResult {
  label: string;
  detail: string;
  lat: number;
  lng: number;
}

/** Client → server. Exactly these keys; extra keys (esp. speed) are rejected. */
export interface PositionMessage {
  type: "position";
  lat: number;
  lng: number;
  ts: number;
}

export interface EtaMessage {
  type: "eta";
  etaSeconds: number;
}

export type ClientMessage = PositionMessage | EtaMessage;
