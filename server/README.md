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

## Admin DB UI (Adminer)

`docker-compose.yml` runs the server plus [Adminer](https://www.adminer.org/)
against the same `data/runs.db`, giving you browse / SELECT / UPDATE / DELETE
and a SQL console in the browser:

```sh
cd server
cp .env.example .env   # set TAILNET_IP to your Tailscale IP (tailscale ip -4)
docker compose up -d
```

Then open the Adminer URL (see the port bind in the compose file) and log in:

| Field | Value |
|---|---|
| System | **SQLite 3** |
| Username / Password | *(leave blank — SQLite has no auth)* |
| Database | `/data/runs.db` |

> ⚠️ **Security — read this.** SQLite has no password, so Adminer's login is
> **not** a real gate: anyone who can load the page can edit the DB. The only
> thing protecting your data is the **network bind**. The compose file binds
> Adminer (and the server) to a single **Tailscale IP** — `TAILNET_IP` in
> `server/.env`, see `.env.example`. Never bind it to all interfaces
> (`8081:8080`) and never route it
> through the public Cloudflare tunnel. If you want a real login on top, put a
> reverse proxy with basic-auth in front.

Two operational notes:

- **Write permission.** `runs.db` is owned by uid `1000` (the `node` user in
  the server image). The compose runs Adminer as `user: "1000:1000"` so it can
  actually write (and create the `-wal`/`-shm` sidecars). If edits fail as
  read-only, that uid mapping is why.
- **Concurrency (WAL).** The Node server holds the file open in WAL mode.
  Concurrent reads are fine; a write from Adminer can occasionally hit
  `database is locked` if it collides with the server. Prefer editing when runs
  are inactive, and for multi-table changes respect the foreign keys (delete
  children first: `positions` → `run_attendees` → `runs`).

### Back up before you edit

`VACUUM INTO` makes a clean, consistent copy even while the server is running:

```sh
sh scripts/backup-db.sh        # writes ./data/backup-<timestamp>.db
```

## Schema note (P2 roles)

Attendee state lives in `run_attendees` (one row per run+member). Optional
roles later are a single `ALTER TABLE run_attendees ADD COLUMN role TEXT` —
no data migration needed. Deliberately not built in v1.

## Deploying behind Cloudflare Tunnel (production)

The server is a single plain HTTP listener — WebSocket upgrades included — so
it works behind `cloudflared` with no special config (Cloudflare Tunnel
proxies WebSockets by default). The compose file bundles a `cloudflared`
service behind the `tunnel` profile:

```sh
# production box — no host port published; only the tunnel reaches the server
docker compose -f docker-compose.yml --profile tunnel up -d
```

Create a **remotely-managed tunnel** in the Zero Trust dashboard, put its
token in `server/.env` (`TUNNEL_TOKEN`), and configure the ingress
dashboard-side: `https://runs.<domain>` → `http://server:4000` (the compose
service name resolves on the internal network). The app has no cloud
dependencies and never needs to know it is behind a tunnel. Deployment modes,
manual failover, and the watchdog/backup runbook live in the root README's
"Deployment" section.
