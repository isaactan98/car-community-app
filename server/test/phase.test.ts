/**
 * R8 — the destination leg.
 *
 * The run is two legs, and the server owns the boundary between them: the
 * destination geofence, the one-way `gathering -> driving` transition derived
 * from where the members who checked in actually are, and which ETAs are
 * meaningful on each leg.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  startTestServer,
  type TestServer,
  api,
  joinMember,
  createRunFixture,
  WsClient,
  MEETUP,
  DEG_PER_METER_LAT,
} from './helpers.js';

/** Destination of the standard fixture (JB Kopitiam), ~13 km north of MEETUP. */
const DEST = { lat: 1.4655, lng: 103.7578 };

let t: TestServer;

beforeEach(async () => {
  t = await startTestServer();
});

afterEach(async () => {
  await t.stop();
});

/** Metres due north of a point, as a position message body. */
function northOf(point: { lat: number; lng: number }, meters: number, ts: number) {
  return { type: 'position', lat: point.lat + meters * DEG_PER_METER_LAT, lng: point.lng, ts };
}

async function activeRun() {
  const { run, alice, bob } = await createRunFixture(t);
  await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: alice.token, body: { carId: null } });
  await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: bob.token, body: { carId: null } });
  await api(t, 'POST', `/runs/${run.id}/start`, { token: alice.token });
  const wsAlice = new WsClient(t, alice.token, run.id);
  const wsBob = new WsClient(t, bob.token, run.id);
  await Promise.all([wsAlice.open(), wsBob.open()]);
  return { run, alice, bob, wsAlice, wsBob };
}

/** Put a member inside the meetup fence and wait for the check-in to land. */
async function checkIn(ws: WsClient, watcher: WsClient, memberId: string, ts: number) {
  ws.send(northOf(MEETUP, 50, ts));
  await watcher.next(
    (m) => m.type === 'member_arrived' && m.memberId === memberId,
    4000,
    'member_arrived',
  );
}

describe('run phase (gathering -> driving)', () => {
  it('starts every run gathering, and says so in REST and snapshots', async () => {
    const { run, wsAlice } = await activeRun();
    expect((await api(t, 'GET', `/runs/${run.id}`, { token: 'x' })).status).toBe(401);
    const snap = await wsAlice.next((m) => m.type === 'snapshot', 4000, 'snapshot');
    expect(snap.runPhase).toBe('gathering');
    expect(snap.members.every((m: any) => m.atDestination === false)).toBe(true);
    wsAlice.close();
  });

  it('stays gathering while a checked-in member only wanders around the meetup', async () => {
    const { run, alice, bob, wsAlice, wsBob } = await activeRun();
    const ts = Date.now();
    await checkIn(wsBob, wsAlice, bob.id, ts);
    await checkIn(wsAlice, wsAlice, alice.id, ts);

    // 300 m away is outside the 150 m fence but inside the 500 m departure
    // radius — walking to the shop, not leaving.
    wsBob.send(northOf(MEETUP, 300, ts + 1000));
    await wsAlice.nextAfterNow((m) => m.type === 'snapshot', 4000, 'snapshot');
    expect((await api(t, 'GET', `/runs/${run.id}`, { token: alice.token })).json.phase).toBe('gathering');
    expect(wsAlice.messages.some((m) => m.type === 'run_phase')).toBe(false);
    wsAlice.close();
    wsBob.close();
  });

  it('flips to driving once half the checked-in members are past the departure radius', async () => {
    const { run, alice, bob, wsAlice, wsBob } = await activeRun();
    const ts = Date.now();
    await checkIn(wsBob, wsAlice, bob.id, ts);
    await checkIn(wsAlice, wsAlice, alice.id, ts);

    // One of two, 2 km up the road: the convoy has left.
    wsBob.send(northOf(MEETUP, 2000, ts + 2000));
    const phase = await wsAlice.next((m) => m.type === 'run_phase', 4000, 'run_phase');
    expect(phase).toEqual({ type: 'run_phase', phase: 'driving' });

    const snap = await wsAlice.nextAfterNow(
      (m) => m.type === 'snapshot' && m.runPhase === 'driving',
      4000,
      'driving snapshot',
    );
    expect(snap.runPhase).toBe('driving');
    expect((await api(t, 'GET', `/runs/${run.id}`, { token: alice.token })).json.phase).toBe('driving');
    wsAlice.close();
    wsBob.close();
  });

  it('is one-way: coming back to the meetup does not re-open the gathering leg', async () => {
    const { run, alice, bob, wsAlice, wsBob } = await activeRun();
    const ts = Date.now();
    await checkIn(wsBob, wsAlice, bob.id, ts);
    wsBob.send(northOf(MEETUP, 2000, ts + 1000));
    await wsAlice.next((m) => m.type === 'run_phase', 4000, 'run_phase');

    wsBob.send(northOf(MEETUP, 20, ts + 2000));
    await wsAlice.nextAfterNow((m) => m.type === 'snapshot', 4000, 'snapshot');
    expect((await api(t, 'GET', `/runs/${run.id}`, { token: alice.token })).json.phase).toBe('driving');
    wsAlice.close();
    wsBob.close();
  });

  it('never leaves gathering when the run has no destination', async () => {
    const alice = await joinMember(t, 'Solo');
    const run = (
      await api(t, 'POST', '/runs', {
        token: alice.token,
        body: {
          name: 'Nowhere in particular',
          meetup: MEETUP,
          destination: null,
          startsAt: new Date().toISOString(),
        },
      })
    ).json;
    expect(run.phase).toBe('gathering');
    await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: alice.token, body: { carId: null } });
    await api(t, 'POST', `/runs/${run.id}/start`, { token: alice.token });

    const ws = new WsClient(t, alice.token, run.id);
    await ws.open();
    const ts = Date.now();
    await checkIn(ws, ws, alice.id, ts);
    ws.send(northOf(MEETUP, 30_000, ts + 1000));
    await ws.nextAfterNow((m) => m.type === 'snapshot', 4000, 'snapshot');

    expect(ws.messages.some((m) => m.type === 'run_phase')).toBe(false);
    expect((await api(t, 'GET', `/runs/${run.id}`, { token: alice.token })).json.phase).toBe('gathering');
    ws.close();
  });
});

describe('destination geofence', () => {
  it('flips atDestination and broadcasts member_at_destination', async () => {
    const { run, alice, bob, wsAlice, wsBob } = await activeRun();
    const ts = Date.now();
    await checkIn(wsBob, wsAlice, bob.id, ts);

    wsBob.send(northOf(DEST, 900, ts + 1000)); // still short of the fence
    await wsAlice.nextAfterNow((m) => m.type === 'snapshot', 4000, 'snapshot');
    expect(wsAlice.messages.some((m) => m.type === 'member_at_destination')).toBe(false);

    wsBob.send(northOf(DEST, 80, ts + 2000));
    const reached = await wsAlice.next(
      (m) => m.type === 'member_at_destination',
      4000,
      'member_at_destination',
    );
    expect(reached).toEqual({ type: 'member_at_destination', memberId: bob.id });

    const snap = await wsAlice.nextAfterNow(
      (m) => m.type === 'snapshot' && m.members.some((x: any) => x.memberId === bob.id && x.atDestination),
      4000,
      'atDestination snapshot',
    );
    expect(snap.members.find((m: any) => m.memberId === bob.id)).toMatchObject({
      status: 'arrived',
      atDestination: true,
      etaSeconds: null,
    });
    expect((await api(t, 'GET', `/runs/${run.id}`, { token: alice.token })).json.attendees).toContainEqual(
      expect.objectContaining({ memberId: bob.id, atDestination: true }),
    );
    wsAlice.close();
    wsBob.close();
  });

  it('checks in a member who skips the meetup and drives straight to the destination', async () => {
    const { bob, wsAlice, wsBob } = await activeRun();
    wsBob.send(northOf(DEST, 40, Date.now()));
    const reached = await wsAlice.next(
      (m) => m.type === 'member_at_destination',
      4000,
      'member_at_destination',
    );
    expect(reached.memberId).toBe(bob.id);

    const snap = await wsAlice.nextAfterNow(
      (m) => m.type === 'snapshot' && m.members.some((x: any) => x.memberId === bob.id && x.atDestination),
      4000,
      'atDestination snapshot',
    );
    // Never checked in at the meetup, and the two facts stay independent.
    expect(snap.members.find((m: any) => m.memberId === bob.id)).toMatchObject({
      status: 'rsvped',
      atDestination: true,
    });
    wsAlice.close();
    wsBob.close();
  });
});

describe('eta follows the sender’s leg', () => {
  it('accepts the meetup ETA before check-in, drops it after, then accepts the destination ETA', async () => {
    const { bob, wsAlice, wsBob } = await activeRun();
    const ts = Date.now();
    const bobIn = (snap: any) => snap.members.find((m: any) => m.memberId === bob.id);

    // Leg 1: still on the way to the meetup.
    wsBob.send(northOf(MEETUP, 5000, ts));
    wsBob.send({ type: 'eta', etaSeconds: 600 });
    let snap = await wsAlice.nextAfterNow(
      (m) => m.type === 'snapshot' && bobIn(m)?.etaSeconds === 600,
      4000,
      'meetup eta',
    );
    expect(bobIn(snap).etaSeconds).toBe(600);

    // Checked in and the group has not moved: an ETA now means nothing.
    await checkIn(wsBob, wsAlice, bob.id, ts + 1000);
    wsBob.send({ type: 'eta', etaSeconds: 123 });
    snap = await wsAlice.nextAfterNow(
      (m) => m.type === 'snapshot' && bobIn(m)?.status === 'arrived',
      4000,
      'arrived snapshot',
    );
    expect(bobIn(snap).etaSeconds).toBeNull();

    // Leg 2: the run has departed, so an ETA to the destination is meaningful.
    wsBob.send(northOf(MEETUP, 3000, ts + 2000));
    await wsAlice.next((m) => m.type === 'run_phase', 4000, 'run_phase');
    wsBob.send({ type: 'eta', etaSeconds: 900 });
    snap = await wsAlice.nextAfterNow(
      (m) => m.type === 'snapshot' && bobIn(m)?.etaSeconds === 900,
      4000,
      'destination eta',
    );
    expect(bobIn(snap).etaSeconds).toBe(900);

    // And it is spent once they are there.
    wsBob.send(northOf(DEST, 50, ts + 3000));
    await wsAlice.next((m) => m.type === 'member_at_destination', 4000, 'member_at_destination');
    wsBob.send({ type: 'eta', etaSeconds: 30 });
    snap = await wsAlice.nextAfterNow(
      (m) => m.type === 'snapshot' && bobIn(m)?.atDestination === true,
      4000,
      'final snapshot',
    );
    expect(bobIn(snap).etaSeconds).toBeNull();

    wsAlice.close();
    wsBob.close();
  });
});

describe('schema migration', () => {
  it('adds phase and at_destination to a database created before they existed', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { default: Database } = await import('better-sqlite3');
    const { openDb } = await import('../src/db.js');

    const dir = mkdtempSync(join(tmpdir(), 'runs-migrate-'));
    const path = join(dir, 'old.db');
    try {
      // The schema as it shipped before R8: no phase, no at_destination.
      const old = new Database(path);
      old.exec(`
        CREATE TABLE runs (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, creator_id TEXT NOT NULL,
          meetup_lat REAL NOT NULL, meetup_lng REAL NOT NULL, meetup_label TEXT NOT NULL,
          dest_lat REAL, dest_lng REAL, dest_label TEXT,
          starts_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'upcoming',
          created_at INTEGER NOT NULL, ended_at INTEGER, last_activity_at INTEGER
        );
        CREATE TABLE run_attendees (
          run_id TEXT NOT NULL, member_id TEXT NOT NULL, car_id TEXT,
          status TEXT NOT NULL DEFAULT 'rsvped', created_at INTEGER NOT NULL,
          PRIMARY KEY (run_id, member_id)
        );
        INSERT INTO runs (id, name, creator_id, meetup_lat, meetup_lng, meetup_label,
                          starts_at, state, created_at)
        VALUES ('r1', 'Old run', 'm1', 1.35, 103.8, 'Kranji', '2026-01-01T00:00:00Z', 'active', 1);
        INSERT INTO run_attendees (run_id, member_id, status, created_at)
        VALUES ('r1', 'm1', 'arrived', 1);
      `);
      old.close();

      const db = openDb(path);
      const columns = (table: string) =>
        (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
      expect(columns('runs')).toContain('phase');
      expect(columns('run_attendees')).toContain('at_destination');
      expect(columns('run_attendees')).toContain('at_destination_at');

      // Existing rows get the safe defaults, not nulls.
      expect(db.prepare("SELECT phase FROM runs WHERE id = 'r1'").get()).toEqual({ phase: 'gathering' });
      expect(
        db.prepare("SELECT at_destination FROM run_attendees WHERE run_id = 'r1'").get(),
      ).toEqual({ at_destination: 0 });

      db.close();
      // Idempotent: opening again must not throw on a duplicate column.
      const again = openDb(path);
      expect(
        (again.pragma('table_info(runs)') as { name: string }[]).filter((c) => c.name === 'phase'),
      ).toHaveLength(1);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
