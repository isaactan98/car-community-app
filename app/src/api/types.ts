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

export interface Attendee {
  memberId: string;
  displayName: string;
  carName: string | null;
  status: AttendeeStatus;
}

export interface Run {
  id: string;
  name: string;
  creatorId: string;
  meetup: Place;
  destination: Place | null;
  startsAt: string; // ISO-8601
  state: RunState;
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
  lastPosition: Position | null;
  etaSeconds: number | null;
}

export interface SnapshotMessage {
  type: "snapshot";
  runState: RunState;
  members: SnapshotMember[];
}

export interface MemberArrivedMessage {
  type: "member_arrived";
  memberId: string;
}

export interface RunStateMessage {
  type: "run_state";
  state: "active" | "ended";
}

export type ServerMessage =
  | SnapshotMessage
  | MemberArrivedMessage
  | RunStateMessage;

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
