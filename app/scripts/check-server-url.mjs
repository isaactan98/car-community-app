/**
 * Fail a build that would ship pointing at nothing.
 *
 * `EXPO_PUBLIC_SERVER_URL` is inlined into the JS bundle at build time, and
 * `src/config.ts` falls back to `http://localhost:4000` when it is unset. On a
 * phone that means the phone itself, so the app installs, opens, signs in from
 * cache and looks almost normal — it just never reaches the server. That is a
 * genuinely expensive failure to diagnose after the fact, and it is trivial to
 * catch here.
 *
 * Usage:
 *   node scripts/check-server-url.mjs          validate every eas.json profile
 *   node scripts/check-server-url.mjs --env    also require a sane process env
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOOPBACK = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i;

/** Why this value cannot ship, or null if it is fine. */
function reject(url) {
  if (!url) return "not set (the bundle would fall back to http://localhost:4000)";
  if (LOOPBACK.test(url)) return `points at the device itself (${url})`;
  try {
    new URL(url);
  } catch {
    return `is not a valid URL (${url})`;
  }
  return null;
}

/** Resolve a profile's env through its `extends` chain, nearest wins. */
function resolveEnv(profiles, name, seen = new Set()) {
  const profile = profiles[name];
  if (!profile || seen.has(name)) return {};
  seen.add(name);
  const inherited = profile.extends ? resolveEnv(profiles, profile.extends, seen) : {};
  return { ...inherited, ...(profile.env ?? {}) };
}

const failures = [];

let easProfiles = {};
try {
  easProfiles = JSON.parse(readFileSync(join(APP_DIR, "eas.json"), "utf8")).build ?? {};
} catch (err) {
  console.error(`check-server-url: could not read eas.json — ${err.message}`);
  process.exit(1);
}

for (const name of Object.keys(easProfiles)) {
  // `base` exists only to be extended; it is never built directly.
  if (name === "base") continue;
  const url = resolveEnv(easProfiles, name).EXPO_PUBLIC_SERVER_URL;
  const why = reject(url);
  if (why) failures.push(`eas.json profile "${name}": EXPO_PUBLIC_SERVER_URL ${why}`);
}

if (process.argv.includes("--env")) {
  const why = reject(process.env.EXPO_PUBLIC_SERVER_URL);
  if (why) failures.push(`environment: EXPO_PUBLIC_SERVER_URL ${why}`);
}

if (failures.length > 0) {
  console.error("check-server-url: refusing to build.\n");
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nSet a URL the phone can actually reach — the tailnet address, or the" +
      "\npublic tunnel once it is live. See app/.env.example.",
  );
  process.exit(1);
}

console.log("check-server-url: ok");
