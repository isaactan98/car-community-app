# Runs — mobile app (Android)

Private car-group coordination app: run lifecycle, RSVP + garage, arrival
board with live ETAs, live MapLibre map with background location, one-tap
Waze handoff, and a degraded offline mode. Built with React Native + Expo
SDK 57 (TypeScript) against the API contract in `../docs/CONTRACT.md`.

## Setup

```bash
cd app
npm install
```

## Configure the server URL

Everything lives in **`src/config.ts`** — edit `SERVER_URL` (default
`http://localhost:4000`):

- Physical Android device on your LAN: `http://<your-machine-LAN-IP>:4000`
- Stock Android emulator: `http://10.0.2.2:4000` (the emulator's alias for
  the host machine — `localhost` is the emulator itself)
- Production/homelab: your Cloudflare Tunnel hostname, e.g.
  `https://runs.example.com`

The REST base path (`/api/v1`), WebSocket URL (`/ws`), map style URL, send
cadences, and the 60 s staleness threshold are all derived in the same file.

## Running on an Android device

**Expo Go will not work for the full app.** Two of the core features use
native modules that are not bundled in Expo Go:

- `@maplibre/maplibre-react-native` (the map)
- background location as an Android **foreground service**
  (`expo-location` + `expo-task-manager` with the config-plugin flags in
  `app.json`)

You need a **development build** (or a release APK):

```bash
# Local build (requires Android SDK + a connected device/emulator):
npx expo run:android

# ...or an EAS development build:
npx eas build --profile development --platform android
# then start the dev server and open the app:
npx expo start --dev-client
```

For sharing with the group, build a release APK (`npx expo run:android
--variant release` or an EAS `production` profile) after pointing
`SERVER_URL` at the real server.

Expo Go remains fine for poking at pure-UI screens that don't touch the map
or location, but the invite → runs → board flow is best exercised in the dev
build throughout.

## Android permissions

Declared in `app.json` and requested at runtime the first time you open an
active run you've joined:

| Permission | Why |
| --- | --- |
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | your dot on the live map |
| `ACCESS_BACKGROUND_LOCATION` | keep updating with screen locked / Waze in foreground ("Allow all the time") |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` | the persistent notification that keeps tracking alive during a run |

If the user grants only "While using the app", the app falls back to a
foreground-only watcher (positions stop when the app is backgrounded) and
everything else still works.

On aggressive OEM builds (Xiaomi/Oppo/etc.) also exempt the app from battery
optimization or background updates may still be killed. Per-brand steps are in
[`../docs/android-battery-setup.md`](../docs/android-battery-setup.md), which
the app also links to in-app (the "Allow all the time" background prompt and
the foreground-only hint on the arrival board both point at it).

## Privacy behavior (R7)

- Location sharing starts **only** when a run is `active` **and** you have
  joined it (opening the run's board/map is what kicks it off).
- Sharing hard-stops immediately when you leave the run, when the run ends
  (server `run_state` message or REST state), or when you leave the group.
  The background task is stopped and the socket closed — no ambient tracking.
- Outgoing position messages contain `lat`, `lng`, `ts` only. Speed is never
  read, stored, sent, or logged anywhere in this codebase.

## Degraded mode (R6)

The last run object, run list, and WS snapshot are cached in AsyncStorage.
If the server is unreachable the app renders last-known positions with their
timestamps under an "Offline — data stale" banner, and all Waze deep links
keep working. A dead server never produces a blank screen.

## Scripts

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # vitest — pure logic modules (src/lib)
npm run android     # expo run:android (dev build)
```

## Layout

```
src/
  config.ts          server URL + tunables (single config file)
  api/               contract types + REST client
  ws/ (via live/)    WebSocket handled inside the live session
  live/liveSession.ts  socket + background-location singleton (R4/R7)
  lib/               pure logic: waze, geo, eta, staleness, cadence,
                     snapshot reducer — unit tested with vitest
  storage/           AsyncStorage: session + degraded-mode cache
  screens/           Invite, RunList, CreateRun, RunDetail (arrival board),
                     LiveMap, Garage
  session/           invite-code session context
  ui/                shared atoms (buttons, banner, theme, useNow)
```
