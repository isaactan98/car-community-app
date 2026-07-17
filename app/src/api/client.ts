/**
 * REST client for the Runs contract (docs/CONTRACT.md). Base path /api/v1,
 * Bearer token auth, fail-fast timeouts so degraded mode (R6) engages
 * quickly when the homelab is down.
 */
import { API_BASE, REQUEST_TIMEOUT_MS } from "../config";
import type { Car, JoinResponse, Me, Place, Run } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** true for network failures / timeouts (server unreachable). */
    readonly network: boolean,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? err.message : "Network request failed",
      null,
      true,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    throw new ApiError(
      `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      res.status,
      false,
    );
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (text.length === 0) return undefined as T;
  return JSON.parse(text) as T;
}

// ---- Auth ----

export function joinGroup(
  inviteCode: string,
  displayName: string,
): Promise<JoinResponse> {
  return request<JoinResponse>("/auth/join", {
    method: "POST",
    body: { inviteCode, displayName },
  });
}

// ---- Members & garage ----

export function getMe(): Promise<Me> {
  return request<Me>("/me");
}

export function addCar(name: string): Promise<Car> {
  return request<Car>("/me/cars", { method: "POST", body: { name } });
}

export function deleteCar(carId: string): Promise<void> {
  return request<void>(`/me/cars/${encodeURIComponent(carId)}`, {
    method: "DELETE",
  });
}

// ---- Runs ----

/**
 * The contract says "GET /api/v1/runs — list" without pinning the envelope;
 * accept both a bare array and { runs: [...] } (noted as a contract gap).
 */
export async function listRuns(): Promise<Run[]> {
  const data = await request<Run[] | { runs: Run[] }>("/runs");
  return Array.isArray(data) ? data : (data?.runs ?? []);
}

export function getRun(runId: string): Promise<Run> {
  return request<Run>(`/runs/${encodeURIComponent(runId)}`);
}

export function createRun(input: {
  name: string;
  meetup: Place;
  destination?: Place | null;
  startsAt: string;
}): Promise<Run> {
  return request<Run>("/runs", { method: "POST", body: input });
}

export function rsvp(runId: string, carId: string | null): Promise<unknown> {
  return request<unknown>(`/runs/${encodeURIComponent(runId)}/rsvp`, {
    method: "POST",
    body: { carId },
  });
}

export function leaveRun(runId: string): Promise<void> {
  return request<void>(`/runs/${encodeURIComponent(runId)}/rsvp`, {
    method: "DELETE",
  });
}

export function startRun(runId: string): Promise<unknown> {
  return request<unknown>(`/runs/${encodeURIComponent(runId)}/start`, {
    method: "POST",
  });
}

export function endRun(runId: string): Promise<unknown> {
  return request<unknown>(`/runs/${encodeURIComponent(runId)}/end`, {
    method: "POST",
  });
}
