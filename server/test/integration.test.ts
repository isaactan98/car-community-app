import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startTestServer,
  type TestServer,
  api,
  joinMember,
  createRunFixture,
  WsClient,
  MEETUP,
  DEG_PER_METER_LAT,
  INVITE,
} from './helpers.js';

let t: TestServer;

beforeAll(async () => {
  t = await startTestServer();
});

afterAll(async () => {
  await t.stop();
});

describe('auth / invite join flow', () => {
  it('rejects a bad invite code with 401', async () => {
    const res = await api(t, 'POST', '/auth/join', { body: { inviteCode: 'NOPE', displayName: 'X' } });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid body with 400', async () => {
    const res = await api(t, 'POST', '/auth/join', { body: { inviteCode: INVITE } });
    expect(res.status).toBe(400);
  });

  it('joins with a valid code and returns a long-lived token + member', async () => {
    const res = await api(t, 'POST', '/auth/join', {
      body: { inviteCode: INVITE, displayName: 'Isaac' },
    });
    expect(res.status).toBe(200);
    expect(res.json.token).toBeTypeOf('string');
    expect(res.json.token.length).toBeGreaterThan(20);
    expect(res.json.member).toMatchObject({ displayName: 'Isaac' });

    const me = await api(t, 'GET', '/me', { token: res.json.token });
    expect(me.status).toBe(200);
    expect(me.json).toEqual({ id: res.json.member.id, displayName: 'Isaac', cars: [] });
  });

  it('requires a bearer token on protected routes', async () => {
    expect((await api(t, 'GET', '/me')).status).toBe(401);
    expect((await api(t, 'GET', '/runs', { token: 'bogus' })).status).toBe(401);
  });
});

describe('garage', () => {
  it('adds, lists, and deletes cars', async () => {
    const m = await joinMember(t, 'GarageGuy');
    const car = (await api(t, 'POST', '/me/cars', { token: m.token, body: { name: 'FD2 Civic Type R' } })).json;
    expect(car).toMatchObject({ name: 'FD2 Civic Type R' });

    const me = await api(t, 'GET', '/me', { token: m.token });
    expect(me.json.cars).toEqual([{ id: car.id, name: 'FD2 Civic Type R' }]);

    const del = await api(t, 'DELETE', `/me/cars/${car.id}`, { token: m.token });
    expect(del.status).toBe(200);
    expect((await api(t, 'GET', '/me', { token: m.token })).json.cars).toEqual([]);
  });

  it("cannot delete another member's car", async () => {
    const a = await joinMember(t, 'OwnerA');
    const b = await joinMember(t, 'OwnerB');
    const car = (await api(t, 'POST', '/me/cars', { token: a.token, body: { name: 'GR86' } })).json;
    expect((await api(t, 'DELETE', `/me/cars/${car.id}`, { token: b.token })).status).toBe(404);
  });
});

describe('runs CRUD + rsvp + lifecycle', () => {
  it('creates a run matching the contract shape', async () => {
    const { run, alice } = await createRunFixture(t);
    expect(run).toMatchObject({
      name: 'JB Breakfast Run',
      creatorId: alice.id,
      meetup: MEETUP,
      destination: { lat: 1.4655, lng: 103.7578, label: 'JB Kopitiam' },
      state: 'upcoming',
      attendees: [],
    });
    expect(run.inviteDeepLink).toBe(`runs://run/${run.id}`);
    expect(Date.parse(run.startsAt)).toBeGreaterThan(Date.now());

    const fetched = await api(t, 'GET', `/runs/${run.id}`, { token: alice.token });
    expect(fetched.json).toEqual(run);
  });

  it('validates create body', async () => {
    const m = await joinMember(t, 'Validator');
    const bad = await api(t, 'POST', '/runs', {
      token: m.token,
      body: { name: 'No meetup', startsAt: new Date().toISOString() },
    });
    expect(bad.status).toBe(400);
    const badLat = await api(t, 'POST', '/runs', {
      token: m.token,
      body: { name: 'Bad lat', meetup: { lat: 999, lng: 0, label: 'x' }, startsAt: new Date().toISOString() },
    });
    expect(badLat.status).toBe(400);
  });

  it('rsvp is idempotent, supports carId, and rejects foreign cars', async () => {
    const { run, alice, bob, car } = await createRunFixture(t);

    const r1 = await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: bob.token, body: { carId: car.id } });
    expect(r1.status).toBe(200);
    const r2 = await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: bob.token, body: { carId: car.id } });
    expect(r2.status).toBe(200);
    expect(r2.json.attendees).toEqual([
      { memberId: bob.id, displayName: 'Bob', carName: 'ND2 MX-5', status: 'rsvped' },
    ]);

    // Alice may not RSVP with Bob's car.
    const foreign = await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: alice.token, body: { carId: car.id } });
    expect(foreign.status).toBe(400);

    // carId null is fine.
    const noCar = await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: alice.token, body: { carId: null } });
    expect(noCar.status).toBe(200);
    expect(noCar.json.attendees).toHaveLength(2);
  });

  it('only the creator can start/end; lifecycle upcoming -> active -> ended', async () => {
    const { run, alice, bob } = await createRunFixture(t);
    expect((await api(t, 'POST', `/runs/${run.id}/start`, { token: bob.token })).status).toBe(403);

    const started = await api(t, 'POST', `/runs/${run.id}/start`, { token: alice.token });
    expect(started.status).toBe(200);
    expect(started.json.state).toBe('active');

    expect((await api(t, 'POST', `/runs/${run.id}/end`, { token: bob.token })).status).toBe(403);
    const ended = await api(t, 'POST', `/runs/${run.id}/end`, { token: alice.token });
    expect(ended.json.state).toBe('ended');

    // RSVP after end is rejected.
    expect((await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: bob.token, body: { carId: null } })).status).toBe(409);
  });

  it('lists upcoming + active before ended', async () => {
    const { run, alice } = await createRunFixture(t);
    await api(t, 'POST', `/runs/${run.id}/start`, { token: alice.token });
    await api(t, 'POST', `/runs/${run.id}/end`, { token: alice.token });
    const { run: liveRun } = await createRunFixture(t);

    const list = await api(t, 'GET', '/runs', { token: alice.token });
    const ids = list.json.map((r: any) => r.id);
    expect(ids).toContain(run.id);
    expect(ids).toContain(liveRun.id);
    const endedIdx = ids.indexOf(run.id);
    const upcomingIdx = ids.indexOf(liveRun.id);
    expect(upcomingIdx).toBeLessThan(endedIdx);
  });
});

describe('websocket realtime', () => {
  async function activeRunWithSockets() {
    const { run, alice, bob, car } = await createRunFixture(t);
    await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: alice.token, body: { carId: null } });
    await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: bob.token, body: { carId: car.id } });
    await api(t, 'POST', `/runs/${run.id}/start`, { token: alice.token });
    const wsAlice = new WsClient(t, alice.token, run.id);
    const wsBob = new WsClient(t, bob.token, run.id);
    await Promise.all([wsAlice.open(), wsBob.open()]);
    return { run, alice, bob, car, wsAlice, wsBob };
  }

  it('rejects WS upgrade with a bad token or when not joined', async () => {
    const { run } = await createRunFixture(t);
    const outsider = await joinMember(t, 'Outsider');

    const badToken = new WsClient(t, 'bogus-token', run.id);
    await expect(badToken.open()).rejects.toThrow(/401/);

    const notJoined = new WsClient(t, outsider.token, run.id);
    await expect(notJoined.open()).rejects.toThrow(/403/);
  });

  it('sends a snapshot on connect and broadcasts position updates in ~5s snapshots', async () => {
    const { bob, wsAlice, wsBob } = await activeRunWithSockets();

    const first = await wsAlice.next((m) => m.type === 'snapshot', 4000, 'initial snapshot');
    expect(first.runState).toBe('active');
    expect(first.members).toHaveLength(2);
    const bobRow = first.members.find((m: any) => m.memberId === bob.id);
    expect(bobRow).toMatchObject({ displayName: 'Bob', carName: 'ND2 MX-5', status: 'rsvped', lastPosition: null, etaSeconds: null });

    // Bob reports a position ~5 km from the meetup + an ETA.
    const ts = Date.now();
    wsBob.send({ type: 'position', lat: MEETUP.lat + 5000 * DEG_PER_METER_LAT, lng: MEETUP.lng, ts });
    wsBob.send({ type: 'eta', etaSeconds: 420 });

    const snap = await wsAlice.nextAfterNow(
      (m) => m.type === 'snapshot' && m.members.some((x: any) => x.memberId === bob.id && x.lastPosition !== null),
      4000,
      'snapshot containing Bob position',
    );
    const row = snap.members.find((m: any) => m.memberId === bob.id);
    expect(row.lastPosition).toEqual({ lat: MEETUP.lat + 5000 * DEG_PER_METER_LAT, lng: MEETUP.lng, ts });
    expect(row.etaSeconds).toBe(420);
    expect(row.status).toBe('rsvped'); // 5 km out: not arrived

    wsAlice.close();
    wsBob.close();
  });

  it('geofence: walking into the 150m radius flips status to arrived and broadcasts member_arrived', async () => {
    const { bob, wsAlice, wsBob } = await activeRunWithSockets();
    const ts = Date.now();

    // Approach: 2 km -> 400 m -> 200 m: still outside the fence.
    for (const meters of [2000, 400, 200]) {
      wsBob.send({ type: 'position', lat: MEETUP.lat + meters * DEG_PER_METER_LAT, lng: MEETUP.lng, ts: ts + meters });
    }
    wsBob.send({ type: 'eta', etaSeconds: 60 });
    const outside = await wsAlice.nextAfterNow(
      (m) => m.type === 'snapshot' && m.members.some((x: any) => x.memberId === bob.id && x.lastPosition !== null),
      4000,
      'pre-arrival snapshot',
    );
    expect(outside.members.find((m: any) => m.memberId === bob.id).status).toBe('rsvped');
    expect(wsAlice.messages.some((m) => m.type === 'member_arrived')).toBe(false);

    // Step inside: ~100 m from the meetup.
    wsBob.send({ type: 'position', lat: MEETUP.lat + 100 * DEG_PER_METER_LAT, lng: MEETUP.lng, ts: ts + 10_000 });

    const arrivedA = await wsAlice.next((m) => m.type === 'member_arrived', 4000, 'member_arrived (alice)');
    expect(arrivedA).toEqual({ type: 'member_arrived', memberId: bob.id });
    const arrivedB = await wsBob.next((m) => m.type === 'member_arrived', 4000, 'member_arrived (bob)');
    expect(arrivedB.memberId).toBe(bob.id);

    const snap = await wsAlice.nextAfterNow(
      (m) => m.type === 'snapshot' && m.members.some((x: any) => x.memberId === bob.id && x.status === 'arrived'),
      4000,
      'arrived snapshot',
    );
    const row = snap.members.find((m: any) => m.memberId === bob.id);
    expect(row.status).toBe('arrived');
    expect(row.etaSeconds).toBeNull(); // ETA cleared on arrival

    wsAlice.close();
    wsBob.close();
  });

  it('leave-run hard-stops the socket and removes the member from snapshots', async () => {
    const { run, bob, wsAlice, wsBob } = await activeRunWithSockets();
    wsBob.send({ type: 'position', lat: MEETUP.lat + 1000 * DEG_PER_METER_LAT, lng: MEETUP.lng, ts: Date.now() });
    await wsAlice.nextAfterNow(
      (m) => m.type === 'snapshot' && m.members.some((x: any) => x.memberId === bob.id && x.lastPosition !== null),
      4000,
      'snapshot with bob',
    );

    const res = await api(t, 'DELETE', `/runs/${run.id}/rsvp`, { token: bob.token });
    expect(res.status).toBe(200);

    // Bob's socket is closed by the server.
    const closed = await wsBob.closed;
    expect(closed.code).toBe(4001);

    // Bob disappears from subsequent snapshots (hard privacy stop).
    const snap = await wsAlice.nextAfterNow((m) => m.type === 'snapshot', 4000, 'post-leave snapshot');
    expect(snap.members.some((m: any) => m.memberId === bob.id)).toBe(false);

    // Bob cannot reconnect while 'left'.
    const again = new WsClient(t, bob.token, run.id);
    await expect(again.open()).rejects.toThrow(/403/);

    wsAlice.close();
  });

  it('ending a run broadcasts run_state ended and disconnects everyone', async () => {
    const { run, alice, wsAlice, wsBob } = await activeRunWithSockets();

    await api(t, 'POST', `/runs/${run.id}/end`, { token: alice.token });

    const stateA = await wsAlice.next((m) => m.type === 'run_state' && m.state === 'ended', 4000, 'run_state ended');
    expect(stateA).toEqual({ type: 'run_state', state: 'ended' });
    await wsBob.next((m) => m.type === 'run_state' && m.state === 'ended', 4000, 'run_state ended (bob)');

    const [closedA, closedB] = await Promise.all([wsAlice.closed, wsBob.closed]);
    expect(closedA.code).toBe(4000);
    expect(closedB.code).toBe(4000);

    // No reconnect once ended.
    const again = new WsClient(t, alice.token, run.id);
    await expect(again.open()).rejects.toThrow(/403/);
  });

  it('broadcasts run_state active to sockets connected before start', async () => {
    const { run, alice, bob } = await createRunFixture(t);
    await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: bob.token, body: { carId: null } });
    const wsBob = new WsClient(t, bob.token, run.id);
    await wsBob.open();
    const first = await wsBob.next((m) => m.type === 'snapshot', 4000, 'upcoming snapshot');
    expect(first.runState).toBe('upcoming');

    await api(t, 'POST', `/runs/${run.id}/start`, { token: alice.token });
    const state = await wsBob.next((m) => m.type === 'run_state' && m.state === 'active', 4000, 'run_state active');
    expect(state).toEqual({ type: 'run_state', state: 'active' });
    wsBob.close();
  });
});

describe('sweeps: auto-end + retention', () => {
  it('auto-ends an active run after 2h with no position updates', async () => {
    const { run, alice, bob } = await createRunFixture(t);
    await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: bob.token, body: { carId: null } });
    await api(t, 'POST', `/runs/${run.id}/start`, { token: alice.token });

    const TWO_H = 2 * 60 * 60 * 1000;

    // Fresh activity: a sweep "now" just under the threshold does nothing.
    expect(t.runs.service.sweepAutoEnd(Date.now() + TWO_H - 60_000)).toEqual([]);
    expect((await api(t, 'GET', `/runs/${run.id}`, { token: alice.token })).json.state).toBe('active');

    // 2h+ of silence: the sweep ends it.
    const endedIds = t.runs.service.sweepAutoEnd(Date.now() + TWO_H + 60_000);
    expect(endedIds).toContain(run.id);
    expect((await api(t, 'GET', `/runs/${run.id}`, { token: alice.token })).json.state).toBe('ended');
  });

  it('auto-end also disconnects live sockets', async () => {
    const { run, alice, bob } = await createRunFixture(t);
    await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: bob.token, body: { carId: null } });
    await api(t, 'POST', `/runs/${run.id}/start`, { token: alice.token });
    const wsBob = new WsClient(t, bob.token, run.id);
    await wsBob.open();

    t.runs.service.sweepAutoEnd(Date.now() + 2 * 60 * 60 * 1000 + 1);
    await wsBob.next((m) => m.type === 'run_state' && m.state === 'ended', 4000, 'auto-end run_state');
    const closed = await wsBob.closed;
    expect(closed.code).toBe(4000);
  });

  it('purges position history 24h after a run ends', async () => {
    const { run, alice, bob } = await createRunFixture(t);
    await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: bob.token, body: { carId: null } });
    await api(t, 'POST', `/runs/${run.id}/start`, { token: alice.token });
    const wsBob = new WsClient(t, bob.token, run.id);
    await wsBob.open();
    wsBob.send({ type: 'position', lat: MEETUP.lat + 1, lng: MEETUP.lng, ts: Date.now() });
    await wsBob.nextAfterNow(
      (m) => m.type === 'snapshot' && m.members.some((x: any) => x.lastPosition !== null),
      4000,
      'stored position snapshot',
    );
    await api(t, 'POST', `/runs/${run.id}/end`, { token: alice.token });

    const count = () =>
      (t.runs.db.prepare('SELECT COUNT(*) AS n FROM positions WHERE run_id = ?').get(run.id) as { n: number }).n;
    expect(count()).toBeGreaterThan(0);

    const DAY = 24 * 60 * 60 * 1000;
    t.runs.service.sweepRetention(Date.now() + DAY - 60_000); // too early
    expect(count()).toBeGreaterThan(0);
    t.runs.service.sweepRetention(Date.now() + DAY + 60_000); // past retention
    expect(count()).toBe(0);
  });
});
