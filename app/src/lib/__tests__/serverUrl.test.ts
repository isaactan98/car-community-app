import { describe, expect, it } from "vitest";

import { normalizeServerUrl } from "../serverUrl";

describe("normalizeServerUrl", () => {
  it("leaves a well-formed URL alone", () => {
    expect(normalizeServerUrl("http://100.124.2.91:4000")).toBe(
      "http://100.124.2.91:4000",
    );
    expect(normalizeServerUrl("https://runs.example.com")).toBe(
      "https://runs.example.com",
    );
  });

  // The bug this module exists for: fetch forgave it, iOS's WebSocket did not.
  it("repairs a missing slash after the scheme", () => {
    expect(normalizeServerUrl("http:/100.124.2.91:4000")).toBe(
      "http://100.124.2.91:4000",
    );
    expect(normalizeServerUrl("http:100.124.2.91:4000")).toBe(
      "http://100.124.2.91:4000",
    );
    expect(normalizeServerUrl("https:///runs.example.com")).toBe(
      "https://runs.example.com",
    );
  });

  it("trims whitespace and trailing slashes", () => {
    expect(normalizeServerUrl("  http://localhost:4000/  ")).toBe(
      "http://localhost:4000",
    );
    expect(normalizeServerUrl("http://localhost:4000///")).toBe(
      "http://localhost:4000",
    );
  });

  it("yields a WS endpoint with a host a native socket can resolve", () => {
    const ws = `${normalizeServerUrl("http:/100.124.2.91:4000").replace(/^http/, "ws")}/ws`;
    expect(ws).toBe("ws://100.124.2.91:4000/ws");
    expect(ws.startsWith("ws://")).toBe(true);
  });
});
