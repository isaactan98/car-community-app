// Scripted smoke test for the M0 relay. Run: node smoke-test.js
//
// Spawns the relay on a throwaway port, then asserts:
//   1. a valid position is broadcast to a second (viewer) client, with EXACTLY
//      the keys { type, lat, lng, ts }
//   2. a position carrying a `speed` key is REJECTED (error to sender, nothing
//      broadcast, nothing written to the NDJSON file)
//   3. unknown extra keys are stripped before broadcast/storage
//   4. garbage JSON gets an error, not a crash
//   5. the NDJSON file contains the accepted positions and no "speed" anywhere

import { spawn } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4199;
const NDJSON_PATH = path.join(__dirname, "positions.smoke-test.ndjson");

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}`);
  }
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

/** Wait for the next message on a socket, or null after timeoutMs of silence. */
function nextMessage(ws, timeoutMs = 700) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.off("message", onMsg);
      resolve(null);
    }, timeoutMs);
    const onMsg = (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    };
    ws.once("message", onMsg);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (existsSync(NDJSON_PATH)) rmSync(NDJSON_PATH);

  console.log("[smoke] starting relay...");
  const relay = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: String(PORT), NDJSON_PATH },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    relay.stdout.on("data", (d) => {
      process.stdout.write(`  [relay] ${d}`);
      if (d.toString().includes("listening")) resolve();
    });
    relay.on("exit", (code) => reject(new Error(`relay exited early (${code})`)));
    setTimeout(() => reject(new Error("relay did not start in 5s")), 5000);
  });

  const viewer = await connect();
  const sender = await connect();

  try {
    // 1. valid position is broadcast, exact key set
    console.log("[smoke] 1: valid position");
    const good = { type: "position", lat: 1.4927, lng: 103.7414, ts: Date.now() }; // JB CIQ-ish
    sender.send(JSON.stringify(good));
    let seen = await nextMessage(viewer);
    assert(seen !== null, "viewer received the broadcast");
    assert(seen && seen.lat === good.lat && seen.lng === good.lng && seen.ts === good.ts,
      "lat/lng/ts round-tripped intact");
    assert(seen && Object.keys(seen).sort().join(",") === "lat,lng,ts,type",
      "broadcast has exactly {type, lat, lng, ts}");

    // 2. speed key -> rejected, not broadcast, not stored
    console.log("[smoke] 2: position with speed key is rejected");
    sender.send(JSON.stringify({ type: "position", lat: 1.5, lng: 103.8, ts: Date.now(), speed: 142.7 }));
    const err = await nextMessage(sender);
    assert(err && err.type === "error", "sender got an error response");
    assert(err && !JSON.stringify(err).includes("142.7"), "error response does not echo the speed value");
    seen = await nextMessage(viewer, 500);
    assert(seen === null, "viewer received nothing for the speed message");

    // 3. unknown extra keys are stripped
    console.log("[smoke] 3: unknown keys stripped");
    sender.send(JSON.stringify({ type: "position", lat: 1.3521, lng: 103.8198, ts: Date.now(), battery: 88, foo: "bar" }));
    seen = await nextMessage(viewer);
    assert(seen !== null, "viewer received the broadcast");
    assert(seen && !("battery" in seen) && !("foo" in seen), "extra keys were stripped");
    assert(seen && Object.keys(seen).sort().join(",") === "lat,lng,ts,type",
      "broadcast has exactly {type, lat, lng, ts}");

    // 4. garbage input -> error, relay stays up
    console.log("[smoke] 4: garbage JSON");
    sender.send("not json at all {{{");
    const err2 = await nextMessage(sender);
    assert(err2 && err2.type === "error", "garbage got an error response");
    sender.send(JSON.stringify({ type: "position", lat: 999, lng: 0, ts: Date.now() }));
    const err3 = await nextMessage(sender);
    assert(err3 && err3.type === "error", "out-of-range lat got an error response");

    // 5. NDJSON file: exactly the 2 accepted positions, and never the word "speed"
    console.log("[smoke] 5: NDJSON file contents");
    await sleep(300); // let async appends flush
    const ndjson = readFileSync(NDJSON_PATH, "utf8").trim();
    const lines = ndjson === "" ? [] : ndjson.split("\n");
    assert(lines.length === 2, `NDJSON has exactly 2 lines (got ${lines.length})`);
    assert(!ndjson.includes("speed"), 'NDJSON contains no "speed" anywhere');
    assert(!ndjson.includes("142.7"), "NDJSON does not contain the rejected speed value");
    const parsed = lines.map((l) => JSON.parse(l));
    assert(parsed.every((p) => Object.keys(p).sort().join(",") === "client,lat,lng,receivedAt,ts"),
      "NDJSON rows have exactly {lat, lng, ts, receivedAt, client}");
  } finally {
    viewer.close();
    sender.close();
    relay.kill();
    if (existsSync(NDJSON_PATH)) rmSync(NDJSON_PATH);
  }

  if (failures > 0) {
    console.error(`\n[smoke] ${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\n[smoke] all assertions passed");
}

main().catch((e) => {
  console.error(`[smoke] fatal: ${e.message}`);
  process.exit(1);
});
