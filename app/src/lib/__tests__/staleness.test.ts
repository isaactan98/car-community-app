import { describe, expect, it } from "vitest";

import { formatAge, isStale } from "../staleness";

describe("isStale", () => {
  const now = 1_700_000_000_000;

  it("fresh under 60 s", () => {
    expect(isStale(now - 59_000, now)).toBe(false);
    expect(isStale(now, now)).toBe(false);
  });

  it("stale strictly over 60 s (contract: now - ts > 60_000)", () => {
    expect(isStale(now - 60_000, now)).toBe(false);
    expect(isStale(now - 60_001, now)).toBe(true);
  });
});

describe("formatAge", () => {
  const now = 1_700_000_000_000;
  it("seconds, minutes, hours, days", () => {
    expect(formatAge(now - 12_000, now)).toBe("12s");
    expect(formatAge(now - 3 * 60_000, now)).toBe("3m");
    expect(formatAge(now - 2 * 3_600_000, now)).toBe("2h");
    expect(formatAge(now - 3 * 86_400_000, now)).toBe("3d");
  });
  it("clamps future timestamps to 0s", () => {
    expect(formatAge(now + 5000, now)).toBe("0s");
  });
});
