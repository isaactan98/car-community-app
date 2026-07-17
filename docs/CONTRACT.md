# Runs v1 — API Contract (shared between `server/` and `app/`)

This contract is derived from `runs-v1-spec.md` and is binding for both the backend
and mobile agents. If a change is needed, update this file first, then the code.

## Hard rules inherited from the spec

- **No speed values anywhere** — not in payloads, DB, logs, or derived fields.
  Position = `{ lat, lng, ts }` only. Reject any payload containing a `speed` key.
- Invite-code auth only. No email/password/OAuth.
- Location flows only while a run is `active` and the member has joined it.

## Transport

- REST over HTTP for CRUD (JSON). Base path: `/api/v1`.
- WebSocket for realtime at `/ws?token=<token>&runId=<runId>`.
- Dev server port: **4000**.
- Auth: `Authorization: Bearer <token>` on REST; token query param on WS.

## Auth

`POST /api/v1/auth/join`
Request: `{ "inviteCode": string, "displayName": string }`
Response 200: `{ "token": string, "member": { "id": string, "displayName": string } }`
Errors: 400 invalid body, 401 bad invite code.

Tokens are long-lived opaque strings (device-bound, stored client-side).

## Members & garage

`GET /api/v1/me` → `{ "id", "displayName", "cars": [{ "id", "name" }] }`
`POST /api/v1/me/cars` → body `{ "name": string }` (free text, e.g. "ND2 MX-5"), returns car.
`DELETE /api/v1/me/cars/:carId`

## Runs

Run object:
```json
{
  "id": "string",
  "name": "string",
  "creatorId": "string",
  "meetup": { "lat": 0, "lng": 0, "label": "string" },
  "destination": { "lat": 0, "lng": 0, "label": "string" } | null,
  "startsAt": "ISO-8601",
  "state": "upcoming" | "active" | "ended",
  "inviteDeepLink": "string",
  "attendees": [
    { "memberId": "string", "displayName": "string", "carName": "string|null",
      "status": "rsvped" | "arrived" | "left" }
  ]
}
```

- `POST /api/v1/runs` — create (any member). Body: name, meetup, destination?, startsAt.
- `GET /api/v1/runs` — list (upcoming + active first, then recent ended).
- `GET /api/v1/runs/:id`
- `POST /api/v1/runs/:id/rsvp` — body `{ "carId": string | null }`. Idempotent.
- `DELETE /api/v1/runs/:id/rsvp` — leave; hard-stops location sharing server-side.
- `POST /api/v1/runs/:id/start` — creator only; upcoming → active.
- `POST /api/v1/runs/:id/end` — creator only; also auto-end after 2h with no position updates.

Geofence: server-side, **150 m radius** around `meetup`. When an rsvped member's
position enters it while the run is active, their status flips to `arrived`.

## WebSocket messages

All messages: `{ "type": string, ...payload }`. Server disconnects the socket when
the run ends or the member leaves (hard privacy stop).

Client → server:
- `position`: `{ "type": "position", "lat": number, "lng": number, "ts": epochMillis }`
  Sent every ~5 s while moving, ~30 s while stationary. Any extra keys (esp. `speed`) → message rejected.
- `eta`: `{ "type": "eta", "etaSeconds": number }` — client-computed ETA to meetup (pre-arrival).

Server → client:
- `snapshot` (on connect and every ~5 s):
  `{ "type": "snapshot", "runState": "...", "members": [ { "memberId", "displayName", "carName", "status", "lastPosition": { "lat", "lng", "ts" } | null, "etaSeconds": number|null } ] }`
- `member_arrived`: `{ "type": "member_arrived", "memberId": string }`
- `run_state`: `{ "type": "run_state", "state": "active" | "ended" }`

Staleness is client-derived: a member is stale when `now - lastPosition.ts > 60_000`.

## Degraded mode (client behavior)

Client persists the last `snapshot` + run object locally. If REST/WS are unreachable,
render last-known positions with their timestamps and a staleness banner; Waze deep
links must still work. Never render a blank screen on server failure.

## Waze deep links

`https://waze.com/ul?ll=<lat>,<lng>&navigate=yes` — used for meetup, destination,
and any member's last position.

## Retention

Position history kept in memory/DB only for the active run + 24 h after end
(placeholder until M2 decides), then purged by a scheduled job.
