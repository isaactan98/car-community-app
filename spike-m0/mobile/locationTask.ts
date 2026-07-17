// Background location task. Imported from index.ts so TaskManager.defineTask
// runs at module scope — required for the task to fire in the headless
// (backgrounded / screen-locked) JS context.
//
// SPEC HARD CONSTRAINT #1: never store or transmit speed. The OS hands us
// coords that include speed; we whitelist lat/lng/ts below and nothing else
// ever leaves this function. Do not add fields.

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { positionStore, type OwnPosition } from "./positionStore";
import { sendToRelay } from "./relaySocket";

export const LOCATION_TASK = "spike-m0-location";

// Adaptive send gate: ~every 5 s while moving, ~every 30 s while stationary.
// The OS delivers fixes about every 5 s (timeInterval below); this JS gate
// decides which of them are worth sending.
const MOVING_MIN_METERS = 25; // less than this since last send = "stationary"
const MOVING_MIN_MS = 4_500; // moving cadence (~5 s)
const STATIONARY_MIN_MS = 30_000; // stationary heartbeat (~30 s)

let lastSent: OwnPosition | null = null;

function metersBetween(a: OwnPosition, b: OwnPosition): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function shouldSend(p: OwnPosition): boolean {
  if (!lastSent) return true;
  const elapsed = p.ts - lastSent.ts;
  const moved = metersBetween(lastSent, p);
  if (moved >= MOVING_MIN_METERS) return elapsed >= MOVING_MIN_MS;
  return elapsed >= STATIONARY_MIN_MS;
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error) {
      positionStore.setRelayStatus(`task error: ${error.message}`);
      return;
    }
    if (!data?.locations) return;
    for (const loc of data.locations) {
      // Whitelist: latitude, longitude, timestamp. NEVER loc.coords.speed.
      const pos: OwnPosition = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        ts: loc.timestamp,
      };
      positionStore.setPosition(pos);
      if (!shouldSend(pos)) continue;
      lastSent = pos;
      sendToRelay({ type: "position", ...pos });
    }
  }
);

export async function startTracking(): Promise<void> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") {
    throw new Error("Foreground location permission denied.");
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== "granted") {
    throw new Error(
      'Background permission denied — pick "Allow all the time" in settings.'
    );
  }
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    // Android: ask for a fix ~every 5 s even when stationary; the shouldSend()
    // gate above throttles stationary sends down to ~30 s.
    timeInterval: 5_000,
    distanceInterval: 0,
    // iOS-only options (harmless on Android target, spike is Android-first):
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    // Android foreground service — this is the whole point of M0: the
    // persistent notification keeps updates flowing with the screen locked
    // and Waze in the foreground.
    foregroundService: {
      notificationTitle: "Runs spike — sharing location",
      notificationBody: "Sending position to the relay (M0 test run).",
      notificationColor: "#1e88e5",
      // Keep the service (and tracking) alive even if the app is swiped away —
      // for M0 we WANT to observe whether the OEM lets it survive.
      killServiceOnDestroy: false,
    },
  });
}

export async function stopTracking(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  lastSent = null;
}

export async function isTracking(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
}
