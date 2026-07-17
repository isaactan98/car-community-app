// Bare WebSocket sender. Connects lazily, reconnects on the next send after a
// drop. Positions that arrive while disconnected are dropped — the next fix is
// at most ~30 s away, which is fine for a spike.

import { RELAY_URL } from "./config";
import { positionStore } from "./positionStore";

// The one message shape this app ever sends. No speed field exists here,
// and the relay would reject it anyway.
export type PositionMessage = {
  type: "position";
  lat: number;
  lng: number;
  ts: number;
};

let ws: WebSocket | null = null;
let connecting = false;

function connect(): void {
  if (connecting) return;
  connecting = true;
  positionStore.setRelayStatus("relay: connecting...");
  try {
    ws = new WebSocket(RELAY_URL);
  } catch (e) {
    connecting = false;
    ws = null;
    positionStore.setRelayStatus(`relay: connect failed (${String(e)})`);
    return;
  }
  ws.onopen = () => {
    connecting = false;
    positionStore.setRelayStatus("relay: connected");
  };
  ws.onerror = () => {
    positionStore.setRelayStatus("relay: error (will retry on next fix)");
  };
  ws.onclose = () => {
    connecting = false;
    ws = null;
    positionStore.setRelayStatus("relay: disconnected");
  };
}

/** Send one position; drops it if the socket isn't open yet. */
export function sendToRelay(msg: PositionMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    positionStore.setRelayStatus(
      `relay: sent ${new Date(msg.ts).toLocaleTimeString()}`
    );
    return;
  }
  connect(); // fire and forget; this fix is dropped, the next one goes through
}
