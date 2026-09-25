# Joining the Runs beta (tester setup)

Runs talks to its server over the public internet at
`https://cca-backend.isaactan.work`, through a Cloudflare Tunnel. You do **not**
need Tailscale or any VPN any more. Mobile data or any Wi‑Fi works. Do these
steps once, before your first run.

## 1. Install the app

**Android:** open the APK link Isaac sends you. The first time, Android asks
you to allow your browser (or chat app) to **install unknown apps**. Allow it
for that one app, install Runs, then switch the setting off again if you like.
Later versions install over the top from the same link, and you stay signed in.

**iPhone:** your phone has to be registered on the build before it can install
it. Isaac sends you a registration link first, then an install link once the
new build is ready. A phone registered after a build was made needs a new build.
See [`ios-build.md`](ios-build.md).

## 2. Check you can reach the server, before you drive

Open the phone's browser and load:

```
https://cca-backend.isaactan.work/healthz
```

You should see `{"ok":true}`. **If this page doesn't load, the app won't work
either.** Sort it out before you set off, not on the highway. Usual causes:

- No data connection, or a captive-portal Wi‑Fi you haven't signed in to.
- A private-DNS, ad-block, or work VPN/MDM app blocking the domain. Try
  switching it off and reloading.

## 3. Sign in with your invite code

Open Runs and enter the invite code Isaac gives you. A `runs://` invite link
fills it in for you.

## 4. Battery setup (Android)

Background location has its own Android traps. Do the one-time steps in
[`android-battery-setup.md`](android-battery-setup.md) as well. On iPhone, set
location to **Always** when Runs asks. With "While Using", sharing stops when
the screen locks.
