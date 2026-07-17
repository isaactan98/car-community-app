/**
 * Position send cadence (R4): ~5 s while moving, ~30 s while stationary.
 * Pure decision function — unit tested.
 */
import type { Position } from "../api/types";
import {
  MOVING_SEND_INTERVAL_MS,
  STATIONARY_DISPLACEMENT_M,
  STATIONARY_SEND_INTERVAL_MS,
} from "../config";
import { haversineMeters } from "./geo";

/**
 * Decide whether a fresh GPS fix should be sent, given the last position we
 * actually sent. "Stationary" = we have moved less than
 * STATIONARY_DISPLACEMENT_M since the last send.
 */
export function shouldSendPosition(
  lastSent: Position | null,
  current: Position,
): boolean {
  if (lastSent === null) return true;
  const elapsed = current.ts - lastSent.ts;
  if (elapsed < MOVING_SEND_INTERVAL_MS) return false;
  const displacement = haversineMeters(lastSent, current);
  if (displacement >= STATIONARY_DISPLACEMENT_M) return true; // moving
  return elapsed >= STATIONARY_SEND_INTERVAL_MS; // stationary heartbeat
}
