# Joining a run as a tailnet tester (inner-circle phase)

Until the public endpoint goes live (see "Release Gates" in
[`runs-v1-spec.md`](../runs-v1-spec.md)), the Runs server is reachable **only
over Tailscale**. If your phone isn't on the tailnet, the app cannot connect —
that's intentional. Do these steps once, before any drive.

## 1. Install Tailscale and accept the invite

1. Install **Tailscale** from the Play Store.
2. Open the tailnet **invite link** Isaac sends you and sign in with the
   account it prompts for. Your phone should appear as "Connected" in the
   Tailscale app.
3. Leave Tailscale **on**. The app only needs it during runs, but there is no
   harm keeping it connected — it's a peer-to-peer VPN, your traffic does not
   route through anyone's homelab.

## 2. Verify you can reach the server — before you drive

Open the phone browser and load:

```
http://<TAILNET_IP>:4000/healthz
```

(Isaac gives you the actual IP with the invite.) You should see a healthy
response. **If this page does not load, the app will not work either** — fix
this at the kerb, not on the highway. Usual causes:

- Tailscale is off, or you never accepted the invite.
- Another VPN is fighting Tailscale — see the warning below.

## ⚠️ Android runs ONE VPN at a time

Android allows a single active VPN. Tailscale counts as one. If you run a
**work VPN, a proxy app, a private-DNS/ad-block app (e.g. some configurations
of NextDNS, Blokada), or a corporate MDM profile with VPN**, it will silently
kick Tailscale off (or vice versa) and the server becomes unreachable
mid-drive.

**Before every run: disable any other VPN/proxy app, confirm Tailscale shows
"Connected", and re-check the `/healthz` page.**

## 3. Battery setup

Background location has its own set of Android traps — do the (one-time)
steps in [`android-battery-setup.md`](android-battery-setup.md) as well.
