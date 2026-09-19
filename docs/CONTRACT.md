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
  "phase": "gathering" | "driving",
  "inviteDeepLink": "string",
  "attendees": [
    { "memberId": "string", "displayName": "string", "carName": "string|null",
      "status": "rsvped" | "arrived" | "left", "atDestination": false }
  ]
}
```

`phase` is the **group's** leg of the run:

- `gathering` — everyone is converging on `meetup`. Every run starts here.
- `driving` — the group has left the meetup and is heading for `destination`.

A run with `destination: null` stays `gathering` for its whole life. The
transition is one-way and server-derived (see *Phase transitions* below) — there
is no "start the drive" button, because a run has a creator, not a leader
(spec Hard Constraint 2).

`status` describes the **meetup** only (`arrived` means "checked in at the
meetup"). `atDestination` is the independent fact of having reached
`destination`, and does not require having checked in at the meetup first —
a member who skips the meetup and drives straight there still gets it.

Clients must treat both fields as optional when reading data cached by an
older build: absent `phase` reads as `"gathering"`, absent `atDestination` as
`false`.

- `POST /api/v1/runs` — create (any member). Body: name, meetup, destination?, startsAt.
- `GET /api/v1/runs` — list (upcoming + active first, then recent ended).
- `GET /api/v1/runs/:id`
- `POST /api/v1/runs/:id/rsvp` — body `{ "carId": string | null }`. Idempotent.
- `DELETE /api/v1/runs/:id/rsvp` — leave; hard-stops location sharing server-side.
- `POST /api/v1/runs/:id/start` — creator only; upcoming → active.
- `POST /api/v1/runs/:id/end` — creator only; also auto-end after 2h with no position updates.

### Geofences and phase transitions

Both are evaluated server-side on every ingested `position`, and only while the
run is `active`.

- **Meetup geofence** — **150 m radius** (`GEOFENCE_RADIUS_M`) around `meetup`.
  When an `rsvped` member's position enters it, their status flips to `arrived`
  and the server broadcasts `member_arrived`.
- **Destination geofence** — same radius around `destination`, when one is set.
  When any joined member's position enters it, `atDestination` flips to true and
  the server broadcasts `member_at_destination`. One-way for the life of the run.
- **Phase transition** — `gathering` → `driving` when the run has a
  `destination` and at least `ceil(arrived / 2)` (minimum 1) of the members who
  have checked in at the meetup are further than **500 m**
  (`DEPART_RADIUS_M`) from it. One-way; the server broadcasts `run_phase`.

The departure radius is deliberately larger than the geofence radius so that
stepping across a car park, or a kopitiam run down the road, does not read as
"the convoy has left".

## Place search (map pin picker)

`GET /api/v1/places/search?q=<text>&lat=<number>&lng=<number>&limit=<1..10>`

Authenticated like every other route. `lat`/`lng` are an optional proximity
bias — pass the map's current centre so "caltex" ranks JB before California.

Response 200:
```json
{ "places": [ { "label": "string", "detail": "string", "lat": 0, "lng": 0 } ] }
```
`label` is the place name, `detail` its locality line ("Taman Molek, Johor,
Malaysia"). Both may be empty strings; `places` may be empty.

Errors: 400 missing/oversized `q`, 429 rate-limited (client should back off and
keep the last results on screen), 502 the upstream geocoder failed or timed out.

The server is the only thing that talks to a geocoder. That is deliberate:

- The app is distributed as a sideloaded APK to a private group, so the
  geocoder cannot be swapped without a new APK unless it sits behind our own
  endpoint.
- Upstream free geocoders are used under policies written around one
  identifiable client (a real `User-Agent`, a request ceiling). 50 phones
  calling directly is exactly what gets a group banned.
- Results are cached and rate-limited per member server-side.

Upstream is configured by `GEOCODER_URL` (default: the public Photon instance)
with `GEOCODER_USER_AGENT` identifying this deployment. Results are OpenStreetMap
data: the client must show "© OpenStreetMap contributors" wherever it shows them.

**Never** send a request per keystroke. The client debounces (400 ms) and the
server caches; both are part of staying inside upstream usage policy.

## WebSocket messages

All messages: `{ "type": string, ...payload }`. Server disconnects the socket when
the run ends or the member leaves (hard privacy stop).

Client → server:
- `position`: `{ "type": "position", "lat": number, "lng": number, "ts": epochMillis }`
  Sent every ~5 s while moving, ~30 s while stationary. Any extra keys (esp. `speed`) → message rejected.
- `eta`: `{ "type": "eta", "etaSeconds": number }` — client-computed ETA to the
  sender's **current leg target**, which the client derives the same way the
  server validates it:
  - the member has not `arrived` → target is `meetup`;
  - the member has `arrived` and the run phase is `driving` → target is `destination`.

  The server ignores `eta` from a member who has `arrived` while the phase is
  still `gathering` (they are already there), and from any member who is
  `atDestination` (nothing left to estimate).

Server → client:
- `snapshot` (on connect and every ~5 s):
  `{ "type": "snapshot", "runState": "...", "runPhase": "gathering" | "driving", "members": [ { "memberId", "displayName", "carName", "status", "atDestination": boolean, "lastPosition": { "lat", "lng", "ts" } | null, "etaSeconds": number|null } ] }`
- `member_arrived`: `{ "type": "member_arrived", "memberId": string }` — reached the meetup.
- `member_at_destination`: `{ "type": "member_at_destination", "memberId": string }` — reached the destination.
- `run_phase`: `{ "type": "run_phase", "phase": "gathering" | "driving" }`
- `run_state`: `{ "type": "run_state", "state": "active" | "ended" }`

Clients must ignore server message types they do not recognise, so that a
server ahead of a sideloaded APK never breaks it.

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
