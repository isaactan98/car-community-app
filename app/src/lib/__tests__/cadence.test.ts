import { describe, expect, it } from "vitest";

import type { Position } from "../../api/types";
import { shouldSendPosition } from "../cadence";

const t0 = 1_700_000_000_000;
const at = (lat: number, msAfter: number): Position => ({
  lat,
  lng: 103.7,
  ts: t0 + msAfter,
});

describe("shouldSendPosition", () => {
  it("always sends the first fix", () => {
    expect(shouldSendPosition(null, at(1.4, 0))).toBe(true);
  });

  it("never sends faster than the 5 s moving interval", () => {
    const last = at(1.4, 0);
    expect(shouldSendPosition(last, at(1.5, 4000))).toBe(false);
  });

  it("sends every ~5 s while moving", () => {
    const last = at(1.4, 0);
    // 0.001° lat ≈ 111 m in 5 s → moving.
    expect(shouldSendPosition(last, at(1.401, 5000))).toBe(true);
  });

  it("holds ~30 s while stationary", () => {
    const last = at(1.4, 0);
    const parked = at(1.400_01, 29_000); // ~1 m away
    expect(shouldSendPosition(last, parked)).toBe(false);
    expect(shouldSendPosition(last, at(1.400_01, 30_000))).toBe(true);
  });
});
