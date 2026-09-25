import { describe, expect, it } from "vitest";

import { easeOutCubic, lerpLatLng, shouldGlide } from "../glide";

describe("easeOutCubic", () => {
  it("starts at 0 and ends at 1", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("clamps outside [0, 1]", () => {
    expect(easeOutCubic(-0.5)).toBe(0);
    expect(easeOutCubic(1.5)).toBe(1);
  });

  it("front-loads the motion", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe("lerpLatLng", () => {
  const a = { lat: 1.3, lng: 103.8 };
  const b = { lat: 1.31, lng: 103.82 };

  it("returns the endpoints at t = 0 and t = 1", () => {
    expect(lerpLatLng(a, b, 0)).toEqual(a);
    expect(lerpLatLng(a, b, 1)).toEqual(b);
  });

  it("returns the midpoint at t = 0.5", () => {
    const m = lerpLatLng(a, b, 0.5);
    expect(m.lat).toBeCloseTo(1.305, 9);
    expect(m.lng).toBeCloseTo(103.81, 9);
  });
});

describe("shouldGlide", () => {
  const here = { lat: 1.3521, lng: 103.8198 };

  it("glides a normal 5-second move (~80 m)", () => {
    expect(shouldGlide(here, { lat: 1.3528, lng: 103.8198 })).toBe(true);
  });

  it("skips sub-metre jitter", () => {
    expect(shouldGlide(here, here)).toBe(false);
  });

  it("snaps a jump too big to be driving (~5 km)", () => {
    expect(shouldGlide(here, { lat: 1.3971, lng: 103.8198 })).toBe(false);
  });
});
