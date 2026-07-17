import { describe, expect, it } from "vitest";

import type { Run, SnapshotMessage } from "../../api/types";
import {
  arrivalCounts,
  initialLiveRunState,
  liveRunReducer,
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
  inviteDeepLink: "runs://join?code=abc",
  attendees: [
    { memberId: "m1", displayName: "Isaac", carName: "MX-5", status: "arrived" },
    { memberId: "m2", displayName: "Ben", carName: null, status: "rsvped" },
    { memberId: "m3", displayName: "Gone", carName: null, status: "left" },
  ],
};

const snapshot: SnapshotMessage = {
  type: "snapshot",
  runState: "active",
  members: [
    {
      memberId: "m1",
      displayName: "Isaac",
      carName: "MX-5",
      status: "arrived",
      lastPosition: { lat: 1.4, lng: 103.7, ts: 1000 },
      etaSeconds: null,
    },
    {
      memberId: "m2",
      displayName: "Ben",
      carName: null,
      status: "rsvped",
      lastPosition: { lat: 1.39, lng: 103.69, ts: 900 },
      etaSeconds: 600,
    },
  ],
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

describe("arrivalCounts", () => {
  it('counts "12/18"-style totals, excluding members who left', () => {
    expect(arrivalCounts(run)).toEqual({ arrived: 1, total: 2 });
  });
  it("zero for null run", () => {
    expect(arrivalCounts(null)).toEqual({ arrived: 0, total: 0 });
  });
});
