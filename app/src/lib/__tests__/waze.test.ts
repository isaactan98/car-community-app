import { describe, expect, it } from "vitest";

import { wazeUrl } from "../waze";

describe("wazeUrl", () => {
  it("builds the contract deep-link format", () => {
    expect(wazeUrl(1.4655, 103.7578)).toBe(
      "https://waze.com/ul?ll=1.4655,103.7578&navigate=yes",
    );
  });

  it("handles negative coordinates", () => {
    expect(wazeUrl(-6.2, 106.8)).toBe(
      "https://waze.com/ul?ll=-6.2,106.8&navigate=yes",
    );
  });
});
