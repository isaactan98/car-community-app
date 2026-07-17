import { describe, expect, it } from "vitest";

import {
  bearingDegrees,
  bearingDiff,
  distanceToCarAhead,
  formatDistance,
  haversineMeters,
} from "../geo";

describe("haversineMeters", () => {
  it("is zero for identical points", () => {
    const p = { lat: 1.35, lng: 103.82 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it("matches a known distance (JB CIQ → Tuas ~28 km)", () => {
    // Johor Bahru CIQ ↔ Tuas Checkpoint, roughly 27–29 km great-circle.
    const jb = { lat: 1.4623, lng: 103.7692 };
    const tuas = { lat: 1.3479, lng: 103.6365 };
    const d = haversineMeters(jb, tuas);
    expect(d).toBeGreaterThan(18_000);
    expect(d).toBeLessThan(30_000);
  });

  it("~111 km per degree of latitude", () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe("bearingDegrees", () => {
  it("north is 0", () => {
    expect(
      bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }),
    ).toBeCloseTo(0, 5);
  });
  it("east is 90", () => {
    expect(
      bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }),
    ).toBeCloseTo(90, 5);
  });
  it("south is 180", () => {
    expect(
      bearingDegrees({ lat: 1, lng: 0 }, { lat: 0, lng: 0 }),
    ).toBeCloseTo(180, 5);
  });
});

describe("bearingDiff", () => {
  it("wraps around 360", () => {
    expect(bearingDiff(350, 10)).toBe(20);
    expect(bearingDiff(10, 350)).toBe(20);
    expect(bearingDiff(0, 180)).toBe(180);
  });
});

describe("distanceToCarAhead", () => {
  const me = { lat: 1.4, lng: 103.7 };
  const target = { lat: 1.5, lng: 103.7 }; // due north

  it("picks the nearest participant ahead along the travel bearing", () => {
    const ahead = distanceToCarAhead(me, target, [
      {
        memberId: "far-ahead",
        displayName: "Far",
        position: { lat: 1.45, lng: 103.7 },
      },
      {
        memberId: "near-ahead",
        displayName: "Near",
        position: { lat: 1.41, lng: 103.7 },
      },
      {
        memberId: "behind",
        displayName: "Behind",
        position: { lat: 1.39, lng: 103.7 },
      },
    ]);
    expect(ahead?.memberId).toBe("near-ahead");
    expect(ahead!.distanceMeters).toBeGreaterThan(1000);
    expect(ahead!.distanceMeters).toBeLessThan(1300);
  });

  it("ignores cars behind or abeam", () => {
    expect(
      distanceToCarAhead(me, target, [
        {
          memberId: "behind",
          displayName: "B",
          position: { lat: 1.39, lng: 103.7 },
        },
        {
          memberId: "abeam",
          displayName: "A",
          // Slightly south of due east → bearing diff just over 90°.
          position: { lat: 1.3999, lng: 103.71 },
        },
      ]),
    ).toBeNull();
  });

  it("returns null with no other participants", () => {
    expect(distanceToCarAhead(me, target, [])).toBeNull();
  });
});

describe("formatDistance", () => {
  it("meters under 1 km", () => {
    expect(formatDistance(850.4)).toBe("850 m");
  });
  it("km with one decimal above 1 km", () => {
    expect(formatDistance(1234)).toBe("1.2 km");
  });
  it("dash for junk", () => {
    expect(formatDistance(Number.NaN)).toBe("—");
    expect(formatDistance(-5)).toBe("—");
  });
});
