# Keeping Runs visible on Android (battery & background-location setup)

Runs shares your live position with a run **only while that run is active and
you've joined it** — never otherwise. For the group to actually see you when
you're driving, Android has to let the app keep updating your location *with
the screen off and Waze in front*. Two things must be true:

1. **Location permission is set to "Allow all the time"** (not just "While
   using the app").
2. **The phone's battery saver isn't killing the app** in the background.

Stock Android (Pixel) usually just works once #1 is granted. Many phones
popular in MY/SG — Xiaomi, Oppo, Realme, Vivo, Samsung, Huawei — ship
aggressive battery savers that stop background apps even with permission
granted. Do the per-brand steps below **once** and you're set.

> If your position keeps going stale for the group even after this, tell Isaac
> your exact phone model — we expand this guide as real devices reveal quirks.

> **Tailnet-phase testers:** the server is only reachable over Tailscale for
> now — do the [tailnet tester setup](tailnet-tester-setup.md) (install,
> invite, `/healthz` check, one-VPN-at-a-time warning) before any drive.

---

## 1. Allow location "all the time" (every phone)

Runs will prompt you in-app the first time you join an active run. If you
missed it or tapped the wrong thing:

**Settings → Apps → Runs → Permissions → Location → _Allow all the time_.**

Also set **Location → Use precise location: On** so the map dot is accurate.

You can confirm it worked: while sharing, Android shows a persistent
notification — **"Runs — sharing location"** naming the active run. That
notification is your privacy indicator; when it's gone, you're not sharing.

## 2. Stop the battery saver from killing Runs (per brand)

Find your brand below. Menu names drift between versions — if a label doesn't
match exactly, search your Settings for the **bold** term.

### Stock Android / Google Pixel / Motorola / Nokia
- **Settings → Apps → Runs → Battery → _Unrestricted_.**
- That's usually all that's needed.

### Samsung (One UI)
- **Settings → Battery → Background usage limits** → make sure Runs is **not**
  in "Sleeping apps" or "Deep sleeping apps".
- **Settings → Apps → Runs → Battery → _Unrestricted_.**
- Optional: turn off **Settings → Battery → Adaptive battery** if it keeps
  re-sleeping the app.

### Xiaomi / Redmi / POCO (MIUI / HyperOS)
- **Settings → Apps → Runs → Battery saver → _No restrictions_.**
- **Settings → Apps → Runs → Autostart → On.**
- In Recents, pull down on the Runs card and tap the **lock** icon so the
  system doesn't clear it.

### Oppo / Realme / OnePlus (ColorOS / OxygenOS)
- **Settings → Battery → Runs → _Allow background activity_** and disable any
  "Sleep"/"Optimize" toggle.
- **Settings → Apps → Auto-launch / Startup manager → enable Runs.**
- Lock the Runs card in Recents.

### Vivo / iQOO (Funtouch OS / OriginOS)
- **Settings → Battery → High background power consumption → allow Runs.**
- **Settings → Apps → Autostart → enable Runs.**
- **Settings → Apps → Runs → Battery → allow background activity.**

### Huawei / Honor (EMUI / Magic OS)
- **Settings → Apps → Runs → Battery → App launch** → switch to **Manage
  manually** and enable **Auto-launch**, **Secondary launch**, and **Run in
  background**.

### Asus (ZenUI) / others with "Auto-start manager"
- Open the **Auto-start manager** (or **Mobile Manager → Boost**) and allow
  Runs to start and run in the background.

## 3. Quick self-test before a real drive

1. Join an active run (or a test run you started).
2. Confirm the **"Runs — sharing location"** notification appears.
3. Lock the screen, open Waze, and walk/drive around for ~5 minutes.
4. Ask someone on the run (or check the live map on a second phone) that your
   dot keeps moving. No movement after ~1 minute = a battery setting above is
   still blocking it.

## If it still stops

- Re-check permission is **Allow all the time**, not "While using".
- Re-check the brand steps — some phones reset these after an OS update.
- Disable any third-party "cleaner"/"booster" app, which can kill Runs too.
- Send Isaac your phone brand + model and roughly when the dot went stale.
