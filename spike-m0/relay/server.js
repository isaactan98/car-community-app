// M0 spike relay — positions in, positions out. Nothing else.
//
// HARD CONSTRAINT (runs-v1-spec.md #1): never accept, log, or store speed.
// A message containing a `speed` key is rejected outright and its value is
// never printed or written anywhere. All other unknown keys are stripped
// (whitelist: type, lat, lng, ts).
//
// Protocol (client -> relay):
//   { "type": "position", "lat": number, "lng": number, "ts": epochMillis }
// Relay -> everyone else connected: the sanitized position message.
// Relay -> sender on bad input: { "type": "error", "reason": string }

import { WebSocketServer } from "ws";
import { appendFile } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 4100); // real server lives on 4000; never collide
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NDJSON_PATH =
  process.env.NDJSON_PATH || path.join(__dirname, "positions.ndjson");

const ALLOWED_KEYS = new Set(["type", "lat", "lng", "ts"]);

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Validate + sanitize an incoming message.
 * Returns { ok: true, position } or { ok: false, reason }.
 */
export function sanitize(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
  if (msg === null || typeof msg !== "object" || Array.isArray(msg)) {
    return { ok: false, reason: "message must be a JSON object" };
  }
  // Hard constraint: reject speed before doing anything else. Never echo its value.
  if ("speed" in msg) {
    return { ok: false, reason: "speed is not accepted; message rejected" };
  }
  if (msg.type !== "position") {
    return { ok: false, reason: "unknown message type" };
  }
  if (!isFiniteNumber(msg.lat) || msg.lat < -90 || msg.lat > 90) {
    return { ok: false, reason: "lat must be a number in [-90, 90]" };
  }
  if (!isFiniteNumber(msg.lng) || msg.lng < -180 || msg.lng > 180) {
    return { ok: false, reason: "lng must be a number in [-180, 180]" };
  }
  if (!isFiniteNumber(msg.ts) || msg.ts <= 0) {
    return { ok: false, reason: "ts must be epoch milliseconds" };
  }
  const stripped = Object.keys(msg).filter((k) => !ALLOWED_KEYS.has(k));
  // Whitelist-rebuild: only the allowed keys ever leave this function.
  const position = { type: "position", lat: msg.lat, lng: msg.lng, ts: msg.ts };
  return { ok: true, position, stripped };
}

// --- server ---------------------------------------------------------------

// Only start listening when run directly (smoke test imports sanitize()).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wss = new WebSocketServer({ port: PORT });
  let nextId = 1;

  wss.on("listening", () => {
    console.log(`[relay] listening on ws://0.0.0.0:${PORT}`);
    console.log(`[relay] appending positions to ${NDJSON_PATH}`);
  });

  wss.on("connection", (ws, req) => {
    ws._id = nextId++;
    console.log(
      `[relay] client #${ws._id} connected (${req.socket.remoteAddress}), total ${wss.clients.size}`
    );

    ws.on("message", (data) => {
      const result = sanitize(data.toString());
      if (!result.ok) {
        console.log(`[relay] client #${ws._id} rejected: ${result.reason}`);
        ws.send(JSON.stringify({ type: "error", reason: result.reason }));
        return;
      }
      const { position, stripped } = result;
      if (stripped.length > 0) {
        console.log(
          `[relay] client #${ws._id} stripped unknown keys: ${stripped.join(", ")}`
        );
      }

      console.log(
        `[relay] #${ws._id} position lat=${position.lat} lng=${position.lng} ts=${position.ts}`
      );

      // Append to NDJSON (position + timestamps only).
      const line =
        JSON.stringify({
          lat: position.lat,
          lng: position.lng,
          ts: position.ts,
          receivedAt: Date.now(),
          client: ws._id,
        }) + "\n";
      appendFile(NDJSON_PATH, line, (err) => {
        if (err) console.error(`[relay] NDJSON write failed: ${err.message}`);
      });

      // Broadcast to every other connected client (viewers).
      const payload = JSON.stringify(position);
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === client.OPEN) {
          client.send(payload);
        }
      }
    });

    ws.on("close", () => {
      console.log(`[relay] client #${ws._id} disconnected, total ${wss.clients.size}`);
    });
    ws.on("error", (err) => {
      console.error(`[relay] client #${ws._id} error: ${err.message}`);
    });
  });
}
