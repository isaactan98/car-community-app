# Runs — private car group app

Coordination app for a private car friend group: set a meet, RSVP with your
car, get auto-checked-in at the meetup point, and see everyone's live position
on a group drive — so nobody types "otw", "reached", or "where r u" in
WhatsApp again.

**Scope is contract-driven:** [runs-v1-spec.md](runs-v1-spec.md) is the source
of truth. Hard constraints: **no speed is ever stored or transmitted**,
leaderless runs, invite-code auth only, location shared only during an active
run, graceful degradation when the backend is down.

## Repo layout

| Path | What it is |
|---|---|
| [`server/`](server/) | Node + TypeScript backend — REST + WebSocket, SQLite, invite-code auth. Ships as a Docker image. |
| [`app/`](app/) | React Native + Expo (Android) app — runs, RSVP, arrival board, live MapLibre map, Waze handoff. Ships as an APK. |
| [`spike-m0/`](spike-m0/) | M0 background-location spike (kill-switch milestone): bare tracker app + tiny WS relay + JB–SG drive test protocol. |
| [`docs/CONTRACT.md`](docs/CONTRACT.md) | The API contract both `server/` and `app/` are built against. Change it first, then the code. |
| [`runs-v1-spec.md`](runs-v1-spec.md) | Product spec + guardrails. |

## Quickstart (dev)

**Backend** — Node 22+:

```sh
cd server
npm install
npm run invite:create      # prints an invite code, e.g. RUNS-DE94E937
npm run dev                # http://localhost:4000, SQLite at data/runs.db
npm test                   # 26 integration tests (HTTP + WS)
```

**App** — needs a dev build (Expo Go can't run MapLibre or background location):

```sh
cd app
npm install
# set your server URL in src/config.ts (LAN IP or tunnel URL)
npx expo run:android       # requires Android Studio / SDK + a device
```

**M0 spike** — see [spike-m0/README.md](spike-m0/README.md) for the relay,
the tracker app, and the JB–SG drive test protocol.

## Deployment

### Backend → Docker (GHCR)

Every push to `main` that touches `server/` publishes
`ghcr.io/isaactan98/car-community-app/server:latest` (linux/amd64 + arm64). Tags `v*`
additionally publish semver tags. On the homelab:

`server/docker-compose.yml` runs in one of two modes (see the file header):

```sh
cd server
cp .env.example .env   # set TAILNET_IP; add TUNNEL_TOKEN for production

# STAGING / JB — tailnet-only (default; docker-compose.override.yml auto-loads):
docker compose up -d

# PRODUCTION / SG — Cloudflare Tunnel, no host port published at all:
docker compose -f docker-compose.yml --profile tunnel up -d
```

In tunnel mode a bundled `cloudflared` container (remotely-managed tunnel;
token in `server/.env`) reaches the server over the compose network. Configure
the ingress in the Zero Trust dashboard: `https://runs.<domain>` →
`http://server:4000` — WebSockets are proxied by default. Health probe:
`GET /healthz`. All env vars (`PORT`, `DB_PATH`, `GEOFENCE_RADIUS_M`, timers…)
are documented in [server/README.md](server/README.md).

**Release gate:** no APK goes beyond the tailnet inner circle until the tunnel
cutover is live — see "Release Gates" in [runs-v1-spec.md](runs-v1-spec.md).

#### Manual failover (SG down → serve from JB)

No automatic failover by design (R6 degraded mode covers the outage window).
The tunnel is remotely managed, so any box running `cloudflared` with the same
token serves `runs.<domain>`:

1. On JB, stop the staging stack: `cd server && docker compose down`.
2. Restore the newest off-site backup: `cp data/backup-<latest>.db data/runs.db`.
3. Put the production `TUNNEL_TOKEN` into JB's `server/.env`.
4. Start tunnel mode on JB: `docker compose -f docker-compose.yml --profile tunnel up -d`.
5. Verify `https://runs.<domain>/healthz`, tell the group; reverse the steps
   (newest backup back onto SG) when SG returns.

Rehearse this once before you need it — an untested backup is a wish, not a
backup.

#### Watchdog + nightly off-site backup

- **Watchdog (on JB):** run [Uptime Kuma](https://github.com/louislam/uptime-kuma)
  checking `https://runs.<domain>/healthz` every 30–60 s with Telegram (or
  push) alerting. After setup, stop the SG stack once on purpose and confirm
  the alert fires within 2 minutes — test the alarm, don't trust it.
- **Backups (on SG):** nightly cron runs `scripts/backup-db.sh` with
  `BACKUP_PUSH_DEST` pointed at JB over the tailnet (hot `VACUUM INTO` backup,
  scp push, local retention prune — cron line in the script header).

> If the repo is private, the GHCR package is too: either make the package
> public (Package settings → Change visibility) or `docker login ghcr.io`
> on the server with a PAT that has `read:packages`.

### App → APK

- **Beta builds:** every push to `main` touching `app/` uploads a `runs-apk`
  artifact (Actions tab → run → Artifacts).
- **Releases:** pushing a tag like `v1.0.0` builds the APK, signs it, and
  attaches it to a GitHub Release. Stable link for the group chat:

  ```
  https://github.com/isaactan98/car-community-app/releases/latest/download/runs.apk
  ```

APKs are signed with the release keystore when the three `ANDROID_*` secrets
are set — see [credentials/README.md](credentials/README.md) (local-only
directory, never committed). Without them, builds fall back to the shared RN
debug key: installable, but don't distribute those to the group.

## CI

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | every push / PR | server tests, app typecheck + tests, relay smoke test |
| `server-docker.yml` | push to `main` touching `server/` | build + push `server:latest` to GHCR |
| `app-apk.yml` | push to `main` touching `app/` | build APK, upload as artifact |
| `release.yml` | tag `v*` | semver Docker image + signed APK attached to a GitHub Release |

## Releasing

```sh
git tag v1.0.0
git push origin v1.0.0
```

## What still needs a human

- **M0 drive test** (the kill-switch): real phone, real JB–SG drive, battery
  numbers — protocol in [spike-m0/README.md](spike-m0/README.md).
- **OEM battery exemptions** on the group's phones (Xiaomi/Samsung/Oppo/
  Vivo/Huawei steps in the spike README) — background tracking dies without
  them on some devices.
