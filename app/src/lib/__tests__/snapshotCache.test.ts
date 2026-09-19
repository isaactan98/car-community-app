import { describe, expect, it } from "vitest";

import type { Run, SnapshotMessage } from "../../api/types";
import {
  initialLiveRunState,
  liveRunReducer,
  runLegCounts,
  type LiveRunState,
} from "../snapshotCache";

const run: Run = {
  id: "r1",
  name: "Sunday run",
  creatorId: "m1",
  meetup: { lat: 1.4, lng: 103.7, label: "Caltex" },
  destination: null,
  startsAt: "2026-07-19T08:00:00.000Z",
  state: "active",
  phase: "gathering",
  inviteDeepLink: "runs://join?code=abc",
  attendees: [
    { memberId: "m1", displayName: "Isaac", carName: "MX-5", status: "arrived", atDestination: false },
    { memberId: "m2", displayName: "Ben", carName: null, status: "rsvped", atDestination: false },
    { memberId: "m3", displayName: "Gone", carName: null, status: "left", atDestination: false },
  ],
};

const snapshot: SnapshotMessage = {
  type: "snapshot",
  runState: "active",
  runPhase: "gathering",
  members: [
    {
      memberId: "m1",
      displayName: "Isaac",
      carName: "MX-5",
      status: "arrived",
      atDestination: false,
      lastPosition: { lat: 1.4, lng: 103.7, ts: 1000 },
      etaSeconds: null,
    },
    {
      memberId: "m2",
      displayName: "Ben",
      carName: null,
      status: "rsvped",
      atDestination: false,
      lastPosition: { lat: 1.39, lng: 103.69, ts: 900 },
      etaSeconds: 600,
    },
  ],
};

/** The same run, but with somewhere to go after the meetup. */
const twoLegRun: Run = {
  ...run,
  destination: { lat: 1.5, lng: 103.9, label: "Desaru Coast" },
};

function loaded(): LiveRunState {
  return liveRunReducer(initialLiveRunState, {
    type: "run_loaded",
    run,
    fromCache: false,
  });
}

describe("liveRunReducer", () => {
  it("stores snapshots with their receive time", () => {
    const s = liveRunReducer(loaded(), {
      type: "ws_message",
      message: snapshot,
      receivedAt: 123456,
    });
    expect(s.snapshot).toEqual(snapshot);
    expect(s.snapshotAt).toBe(123456);
  });

  it("snapshot runState updates the run object", () => {
    const s = liveRunReducer(loaded(), {
      type: "ws_message",
      message: { ...snapshot, runState: "ended" },
      receivedAt: 1,
    });
    expect(s.run?.state).toBe("ended");
  });

  it("member_arrived flips status in both snapshot and run", () => {
    let s = liveRunReducer(loaded(), {
      type: "ws_message",
      message: snapshot,
      receivedAt: 1,
    });
    s = liveRunReducer(s, {
      type: "ws_message",
      message: { type: "member_arrived", memberId: "m2" },
      receivedAt: 2,
    });
    expect(s.snapshot?.members.find((m) => m.memberId === "m2")?.status).toBe(
      "arrived",
    );
    expect(
      s.snapshot?.members.find((m) => m.memberId === "m2")?.etaSeconds,
    ).toBeNull();
    expect(s.run?.attendees.find((a) => a.memberId === "m2")?.status).toBe(
      "arrived",
    );
  });

  it("run_state ended propagates", () => {
    let s = liveRunReducer(loaded(), {
      type: "ws_message",
      message: snapshot,
      receivedAt: 1,
    });
    s = liveRunReducer(s, {
      type: "ws_message",
      message: { type: "run_state", state: "ended" },
      receivedAt: 2,
    });
    expect(s.run?.state).toBe("ended");
    expect(s.snapshot?.runState).toBe("ended");
  });

  it("hydrate_cache never clobbers a live snapshot (R6)", () => {
    let s = liveRunReducer(loaded(), {
      type: "ws_message",
      message: snapshot,
      receivedAt: 500,
    });
    const staleSnap: SnapshotMessage = {
      ...snapshot,
      members: [],
    };
    s = liveRunReducer(s, {
      type: "hydrate_cache",
      snapshot: staleSnap,
      snapshotAt: 100,
    });
    expect(s.snapshot?.members.length).toBe(2);
    expect(s.snapshotAt).toBe(500);
  });

  it("hydrate_cache fills an empty state (offline open)", () => {
    const s = liveRunReducer(loaded(), {
      type: "hydrate_cache",
      snapshot,
      snapshotAt: 100,
    });
    expect(s.snapshot).toEqual(snapshot);
    expect(s.snapshotAt).toBe(100);
  });

  it("fetch failure marks offline; a later success clears it", () => {
    let s = liveRunReducer(initialLiveRunState, { type: "run_fetch_failed" });
    expect(s.offline).toBe(true);
    s = liveRunReducer(s, { type: "run_loaded", run, fromCache: false });
    expect(s.offline).toBe(false);
  });

  it("run_loaded fromCache keeps the offline flag", () => {
    let s = liveRunReducer(initialLiveRunState, { type: "run_fetch_failed" });
    s = liveRunReducer(s, { type: "run_loaded", run, fromCache: true });
    expect(s.offline).toBe(true);
  });
});

describe("runLegCounts", () => {
  it('counts "12/18"-style totals for the meetup, excluding members who left', () => {
    expect(runLegCounts(run)).toEqual({ leg: "meetup", there: 1, total: 2 });
  });

  it("counts arrivals at the destination once the group has driven off", () => {
    const driving: Run = {
      ...twoLegRun,
      phase: "driving",
      attendees: twoLegRun.attendees.map((a) =>
        a.memberId === "m2" ? { ...a, status: "arrived" as const, atDestination: true } : a,
      ),
    };
    // m1 checked in at the meetup but has not reached the destination; m2 has.
    expect(runLegCounts(driving)).toEqual({ leg: "destination", there: 1, total: 2 });
  });

  it("ignores a driving phase on a run with nowhere to drive to", () => {
    expect(runLegCounts({ ...run, phase: "driving" })).toEqual({
      leg: "meetup",
      there: 1,
      total: 2,
    });
  });

  it("zero for null run", () => {
    expect(runLegCounts(null)).toEqual({ leg: "meetup", there: 0, total: 0 });
  });
});

describe("liveRunReducer — the destination leg (R8)", () => {
  function twoLegState(): LiveRunState {
    let s = liveRunReducer(initialLiveRunState, {
      type: "run_loaded",
      run: twoLegRun,
      fromCache: false,
    });
    s = liveRunReducer(s, { type: "ws_message", message: snapshot, receivedAt: 5000 });
    return s;
  }

  it("run_phase moves both the run and the live snapshot onto the second leg", () => {
    const s = liveRunReducer(twoLegState(), {
      type: "ws_message",
      message: { type: "run_phase", phase: "driving" },
      receivedAt: 6000,
    });
    expect(s.run?.phase).toBe("driving");
    expect(s.snapshot?.runPhase).toBe("driving");
  });

  it("member_at_destination marks the member and clears their ETA", () => {
    const s = liveRunReducer(twoLegState(), {
      type: "ws_message",
      message: { type: "member_at_destination", memberId: "m2" },
      receivedAt: 6000,
    });
    const member = s.snapshot?.members.find((m) => m.memberId === "m2");
    expect(member).toMatchObject({ atDestination: true, etaSeconds: null });
    expect(s.run?.attendees.find((a) => a.memberId === "m2")?.atDestination).toBe(true);
    // Nobody else is touched.
    expect(s.snapshot?.members.find((m) => m.memberId === "m1")?.atDestination).toBe(false);
  });

  it("a snapshot carries the phase across to the run object", () => {
    const s = liveRunReducer(twoLegState(), {
      type: "ws_message",
      message: { ...snapshot, runPhase: "driving" },
      receivedAt: 7000,
    });
    expect(s.run?.phase).toBe("driving");
  });

  it("treats a snapshot from a server that predates R8 as gathering", () => {
    const { runPhase: _dropped, ...old } = snapshot;
    const s = liveRunReducer(twoLegState(), {
      type: "ws_message",
      message: old as SnapshotMessage,
      receivedAt: 7000,
    });
    expect(s.run?.phase).toBe("gathering");
  });
});
