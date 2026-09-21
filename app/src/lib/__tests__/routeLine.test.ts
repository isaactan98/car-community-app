import { describe, expect, it } from "vitest";

import {
  directCoordinates,
  interpolate,
  parseRunRoute,
  routeFeature,
  routeLine,
} from "../routeLine";

const MEETUP = { lat: 1.4927, lng: 103.7414, label: "Gelang Patah R&R" };
const DEST = { lat: 1.3521, lng: 103.8198, label: "Kranji" };
/** Far enough that a screen-space straight line is visibly not a great circle. */
const KUANTAN = { lat: 3.8077, lng: 103.326, label: "Kuantan" };

const ROAD = {
  points: [
    { lat: 1.4927, lng: 103.7414 },
    { lat: 1.4402, lng: 103.7689 },
    { lat: 1.3521, lng: 103.8198 },
  ],
  distanceMeters: 24_310,
};

describe("routeLine", () => {
  it("draws the road geometry when the server has one", () => {
    const line = routeLine(MEETUP, DEST, ROAD)!;
    expect(line.kind).toBe("road");
    // GeoJSON is [lng, lat] — getting this backwards puts the run in Somalia.
    expect(line.coordinates[0]).toEqual([103.7414, 1.4927]);
    expect(line.coordinates).toHaveLength(3);
  });

  it("falls back to a direct line when the router gave nothing", () => {
    for (const route of [null, undefined, { points: [], distanceMeters: 0 }]) {
      expect(routeLine(MEETUP, DEST, route)?.kind).toBe("direct");
    }
  });

  it("treats a one-point route as no route — a point is not a line", () => {
    const line = routeLine(MEETUP, DEST, {
      points: [{ lat: 1.4927, lng: 103.7414 }],
      distanceMeters: 0,
    })!;
    expect(line.kind).toBe("direct");
  });

  it("draws nothing without a destination", () => {
    expect(routeLine(MEETUP, null, ROAD)).toBeNull();
    expect(routeLine(null, DEST, ROAD)).toBeNull();
  });

  it("draws nothing when both pins are the same spot", () => {
    expect(routeLine(MEETUP, { ...MEETUP }, null)).toBeNull();
  });

  it("still draws a road route between identical pins, if the router made one", () => {
    // A loop back to the start is a real drive; only the *fallback* is empty.
    const loop = routeLine(MEETUP, { ...MEETUP }, ROAD)!;
    expect(loop.kind).toBe("road");
  });
});

describe("directCoordinates", () => {
  it("keeps a JB-corridor hop to its two endpoints", () => {
    const coords = directCoordinates(MEETUP, DEST);
    expect(coords).toEqual([
      [103.7414, 1.4927],
      [103.8198, 1.3521],
    ]);
  });

  it("interpolates a long one so the drawn line follows the great circle", () => {
    const coords = directCoordinates(MEETUP, KUANTAN);
    expect(coords.length).toBeGreaterThan(2);
    expect(coords[0]).toEqual([103.7414, 1.4927]);
    expect(coords[coords.length - 1]![0]).toBeCloseTo(103.326, 6);
    expect(coords[coords.length - 1]![1]).toBeCloseTo(3.8077, 6);
  });

  it("walks monotonically from one end to the other", () => {
    const lats = directCoordinates(MEETUP, KUANTAN).map(([, lat]) => lat);
    for (let i = 1; i < lats.length; i += 1) {
      expect(lats[i]!).toBeGreaterThan(lats[i - 1]!);
    }
  });
});

describe("interpolate", () => {
  it("returns the endpoints at t = 0 and t = 1", () => {
    expect(interpolate(MEETUP, KUANTAN, 0).lat).toBeCloseTo(MEETUP.lat, 6);
    expect(interpolate(MEETUP, KUANTAN, 1).lng).toBeCloseTo(KUANTAN.lng, 6);
  });

  it("puts the midpoint between the two, near the planar mean at this scale", () => {
    const mid = interpolate(MEETUP, KUANTAN, 0.5);
    expect(mid.lat).toBeGreaterThan(MEETUP.lat);
    expect(mid.lat).toBeLessThan(KUANTAN.lat);
    expect(mid.lat).toBeCloseTo((MEETUP.lat + KUANTAN.lat) / 2, 2);
    expect(mid.lng).toBeCloseTo((MEETUP.lng + KUANTAN.lng) / 2, 2);
  });

  it("clamps t outside [0, 1] instead of extrapolating off the map", () => {
    expect(interpolate(MEETUP, KUANTAN, -3).lat).toBeCloseTo(MEETUP.lat, 6);
    expect(interpolate(MEETUP, KUANTAN, 42).lat).toBeCloseTo(KUANTAN.lat, 6);
  });

  it("survives coincident points without dividing by zero", () => {
    const p = interpolate(MEETUP, { ...MEETUP }, 0.5);
    expect(p.lat).toBe(MEETUP.lat);
    expect(p.lng).toBe(MEETUP.lng);
  });
});

describe("routeFeature", () => {
  it("wraps the line as GeoJSON a source can take directly", () => {
    const feature = routeFeature(routeLine(MEETUP, DEST, ROAD)!);
    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("LineString");
    expect(feature.properties).toEqual({ kind: "road" });
  });
});

describe("parseRunRoute", () => {
  it("reads a well-formed answer", () => {
    const route = parseRunRoute({ route: ROAD })!;
    expect(route.points).toHaveLength(3);
    expect(route.distanceMeters).toBe(24_310);
  });

  it("reads an old server, a null route, and junk as 'no route'", () => {
    expect(parseRunRoute(null)).toBeNull();
    expect(parseRunRoute({})).toBeNull();
    expect(parseRunRoute({ route: null })).toBeNull();
    expect(parseRunRoute({ route: { points: "nope" } })).toBeNull();
    expect(parseRunRoute({ route: { points: [] } })).toBeNull();
  });

  it("drops bad coordinates and rejects what is left if it cannot be a line", () => {
    expect(
      parseRunRoute({
        route: { points: [{ lat: 1.49, lng: 103.74 }, { lat: 999, lng: 103.8 }] },
      }),
    ).toBeNull();
  });

  it("defaults a missing or negative distance to zero", () => {
    expect(parseRunRoute({ route: { points: ROAD.points } })!.distanceMeters).toBe(0);
    expect(
      parseRunRoute({ route: { points: ROAD.points, distanceMeters: -5 } })!
        .distanceMeters,
    ).toBe(0);
  });
});
