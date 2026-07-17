/**
 * AsyncStorage persistence: auth token, member identity, and the degraded-
 * mode cache (last run objects + last snapshots, R6). All reads are
 * fail-soft — a corrupt or missing entry returns null, never throws.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Member, Run, SnapshotMessage } from "../api/types";

const KEY_TOKEN = "runs.token";
const KEY_MEMBER = "runs.member";
const KEY_RUN_LIST = "runs.cache.runList";
const keyRun = (runId: string) => `runs.cache.run.${runId}`;
const keySnapshot = (runId: string) => `runs.cache.snapshot.${runId}`;

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Cache writes are best-effort.
  }
}

// ---- auth ----

export async function saveSession(token: string, member: Member) {
  await AsyncStorage.multiSet([
    [KEY_TOKEN, token],
    [KEY_MEMBER, JSON.stringify(member)],
  ]);
}

export async function loadToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_TOKEN);
  } catch {
    return null;
  }
}

export async function loadMember(): Promise<Member | null> {
  return readJson<Member>(KEY_MEMBER);
}

export async function clearSession() {
  try {
    await AsyncStorage.multiRemove([KEY_TOKEN, KEY_MEMBER]);
  } catch {
    // best-effort
  }
}

// ---- degraded-mode cache (R6) ----

export async function cacheRunList(runs: Run[]) {
  await writeJson(KEY_RUN_LIST, runs);
}

export async function loadCachedRunList(): Promise<Run[] | null> {
  return readJson<Run[]>(KEY_RUN_LIST);
}

export async function cacheRun(run: Run) {
  await writeJson(keyRun(run.id), run);
}

export async function loadCachedRun(runId: string): Promise<Run | null> {
  return readJson<Run>(keyRun(runId));
}

interface CachedSnapshot {
  snapshot: SnapshotMessage;
  savedAt: number;
}

export async function cacheSnapshot(runId: string, snapshot: SnapshotMessage) {
  await writeJson(keySnapshot(runId), {
    snapshot,
    savedAt: Date.now(),
  } satisfies CachedSnapshot);
}

export async function loadCachedSnapshot(
  runId: string,
): Promise<CachedSnapshot | null> {
  return readJson<CachedSnapshot>(keySnapshot(runId));
}
