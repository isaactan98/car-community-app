# M0 — Background Location Spike

Proves (or kills) the project: Android background location tracking across a
JB–SG drive with the app backgrounded, screen locked, and Waze in front.
Per `runs-v1-spec.md`, **if this is unreliable, the project pivots here.**

Two pieces, deliberately bare:

- `relay/` — standalone Node WebSocket relay on port **4100** (never collides
  with the real server on 4000). Accepts `{ type: "position", lat, lng, ts }`,
  logs to console, appends to `positions.ndjson`, broadcasts to any other
  connected client. **Rejects any message containing `speed` and strips all
  other unknown keys** — position + timestamp only, per spec hard constraint 1.
- `mobile/` — bare Expo app (SDK 57, TypeScript). Foreground + background
  location permission, background updates via `expo-location` +
  `expo-task-manager` with an Android foreground-service notification, sends
  each position to the relay over WebSocket, shows your own dot on a MapLibre
  map (OpenFreeMap tiles — no Mapbox, no Google).

No auth, no runs, no styling beyond the map and a status line. This is a spike.

---

## 1. Run the relay

```sh
cd relay
npm install
npm start            # listens on ws://0.0.0.0:4100, writes positions.ndjson
```

Smoke test (spawns its own relay on port 4199, asserts speed-rejection,
key-stripping, NDJSON hygiene):

```sh
npm test
```

Watch live positions from a second terminal (any WS client is a "viewer"):

```sh
npx wscat -c ws://localhost:4100
```

Post-drive continuity report (update count, largest gap, all gaps > 60 s):

```sh
node analyze.js               # reads positions.ndjson
node analyze.js positions.ndjson 60
```

### Reaching the relay from the car

On the same Wi-Fi, the phone can hit your laptop's LAN IP directly. On the
road you need a public URL — quickest is a Cloudflare quick tunnel:

```sh
cloudflared tunnel --url http://localhost:4100
# prints https://<random>.trycloudflare.com  ->  use wss://<random>.trycloudflare.com
```

## 2. Run the app on a device

Configure the relay URL first — single config file:

- `mobile/config.ts` → set `RELAY_URL` (e.g. `ws://192.168.1.23:4100` on LAN,
  or `wss://<random>.trycloudflare.com` for the drive).

> **Expo Go will NOT work.** MapLibre is a native module and background
> location needs a real manifest with the foreground-service permissions, so
> you need a development/standalone build.

With the phone plugged in (USB debugging on) and Android SDK installed:

```sh
cd mobile
npm install
npx expo run:android            # prebuilds android/, installs on the device
```

For the actual drive test, build a release APK so Metro isn't needed:

```sh
npx expo run:android --variant release
# or via EAS: npx eas build -p android --profile preview
```

In the app: tap **Start tracking**, grant location and then choose
**"Allow all the time"** when Android asks about background access. You should
see the persistent notification ("Runs spike — sharing location"), your dot on
the map, and `position` lines scrolling in the relay console.

Update cadence (adaptive, implemented as a JS gate in
`mobile/locationTask.ts`): ~every 5 s while moving (≥ 25 m since last send),
~every 30 s heartbeat while stationary.

**Never stored or sent: speed.** The client whitelists `lat/lng/ts` before
anything leaves the task, and the relay independently rejects any message with
a `speed` key. Negative test lives in `relay/smoke-test.js`.

## 3. Test protocol — JB–SG drive

Goal (spec M0 DoD): full JB–SG commute tracked end-to-end on the server;
battery drain measured and recorded.

### Setup (night before / at the wheel, engine off)

1. Relay running and reachable from mobile data (tunnel URL in `config.ts`,
   verified with the dot updating on mobile data, Wi-Fi OFF).
2. Fresh `positions.ndjson` (move the old one away) so the log is one drive.
3. Phone: charge to a known level, **unplugged for the whole drive** (else the
   battery numbers are meaningless). Note OEM + model + Android version.
4. Apply the per-OEM battery exemption for the phone (checklist below).
5. Battery saver OFF (first run = baseline; a battery-saver-ON run is a
   useful second experiment, not the first one).

### Record at the start

- [ ] Time, battery %, phone model, Android version
- [ ] Screen-lock type, battery saver state, exemptions applied

### Drive steps

1. Start relay logging; confirm dot moves in the app.
2. Tap **Start tracking**. Confirm foreground-service notification is showing.
3. Open **Waze**, start navigation JB → SG (or reverse). Waze stays in the
   foreground the entire drive.
4. **Lock the screen** for at least two long stretches (15+ min each).
5. Do NOT open the spike app again until the drive ends (opening it resets
   the experiment — we're testing background behavior).
6. Include the causeway/CIQ crawl if possible — the stationary/creeping phase
   exercises the 30 s heartbeat and cell-network handover (MY ↔ SG roaming).

### Record at the end

- [ ] Time, battery % (compute drain per hour)
- [ ] `node relay/analyze.js` output: update count, largest gap, gaps > 60 s
- [ ] Any moment the notification disappeared (OEM killed the service)
- [ ] Whether updates continued through: screen locked · Waze foreground ·
      CIQ stationary period · network handover between MY and SG carriers

### Pass / fail

- **PASS:** continuous track end-to-end, no gap > 60 s attributable to the OS
  killing the service (tunnel/network blips that self-recover are noted but
  not fatal), battery drain acceptable (record it — the spec sets the budget
  from this number).
- **FAIL:** OEM kills the service despite exemptions, or gaps make the track
  unusable → project pivots per spec.

Repeat on at least the 2–3 OEMs most common in the group before calling M0
done — Pixel/stock passing means little for MIUI/ColorOS.

## 4. Per-OEM battery-saver exemption checklist (MY/SG device mix)

Apply BEFORE the drive. Menu names drift between OS versions — search the
Settings app for "battery" + the app name if a path doesn't match.
[dontkillmyapp.com](https://dontkillmyapp.com) is the reference if stuck.

### Xiaomi / Redmi / POCO (MIUI / HyperOS)

- [ ] Settings → Apps → Manage apps → *mobile* → Battery saver → **No restrictions**
- [ ] Same screen → **Autostart** → ON
- [ ] Recents view → long-press the app card → lock (padlock) so "clear all" spares it
- [ ] Settings → Battery → Battery saver OFF (or exempt the app)

### Samsung (One UI)

- [ ] Settings → Apps → *mobile* → Battery → **Unrestricted**
- [ ] Settings → Battery → Background usage limits → ensure app is NOT in
      "Sleeping apps" / "Deep sleeping apps"; add to **Never sleeping apps**
- [ ] Settings → Battery → Adaptive battery — consider OFF for the test run

### Oppo / OnePlus / Realme (ColorOS)

- [ ] Settings → Apps → *mobile* → Battery usage → **Allow background activity**
      (and "Allow foreground activity")
- [ ] Settings → Apps → Auto-launch → enable for the app
- [ ] Recents → app card menu → **Lock**

### Vivo (Funtouch / OriginOS)

- [ ] Settings → Battery → Background power consumption management → *mobile* →
      **Don't restrict** (allow high background power)
- [ ] iManager → App manager → Autostart manager → enable for the app
- [ ] Recents → pull app card down / padlock to lock it

### Huawei (EMUI — no Google services on newer units; test sideloaded APK)

- [ ] Settings → Battery → App launch → *mobile* → **Manage manually** →
      enable Auto-launch, Secondary launch, Run in background
- [ ] Settings → Apps → *mobile* → Battery → ignore battery optimizations
- [ ] Recents → padlock the app card

### All devices

- [ ] Android Settings → Apps → *mobile* → Permissions → Location →
      **Allow all the time**
- [ ] Settings → Apps → Special app access → Battery optimization → *mobile* →
      **Don't optimize**
- [ ] Location mode: high accuracy (GPS + network), not battery-saving mode

## 5. Verified locally vs. must-test-on-device

Verified in this environment (no device needed):

- Relay smoke test: valid position broadcast with exactly `{type,lat,lng,ts}`;
  `speed` message rejected (error to sender, nothing broadcast, nothing on
  disk, value never echoed); unknown keys stripped; garbage/out-of-range input
  answered with errors; NDJSON contains only accepted rows and no `speed`.
- `analyze.js` gap detection against a synthetic log with a planted 95 s gap.
- Mobile: `npx tsc --noEmit` clean; `npx expo export --platform android`
  bundles (666 modules); `npx expo config --type introspect` shows
  `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_LOCATION` landing in the manifest via the config plugins.

Must be tested on a physical Android device (cannot be verified here):

1. `npx expo run:android` native build compiles and installs (MapLibre +
   expo-location native modules).
2. Permission flow UX, including the "Allow all the time" settings redirect.
3. Foreground service actually keeps the task alive: screen locked, Waze in
   front, app swiped from recents (`killServiceOnDestroy: false`).
4. WebSocket delivery from the background task over mobile data, including
   reconnect after tunnel drops and MY↔SG carrier handover.
5. Adaptive cadence in the real world (5 s moving / 30 s stationary gate).
6. OpenFreeMap tiles render + dot follows the camera on-device.
7. The JB–SG drive itself: continuity + battery numbers (section 3) per OEM.
