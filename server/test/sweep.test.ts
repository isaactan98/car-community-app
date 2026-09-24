/**
 * The sweep ends runs that are over in all but name.
 *
 * Parked phones keep sending a stationary heartbeat, so "no positions for 2h"
 * never fires once the group is at the office: without the arrival rule their
 * locations would keep flowing all day. And a run nobody started must not sit
 * under "Upcoming" forever.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  startTestServer,
  type TestServer,
  api,
  createRunFixture,
  joinMember,
  WsClient,
  MEETUP,
  DEG_PER_METER_LAT,
} from './helpers.js';

const DEST = { lat: 1.4655, lng: 103.7578 };
const TEN_MIN = 10 * 60 * 1000;
const SIX_H = 6 * 60 * 60 * 1000;

let t: TestServer;

beforeEach(async () => {
  t = await startTestServer();
});

afterEach(async () => {
  await t.stop();
});

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

async function reachDestination(ws: WsClient, watcher: WsClient, memberId: string) {
  ws.send(northOf(DEST, 40, Date.now()));
  await watcher.next(
    (m) => m.type === 'member_at_destination' && m.memberId === memberId,
    4000,
    'member_at_destination',
  );
}

async function state(runId: string, token: string) {
  return (await api(t, 'GET', `/runs/${runId}`, { token })).json.state;
}

describe('sweep: everyone has arrived', () => {
  it('ends the run once every sharing member has been at the destination for 10 min', async () => {
    const { run, alice, bob, wsAlice, wsBob } = await activeRun();
    await reachDestination(wsAlice, wsAlice, alice.id);
    await reachDestination(wsBob, wsAlice, bob.id);

    expect(t.runs.service.sweepAutoEnd(Date.now() + TEN_MIN - 60_000)).toEqual([]);
    expect(await state(run.id, alice.token)).toBe('active');

    expect(t.runs.service.sweepAutoEnd(Date.now() + TEN_MIN + 60_000)).toEqual([run.id]);
    expect(await state(run.id, alice.token)).toBe('ended');
    // Hard privacy stop: sockets are told and closed.
    await wsBob.next((m) => m.type === 'run_state' && m.state === 'ended', 4000, 'run_state ended');
    expect((await wsBob.closed).code).toBe(4000);
  });

  it('waits while a member who is sharing is still on the road', async () => {
    const { run, alice, wsAlice, wsBob } = await activeRun();
    await reachDestination(wsAlice, wsAlice, alice.id);
    wsBob.send(northOf(MEETUP, 50, Date.now())); // Bob is sharing, nowhere near
    await wsAlice.nextAfterNow((m) => m.type === 'snapshot', 4000, 'snapshot');

    expect(t.runs.service.sweepAutoEnd(Date.now() + TEN_MIN + 60_000)).toEqual([]);
    expect(await state(run.id, alice.token)).toBe('active');
    wsAlice.close();
    wsBob.close();
  });

  it('does not wait on a member who never shared a position', async () => {
    const { run, alice, wsAlice, wsBob } = await activeRun();
    await reachDestination(wsAlice, wsAlice, alice.id);

    expect(t.runs.service.sweepAutoEnd(Date.now() + TEN_MIN + 60_000)).toEqual([run.id]);
    wsAlice.close();
    wsBob.close();
  });

  it('never ends on arrival before anyone has arrived', async () => {
    const { run, wsAlice, wsBob } = await activeRun();
    expect(t.runs.service.sweepAutoEnd(Date.now() + TEN_MIN + 60_000)).toEqual([]);
    expect(await state(run.id, (await joinMember(t, 'Carol')).token)).toBe('active');
    wsAlice.close();
    wsBob.close();
  });

  it("does not let a parked member's heartbeat keep the run alive", async () => {
    const { run, alice, wsAlice, wsBob } = await activeRun();
    wsBob.send(northOf(MEETUP, 50, Date.now())); // Bob shared once, then went quiet
    await wsAlice.nextAfterNow((m) => m.type === 'snapshot', 4000, 'snapshot');
    await reachDestination(wsAlice, wsAlice, alice.id);
    const lastActivity = () =>
      (t.runs.db.prepare('SELECT last_activity_at FROM runs WHERE id = ?').get(run.id) as {
        last_activity_at: number;
      }).last_activity_at;
    const before = lastActivity();

    // Alice keeps heartbeating from the car park; that is not activity.
    await new Promise((r) => setTimeout(r, 20));
    wsAlice.send(northOf(DEST, 45, Date.now()));
    await wsAlice.nextAfterNow((m) => m.type === 'snapshot', 4000, 'snapshot');
    expect(lastActivity()).toBe(before);

    // Bob blocks the arrival rule, but 2h of silence from anyone still
    // driving ends it.
    expect(t.runs.service.sweepAutoEnd(before + 2 * 60 * 60 * 1000 + 1)).toEqual([run.id]);
    wsAlice.close();
    wsBob.close();
  });
});

describe('sweep: never started', () => {
  it('ends an upcoming run 6h after its start time', async () => {
    const { run, alice } = await createRunFixture(t); // starts in 1h
    const startsAt = Date.parse(run.startsAt);

    expect(t.runs.service.sweepAutoEnd(startsAt + SIX_H - 60_000)).toEqual([]);
    expect(await state(run.id, alice.token)).toBe('upcoming');

    expect(t.runs.service.sweepAutoEnd(startsAt + SIX_H + 60_000)).toEqual([run.id]);
    expect(await state(run.id, alice.token)).toBe('ended');
  });

  it('leaves a started run to the active-run rules', async () => {
    const { run, alice } = await createRunFixture(t);
    await api(t, 'POST', `/runs/${run.id}/start`, { token: alice.token });
    // Start-time expiry does not apply; only inactivity (2h) would.
    expect(t.runs.service.sweepAutoEnd(Date.now() + 60_000)).toEqual([]);
    expect(await state(run.id, alice.token)).toBe('active');
  });
});
