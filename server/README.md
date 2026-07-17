# Runs — backend (`server/`)

Node.js + TypeScript backend for the private car-group coordination app.
Implements `../docs/CONTRACT.md` exactly: REST at `/api/v1` on port **4000**,
realtime WebSocket at `/ws?token=<token>&runId=<runId>`, SQLite storage,
invite-code auth only.

**Hard Constraint 1 (spec): no speed values anywhere.** Positions are
`{ lat, lng, ts }` only. Any WS position message carrying extra keys
(especially `speed`) is rejected outright — nothing stored, nothing logged
from the payload. The logger refuses to emit any speed-like field, and
`test/nospeed.test.ts` proves the schema, stored rows, logs, and broadcast
payloads are all clean.

## Stack

- Express (REST) + `ws` (WebSocket) on one HTTP server
- `better-sqlite3` (single SQLite file, WAL mode) — no Postgres, no cloud services
- `vitest` integration tests (real HTTP + real WebSockets)
- Run with `tsx` (no build step needed); `npm run build` emits JS to `dist/` if you prefer

## Setup

```sh
cd server
npm install
```

## Running

```sh
npm run dev      # tsx watch mode (development)
npm start        # plain start
npm test         # integration test suite
npm run typecheck
```

The server listens on `PORT` (default **4000**) and creates the SQLite file at
`DB_PATH` (default `data/runs.db`) on first boot.

## Invite codes

Auth is invite-code only (no email/password/OAuth). Seed codes either way:

```sh
# CLI — generates a code (or pass your own) and prints it
npm run invite:create              # -> RUNS-1A2B3C4D
npm run invite:create -- MY-CODE   # insert a specific code

# or via env at boot (idempotent, comma-separated)
INVITE_CODES=RUNS-CREW,RUNS-GUEST npm start
```

Joining: `POST /api/v1/auth/join` with `{ "inviteCode", "displayName" }`
returns a long-lived opaque bearer token. Codes are multi-use (one code can
onboard the whole group); the `uses` counter is tracked in the DB.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP + WS listen port |
| `DB_PATH` | `data/runs.db` | SQLite file (`:memory:` for tests) |
| `INVITE_CODES` | — | Comma-separated codes seeded at boot |
| `DEEP_LINK_BASE` | `runs://run/` | Prefix for each run's `inviteDeepLink` (run id appended) |
| `SNAPSHOT_INTERVAL_MS` | `5000` | WS snapshot broadcast cadence |
| `SWEEP_INTERVAL_MS` | `60000` | Auto-end / retention sweep cadence |
| `AUTO_END_AFTER_MS` | `7200000` (2 h) | Auto-end an active run after this long with no position updates |
| `RETENTION_MS` | `86400000` (24 h) | Purge position history this long after a run ends |
| `GEOFENCE_RADIUS_M` | `150` | Arrival geofence radius around the meetup |

## Behavior summary

- **Run lifecycle:** `upcoming → active → ended`. Start/end are creator-only.
  A sweep auto-ends active runs after 2 h without position updates.
- **Geofence auto check-in:** while a run is active, an rsvped member whose
  position lands within 150 m (haversine) of the meetup flips to `arrived`
  and `member_arrived` is broadcast.
- **Privacy hard stops:** leaving a run (`DELETE /runs/:id/rsvp`) closes that
  member's sockets immediately and drops them from snapshots; ending a run
  broadcasts `run_state: ended` and closes every socket. Position ingest is
  only accepted while the run is active and the member has joined.
- **Retention:** position history is deleted 24 h after a run ends
  (scheduled sweep). ETAs live in memory only and vanish on end/leave/arrival.

## Schema note (P2 roles)

Attendee state lives in `run_attendees` (one row per run+member). Optional
roles later are a single `ALTER TABLE run_attendees ADD COLUMN role TEXT` —
no data migration needed. Deliberately not built in v1.

## Deploying behind Cloudflare Tunnel (homelab)

The server is a single plain HTTP listener — WebSocket upgrades included — so
it works behind `cloudflared` with no special config beyond pointing a tunnel
ingress at `http://localhost:4000` (Cloudflare Tunnel proxies WebSockets by
default). Tunnel setup, DNS, and access policies are left to the operator;
the app has no cloud dependencies and never needs to know it is behind a
tunnel. Run it under a process supervisor (systemd, pm2, …) and back up the
single SQLite file at `DB_PATH`.
