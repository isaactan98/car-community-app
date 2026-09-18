# Building the iOS app without a Mac

The Android APK is built by CI on a Linux runner ([`app-apk.yml`](../.github/workflows/app-apk.yml)).
iOS cannot work that way: Apple only allows iOS binaries to be compiled and
signed on macOS. This repo has no macOS runner, and for a long stretch the only
way to ship an iPhone build was whichever Mac happened to be reachable — which
is how the iPhone ended up running a months-old binary while Android moved on.

[EAS Build](https://docs.expo.dev/build/setup/) removes the Mac from the loop:
it compiles and signs on Expo's macOS machines, driven from Windows, Linux, or
[`app-ios.yml`](../.github/workflows/app-ios.yml).

## The part that actually costs money

The build machine is the easy half. **Signing is the wall.**

To install a build on a physical iPhone you need a provisioning profile, and
what you can get depends on your Apple account:

| | Free Apple ID | Apple Developer Program |
|---|---|---|
| Profile validity | **7 days** | 12 months |
| Devices | 3 | 100 per year |
| Managed through | **Xcode — needs a Mac** | Apple's web portal, via EAS |
| Cost | $0 | **$99/year** |

Sources: [Apple — compare memberships](https://developer.apple.com/support/compare-memberships/),
[Apple — create an ad hoc provisioning profile](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/).
Checked September 2026.

So with a free account **and no Mac, there is no route** — the free tier's
profiles are issued and refreshed by Xcode. The $99/year membership is what
makes the whole no-Mac path work, and it also ends the 7-day reinstall treadmill
for everyone in the group.

EAS Build's own free tier is 15 iOS builds/month with a 45-minute timeout
([Expo plans](https://docs.expo.dev/billing/plans/), checked September 2026) —
ample here, since this is a handful of builds a month at most.

## One-time setup

1. Enrol in the [Apple Developer Program](https://developer.apple.com/programs/) ($99/year).
2. Create an Expo account and an access token (expo.dev → account → access tokens).
   Add it to the repo as the `EXPO_TOKEN` secret if you want to build from CI.
3. From any machine (Windows is fine):

   ```sh
   npm i -g eas-cli
   eas login
   cd app
   eas init                 # links this project to your Expo account
   eas device:create        # registers each tester's iPhone on the ad-hoc profile
   ```

   `eas device:create` prints a link or QR code. Every iPhone that will run the
   app has to open it once — an ad-hoc profile only works on devices listed in
   it, so a phone added later needs a **new build**, not just a new link.

## Building

```sh
cd app
eas build --platform ios --profile preview
```

Or run the **App iOS (EAS build)** workflow from the Actions tab. It is
`workflow_dispatch` only — iOS builds are deliberate, not something every push
to `main` should spend a build credit on.

Profiles live in [`app/eas.json`](../app/eas.json):

- **development** — dev client, for debugging against a Metro server.
- **preview** — what the group installs. Ad-hoc internal distribution.
- **production** — same shape; kept separate for when the tunnel cutover lands.

## The server URL

`EXPO_PUBLIC_SERVER_URL` is **inlined into the JS bundle at build time**. EAS
bundles on its own machines, so it does not see `.env.local` or your shell — it
reads the `env` block in `eas.json`. Change it there when the server moves.

If it is wrong the app still installs, still opens, still shows cached runs
behind an offline banner, and simply never reaches the server. To stop that
shipping, `npm run check:server-url` rejects any profile resolving to
localhost, and both CI and the build workflows run it.

## After installing

Open **Profile → Connection**. It shows the server URL the build was compiled
against, the live socket state, and the last WebSocket close code and reason.
If the app cannot reach the backend, that panel says why in one line — which is
faster than reading server logs, and much faster than guessing.

## Known iOS specifics

- **UIScene lifecycle.** SDK 57 apps must opt in or they launch to a black
  screen on the iOS 27 SDK. This is handled by `ios.enableSceneSupport` in the
  `expo-build-properties` plugin config, which requires `expo` ≥ 57.0.23 and
  `expo-build-properties` ≥ 57.0.20. Do **not** hand-write
  `UIApplicationSceneManifest` into `app.json` as well — the plugin throws when
  the app already declares one. See [expo/fyi](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md).
- **Cleartext HTTP.** `NSAllowsArbitraryLoads` is set so the tailnet `http://`
  and `ws://` URLs work. This has to come out at the tunnel cutover, along with
  Android's `usesCleartextTraffic` — see "Release Gates" in
  [`runs-v1-spec.md`](../runs-v1-spec.md).
- **Background location** needs "Always". With only "While Using", sharing stops
  the moment the screen locks: iOS suspends the app, where Android's foreground
  service keeps it alive.
