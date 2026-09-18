import { describe, expect, it } from "vitest";

import { compareEta, formatWhen, initials, relativeDay } from "../format";

describe("relativeDay", () => {
  const now = new Date(2026, 8, 18, 9, 30);

  it("labels today, tomorrow and yesterday by calendar day", () => {
    expect(relativeDay(new Date(2026, 8, 18, 23, 59), now)).toBe("Today");
    expect(relativeDay(new Date(2026, 8, 19, 0, 1), now)).toBe("Tomorrow");
    expect(relativeDay(new Date(2026, 8, 17, 6, 0), now)).toBe("Yesterday");
  });

  it("returns null further out", () => {
    expect(relativeDay(new Date(2026, 8, 20, 9, 0), now)).toBeNull();
    expect(relativeDay(new Date(2026, 8, 12, 9, 0), now)).toBeNull();
  });

  it("crosses month boundaries", () => {
    expect(
      relativeDay(new Date(2026, 9, 1, 8, 0), new Date(2026, 8, 30, 22, 0)),
    ).toBe("Tomorrow");
  });
});

describe("formatWhen", () => {
  it("prefixes relative days", () => {
    const now = new Date(2026, 8, 18, 9, 30).getTime();
    expect(formatWhen(new Date(2026, 8, 18, 6, 30).toISOString(), now)).toMatch(
      /^Today, /,
    );
  });

  it("echoes unparseable input", () => {
    expect(formatWhen("not a date", Date.now())).toBe("not a date");
  });
});

describe("compareEta", () => {
  const row = (displayName: string, etaSeconds: number | null) => ({
    displayName,
    etaSeconds,
  });

  it("sorts soonest first with unknown ETAs last", () => {
    const rows = [
      row("Daniel", 1440),
      row("Kelvin", null),
      row("Jun Hao", 180),
      row("Marcus", 660),
    ];
    expect(rows.sort(compareEta).map((r) => r.displayName)).toEqual([
      "Jun Hao",
      "Marcus",
      "Daniel",
      "Kelvin",
    ]);
  });

  it("breaks ties by name", () => {
    expect([row("Siti", null), row("Aaron", null)].sort(compareEta)[0]
      .displayName).toBe("Aaron");
  });
});

describe("initials", () => {
  it("takes up to two words", () => {
    expect(initials("Wei Jie")).toBe("WJ");
    expect(initials("isaac")).toBe("I");
    expect(initials("  Jun   Hao Tan ")).toBe("JH");
  });

  it("never returns empty", () => {
    expect(initials("   ")).toBe("?");
  });
});
