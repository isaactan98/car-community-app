import { describe, expect, it } from "vitest";

import type { Position } from "../../api/types";
import { estimateEtaSeconds, formatEta } from "../eta";

const target = { lat: 1.5, lng: 103.7 };

/** Build a straight north-bound track toward the target. */
function track(
  startLat: number,
  stepLatPerSample: number,
  samples: number,
  stepMs: number,
): Position[] {
  const t0 = 1_700_000_000_000;
  return Array.from({ length: samples }, (_, i) => ({
    lat: startLat + i * stepLatPerSample,
    lng: 103.7,
    ts: t0 + i * stepMs,
  }));
}

describe("estimateEtaSeconds", () => {
  it("null with fewer than 2 samples", () => {
    expect(estimateEtaSeconds([], target)).toBeNull();
    expect(
      estimateEtaSeconds([{ lat: 1.4, lng: 103.7, ts: 1 }], target),
    ).toBeNull();
  });

  it("estimates from steady progress toward the target", () => {
    // ~22 m/s northbound (0.001° lat ≈ 111 m per 5 s), 11.1 km remaining
    // from the last sample → ETA ≈ 500 s.
    const samples = track(1.39, 0.001, 12, 5000);
    const eta = estimateEtaSeconds(samples, target)!;
    expect(eta).toBeGreaterThan(380);
    expect(eta).toBeLessThan(620);
  });

  it("null when stationary", () => {
    const samples = track(1.4, 0, 10, 5000); // no movement
    expect(estimateEtaSeconds(samples, target)).toBeNull();
  });

  it("null when driving away from the target", () => {
    const samples = track(1.4, -0.001, 10, 5000); // southbound, away
    expect(estimateEtaSeconds(samples, target)).toBeNull();
  });

  it("0 when effectively at the target", () => {
    const samples = track(1.49995, 0.000004, 10, 5000);
    expect(estimateEtaSeconds(samples, target)).toBe(0);
  });
});

describe("formatEta", () => {
  it("dash for unknown", () => {
    expect(formatEta(null)).toBe("—");
    expect(formatEta(undefined)).toBe("—");
    expect(formatEta(-1)).toBe("—");
  });
  it("now under 45 s", () => {
    expect(formatEta(0)).toBe("now");
    expect(formatEta(30)).toBe("now");
  });
  it("minutes", () => {
    expect(formatEta(240)).toBe("4 min");
    expect(formatEta(59 * 60)).toBe("59 min");
  });
  it("hours + zero-padded minutes", () => {
    expect(formatEta(3600)).toBe("1 h");
    expect(formatEta(3900)).toBe("1 h 05 min");
  });
});
