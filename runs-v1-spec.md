# Runs — v1 Spec (Private Car Group App)

**Status:** Draft v1 · **Owner:** Isaac · **Date:** 17 Jul 2026
**Purpose:** Product spec and AI-agent guardrails. This document is the source of truth for scope. Anything not listed as P0/P1 is out of scope. Agents must not add features beyond this spec.

## Problem Statement

A 50+ person car friend group coordinates meets and drives entirely through a WhatsApp group. Every meet generates dozens of "otw", "reaching", "who else coming?" messages; on drives, nobody knows where anyone is without texting while driving. There is no convoy leader — the group culture is "set a place and go." Existing convoy apps (Convoy, Convoy Tracker, Group Ride) are Western, convoy-leader-centric, and none of the group uses them.

## Goals

1. Replace pre-meet WhatsApp status spam: at least one real meetup where the arrival board answers "who's here / who's coming / ETA" with zero status messages typed.
2. Replace mid-drive "where r u" texting: at least one real group drive completed with live positions visible and no location-asking messages in WhatsApp.
3. Get 10+ of the 50-person group to install and join a run within the first month of the beta APK.
4. Prove background location works reliably on Android across a JB–SG-length drive with acceptable battery drain (target defined in M0).

## Non-Goals (v1) — scope armor, do not breach

- **No in-app chat.** WhatsApp keeps that job in v1. Chat (parked-mode + TTS readout) is v2+.
- **No push-to-talk / voice.** v2+.
- **No turn-by-turn navigation.** App hands off to Waze via deep links. Embedded nav is v3 at earliest.
- **No iOS build.** Android-first; iOS waits for demand signal + $99 budget.
- **No public signup / discovery / community features.** Invite-code only, private group tool.
- **No "racing" features of any kind on public roads.** Track mode (geofenced to circuits) is a future consideration, not v1.
- **No CarPlay / Android Auto.** Future consideration.

## Hard Constraints (the constitution — every agent session inherits these)

1. **Never store speed.** No speed values persisted anywhere — not in position history, replays, stats, or logs. Position + timestamp only. This is a legal-risk decision, not a technical one. Non-negotiable.
2. **Leaderless by default.** A run has a creator, not a "leader." No mandatory roles. Optional roles may come later (P2), never required.
3. **Invite-code auth only.** No email/password, no OAuth, no public registration.
4. **Data minimization.** Position history retained only as long as needed for the active run + replay; define retention in M2. Location shared only during an active run — never ambient background tracking.
5. **Graceful degradation.** If the backend is unreachable mid-run (homelab outage), the app must show last-known positions with a staleness indicator and keep destination/Waze links working. A dead server must never produce a blank screen.
6. **Stack is fixed:** React Native + Expo (Android target) · MapLibre + free tile source (OpenFreeMap/Protomaps) · Node + WebSocket backend · self-hosted on homelab behind Cloudflare Tunnel · invite-code auth · Expo push notifications. Do not substitute Mapbox or Google Maps SDKs (licensing/pricing landmines documented separately).

## Users

- **Primary:** Isaac (builder + organizer of first runs).
- **Beta group:** 50+ member car friend group (Android users first), MY/SG, meets organized informally with no lead.

## User Stories (priority order)

1. As a run creator, I want to set a place, date/time, and Waze pin so the group knows where and when without a wall of text.
2. As a group member, I want to RSVP with the car I'm bringing so everyone knows who and what is coming.
3. As an attendee, I want to be auto-checked-in when I reach the meetup point (geofence) so I never have to type "reached."
4. As an attendee still on the way, I want my live ETA visible on the arrival board so nobody has to ask.
5. As a driver during a run, I want to see everyone's live position on a map, glanceable in under a second, so I know where the group is without touching my phone.
6. As a driver, I want one tap to open the destination/regroup point in Waze so navigation stays out of this app's scope.
7. As a member, I want location sharing to start when I join an active run and stop when the run ends, so I'm never tracked outside runs.

## Requirements

### P0 — Must have (v1 cannot ship without)

**R1. Run lifecycle**
- [ ] Create run: name, meetup location (map pick), destination (optional), date/time
- [ ] Run states: upcoming → active → ended (creator or auto-end after inactivity)
- [ ] Share run via invite code / deep link into the app

**R2. RSVP**
- [ ] Join/leave a run; pick which car you're bringing (simple garage: name + model, free text)
- [ ] Attendee list visible to all members of the run

**R3. Arrival board**
- [ ] Geofence around meetup point triggers auto check-in ("arrived")
- [ ] Board shows: arrived count (e.g., 12/18), arrived list, incoming list with live ETA
- [ ] Given a member has RSVP'd and the run is active, when they enter the geofence, then their status flips to arrived with no user action

**R4. Live map (active run)**
- [ ] All participants' live positions on MapLibre map, updating in near-real-time
- [ ] Background location on Android: positions keep updating with app backgrounded / screen locked / Waze in foreground (foreground service + notification)
- [ ] Staleness indicator per dot when a member's updates stop (offline / app killed)
- [ ] Distance to the car ahead of me along the group's direction of travel (simple version acceptable)

**R5. Waze handoff**
- [ ] One-tap deep link to Waze for meetup point, destination, and any member's last position

**R6. Degraded mode**
- [ ] Given the backend is unreachable, when the user opens an active run, then last-known positions render with timestamps and Waze links still work

**R7. Privacy controls**
- [ ] Location sharing only while a run is active and user has joined it; hard stop on run end or leave
- [ ] No speed stored (see Hard Constraint 1) — negative test: DB and logs contain no speed fields

### P1 — Nice to have (fast follow)

- [ ] Regroup pin: any member drops a pin, everyone gets a push + one-tap Waze link
- [ ] Fall-behind alert: notify run participants when a member drops more than X km behind the group
- [ ] Post-run recap: route line replay (positions only), distance, duration — no speed
- [ ] Trip cost split: tolls + fuel estimate per run, split across cars, SGD and MYR

### P2 — Future considerations (design for, don't build)

- Optional roles (sweeper/marshal) for structured convoys — schema should allow roles later without migration pain
- Parked-mode chat + TTS readout while driving; PTT voice
- iOS build (TestFlight, $99/yr, 90-day build refresh treadmill)
- Track mode geofenced to circuits (e.g., Sepang)
- Embedded turn-by-turn (requires resolving Mapbox vehicle-usage license or Google Nav SDK cost)

## Milestones & Definitions of Done

**M0 — Background location spike (before any product code)**
Bare Expo app + WebSocket relay + one moving dot.
DoD: phone in car, app backgrounded, screen locked, Waze on top, full JB–SG commute tracked end-to-end on the server; battery drain measured and recorded. **Kill-switch milestone: if unreliable, project pivots here.**

**M1 — Runs + arrival board**
R1, R2, R3, R7 complete.
DoD: dogfooded at one real static meetup with 5+ friends; zero "reached"/"otw" messages needed.

**M2 — Live drive map**
R4, R5, R6 complete.
DoD: one real group drive where nobody opens WhatsApp to ask where anyone is.

## Release Gates

No APK may be distributed beyond the tailnet inner circle until Workstream B
is cut over: Cloudflare Tunnel live, `EXPO_PUBLIC_SERVER_URL` on `https://`,
realtime on `wss://`, `usesCleartextTraffic` removed.

(Workstreams defined in the Network Hardening iteration spec: A = tailnet
hardening, ships immediately; B = Cloudflare Tunnel + SG production cutover,
the group-release gate above.)

## Success Metrics

- Leading: installs from the group (target 10+ in month 1); % of run attendees auto-checked-in vs manually announced; location update continuity during M2 drive (>95% of participants with <60s staleness).
- Lagging: runs organized in-app per month; "where r u"-type messages in the WhatsApp group during runs (should visibly drop); iOS members asking for the app (v2 demand signal).

## Risks

| Risk | Mitigation |
|---|---|
| Android background location killed by OEM battery savers (common on Chinese-brand phones popular in MY/SG) | M0 tests on the group's real device mix; document per-OEM battery-exemption steps in onboarding |
| Homelab/ISP outage mid-run | Cloudflare Tunnel + R6 degraded mode; revisit VPS if outages hit a real run |
| Sideload friction ("install unknown apps") | Onboarding message + screenshots for the group chat; keep APK link stable |
| Battery drain complaints | Adaptive update frequency (slower when stationary); measure in M0, set budget |
| AI-agent scope creep | This spec is the contract; anything outside P0/P1 requires editing this document first |

## Open Questions

- What is the group's actual Android/iOS split? (Isaac — poll the group; sets v2 urgency)
- Acceptable battery budget for a 4-hour run? (decide from M0 data)
- Position history retention period after run ends? (decide in M2; default to shortest useful)
- EAS build free-tier limits sufficient for this cadence, or build locally? (verify current Expo pricing before M0)
