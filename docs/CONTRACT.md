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
- `POST /api/v1/runs/:id/end` — creator only; also auto-ends after 2h with no position updates from members not yet at the destination, or 10 min after every member who has shared a position reached the destination. An `upcoming` run never started ends 6h after `startsAt`.

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

## Run route (the line on the live map)

`GET /api/v1/runs/:id/route`

Authenticated like every other route. The road from this run's `meetup` to its
`destination`, for the line the live map draws between the two pins.

Response 200:
```json
{ "route": { "points": [ { "lat": 0, "lng": 0 } ], "distanceMeters": 0 } | null }
```

`points` is the road geometry, `meetup` first and `destination` last, at least
two entries. `distanceMeters` is the length of the **road** route, not of the
straight line between the pins.

`route` is `null` in every case where there is no road answer — the run has no
`destination`, the server has no router configured, the router was unreachable,
or it had no route between those two points. The client cannot and need not
tell them apart: all four mean *draw the direct line and label it as one*. The
endpoint is 200 in all of them, because a missing line is a degraded map (R6),
not a failed request.

Errors: 404 unknown run, 401 unauthenticated.

**There is deliberately no per-member route.** Routing each phone to its own
target would be one upstream call per member per position update — the exact
pattern free routers' usage policies exist to forbid — and it duplicates the
Waze handoff (R5), which is what the group actually navigates with. Turn-by-turn
stays Waze's job.

This endpoint is cheap for the same structural reason: a run's `meetup` and
`destination` are fixed at creation (there is no run-edit endpoint), so the
answer never changes and can be kept forever. A whole run costs **one** upstream
call, ever:

1. the route is **stored on the run row** the first time it is fetched, and
   warmed in the background as soon as the run is created — so a restart, a
   redeploy, or a request a year later costs nothing external;
2. an in-process cache holds it between those;
3. concurrent requests are coalesced, because fifty phones open the live map in
   the same second at the start of a run;
4. each phone caches it too, so degraded mode keeps the real road.

Creating a run never blocks on the router and never fails because it is down;
nothing is stored on failure, so whoever opens the live map next simply tries
again. A stored route is never replaced — the pins did not move, so neither
does the line.

Upstream is configured by `ROUTER_URL`, OSRM-shaped
(`{base}/{lng},{lat};{lng},{lat}`, default: the public FOSSGIS OSRM demo
server), with `ROUTER_USER_AGENT` identifying this deployment. Set `ROUTER_URL`
to `''` to turn road routes off entirely. Results are OpenStreetMap data: the
same "© OpenStreetMap contributors" attribution the map already carries covers
them.

**No duration crosses this boundary.** OSRM returns one; the server drops it and
never forwards it. Distance divided by duration is a speed, and Hard Constraint
1 says no speed value exists anywhere in this system. The app's ETA is computed
on the phone from the member's own samples and stays that way.

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
