import { describe, expect, it } from "vitest";

import type { Run } from "../../api/types";
import {
  currentLeg,
  isAtLegTarget,
  legCounts,
  legTarget,
  runPhase,
  targetForMember,
} from "../leg";

const MEETUP = { lat: 1.35, lng: 103.82, label: "Kranji Carpark" };
const DESTINATION = { lat: 1.55, lng: 104.26, label: "Desaru Coast" };

const twoLeg = {
  meetup: MEETUP,
  destination: DESTINATION,
  phase: "gathering",
} as Pick<Run, "meetup" | "destination" | "phase">;

const oneLeg = {
  meetup: MEETUP,
  destination: null,
  phase: "gathering",
} as Pick<Run, "meetup" | "destination" | "phase">;

const driving = { ...twoLeg, phase: "driving" as const };

const rsvped = { status: "rsvped" as const, atDestination: false };
const arrived = { status: "arrived" as const, atDestination: false };
const finished = { status: "arrived" as const, atDestination: true };

describe("runPhase", () => {
  it("is gathering for a run with nowhere to go after the meetup", () => {
    expect(runPhase(oneLeg)).toBe("gathering");
    // Even if a server somehow says otherwise.
    expect(runPhase({ ...oneLeg, phase: "driving" })).toBe("gathering");
  });

  it("defaults to gathering for a run cached before R8 existed", () => {
    const stale = { destination: DESTINATION } as Pick<Run, "phase" | "destination">;
    expect(runPhase(stale)).toBe("gathering");
    expect(runPhase(null)).toBe("gathering");
  });

  it("reports driving once the group has left", () => {
    expect(runPhase(driving)).toBe("driving");
  });
});

describe("currentLeg", () => {
  it("is the meetup while I have not checked in — whatever the group is doing", () => {
    expect(currentLeg(twoLeg, rsvped)).toBe("meetup");
    // The convoy has left without me. I am still driving to the meetup.
    expect(currentLeg(driving, rsvped)).toBe("meetup");
  });

  it("stays on the meetup after I check in, until the group moves off", () => {
    expect(currentLeg(twoLeg, arrived)).toBe("meetup");
  });

  it("switches to the destination once I have checked in and the group has left", () => {
    expect(currentLeg(driving, arrived)).toBe("destination");
  });

  it("is the destination for anyone already there, however they got there", () => {
    expect(currentLeg(driving, finished)).toBe("destination");
    // Skipped the meetup entirely and drove straight to the end.
    expect(currentLeg(twoLeg, { status: "rsvped", atDestination: true })).toBe("destination");
  });

  it("is always the meetup on a run with no destination", () => {
    expect(currentLeg(oneLeg, arrived)).toBe("meetup");
    expect(currentLeg(oneLeg, rsvped)).toBe("meetup");
  });

  it("copes with an unknown member and a missing run", () => {
    expect(currentLeg(twoLeg, null)).toBe("meetup");
    expect(currentLeg(null, arrived)).toBe("meetup");
  });
});

describe("legTarget / targetForMember", () => {
  it("resolves each leg to a real place", () => {
    expect(legTarget(twoLeg, "meetup")).toEqual(MEETUP);
    expect(legTarget(twoLeg, "destination")).toEqual(DESTINATION);
  });

  it("falls back to the meetup when a run has no destination", () => {
    expect(legTarget(oneLeg, "destination")).toEqual(MEETUP);
  });

  it("gives a member the place they should be navigating to", () => {
    // This is the bug the live map had: it pointed at the destination from the
    // moment the run went active, before anyone had reached the meetup.
    expect(targetForMember(driving, rsvped)).toEqual(MEETUP);
    expect(targetForMember(driving, arrived)).toEqual(DESTINATION);
  });
});

describe("isAtLegTarget", () => {
  it("is true at the meetup on leg one, and at the destination on leg two", () => {
    expect(isAtLegTarget(twoLeg, arrived)).toBe(true);
    expect(isAtLegTarget(twoLeg, rsvped)).toBe(false);
    expect(isAtLegTarget(driving, arrived)).toBe(false); // checked in, now driving
    expect(isAtLegTarget(driving, finished)).toBe(true);
  });

  it("is false for someone who is not on the run", () => {
    expect(isAtLegTarget(twoLeg, null)).toBe(false);
  });
});

describe("legCounts", () => {
  const crew = [
    { status: "arrived" as const, atDestination: true },
    { status: "arrived" as const, atDestination: false },
    { status: "rsvped" as const, atDestination: false },
    { status: "left" as const, atDestination: false },
  ];

  it("counts check-ins at the meetup, ignoring members who left the run", () => {
    expect(legCounts(crew, "meetup")).toEqual({ there: 2, total: 3 });
  });

  it("counts arrivals at the destination on the second leg", () => {
    expect(legCounts(crew, "destination")).toEqual({ there: 1, total: 3 });
  });

  it("treats a missing atDestination (data from before R8) as not there", () => {
    expect(legCounts([{ status: "arrived" }], "destination")).toEqual({ there: 0, total: 1 });
  });

  it("is zero-safe for an empty run", () => {
    expect(legCounts([], "meetup")).toEqual({ there: 0, total: 0 });
  });
});
