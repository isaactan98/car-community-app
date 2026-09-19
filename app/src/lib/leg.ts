/**
 * Which leg of the run am I on? (R8) Pure module — unit tested.
 *
 * A run is two legs: everyone converges on the meetup, then the group drives
 * to the destination. The app used to model only the first, which is why it
 * announced "arrived" at the meetup and then went quiet — and why the live
 * map's Waze button pointed at the destination from the moment the run went
 * active, before anyone had reached the meetup at all.
 *
 * The leg is per-member, not per-run, and that distinction is the whole point:
 * the group's `phase` can be `driving` while a straggler is still 20 km from
 * the meetup. Their target, their ETA and their "car ahead" bearing must all
 * stay on the meetup until they get there.
 *
 * Everything here tolerates fields that are absent, because a run cached by a
 * build from before R8 has neither `phase` nor `atDestination`
 * (docs/CONTRACT.md).
 */
import type { AttendeeStatus, Place, Run, RunPhase } from "../api/types";

export type Leg = "meetup" | "destination";

/** What a member's own progress looks like, from a snapshot row or attendee. */
export interface LegMember {
  status: AttendeeStatus;
  atDestination?: boolean;
}

/** The group's leg, defaulting safely for data written before R8. */
export function runPhase(run: Pick<Run, "phase" | "destination"> | null): RunPhase {
  if (!run?.destination) return "gathering"; // one-leg run: there is nowhere else to be
  return run.phase === "driving" ? "driving" : "gathering";
}

/**
 * The leg this member is on.
 *
 * Reaching the destination keeps you on the destination leg rather than
 * returning null: you are there, and "there" is the destination. Callers that
 * need to distinguish "heading for it" from "at it" read `atDestination`.
 */
export function currentLeg(
  run: Pick<Run, "phase" | "destination"> | null,
  member: LegMember | null | undefined,
): Leg {
  if (!run?.destination) return "meetup";
  if (member?.atDestination) return "destination";
  // Not checked in at the meetup yet → still driving to it, whatever the rest
  // of the convoy is doing.
  if (!member || member.status !== "arrived") return "meetup";
  return runPhase(run) === "driving" ? "destination" : "meetup";
}

/** Where that leg points. Always a real place — never null. */
export function legTarget(run: Pick<Run, "meetup" | "destination">, leg: Leg): Place {
  return leg === "destination" && run.destination ? run.destination : run.meetup;
}

/** Shorthand: the place this member should be navigating to right now. */
export function targetForMember(
  run: Pick<Run, "meetup" | "destination" | "phase">,
  member: LegMember | null | undefined,
): Place {
  return legTarget(run, currentLeg(run, member));
}

/**
 * Has this member finished the leg they are on? Used for the arrival moment —
 * the banner and haptic that say, in so many words, "you're here, and here is
 * what happens next".
 */
export function isAtLegTarget(
  run: Pick<Run, "phase" | "destination"> | null,
  member: LegMember | null | undefined,
): boolean {
  if (!member) return false;
  return currentLeg(run, member) === "destination"
    ? member.atDestination === true
    : member.status === "arrived";
}

export interface LegCounts {
  /** How many have reached this leg's target. */
  there: number;
  /** How many are on the run at all (people who left are not counted). */
  total: number;
}

/** "4/7 at the meetup" / "2/7 at Desaru" — whichever leg the group is on. */
export function legCounts(
  members: (LegMember & { status: AttendeeStatus })[],
  leg: Leg,
): LegCounts {
  const active = members.filter((m) => m.status !== "left");
  const there =
    leg === "destination"
      ? active.filter((m) => m.atDestination === true).length
      : active.filter((m) => m.status === "arrived").length;
  return { there, total: active.length };
}
