/**
 * Hard Constraint 1 (spec) negative test: NO SPEED VALUES ANYWHERE.
 * Proves that after a full realistic flow — including a client that tries to
 * send speed — there is no speed field in the SQLite schema, in any stored
 * row, in any log line, or in any broadcast WS payload.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { addLogSink } from '../src/logger.js';
import {
  startTestServer,
  type TestServer,
  api,
  createRunFixture,
  WsClient,
  MEETUP,
  DEG_PER_METER_LAT,
} from './helpers.js';

const FORBIDDEN = /speed|velocity/i;

let t: TestServer;
const logLines: string[] = [];
const wsPayloads: string[] = [];
let removeSink: () => void;

beforeAll(async () => {
  removeSink = addLogSink((line) => logLines.push(line));
  t = await startTestServer();
});

afterAll(async () => {
  removeSink();
  await t.stop();
});

describe('no-speed guarantee (spec Hard Constraint 1 / R7)', () => {
  it('runs a full flow, rejecting any position that carries a speed key', async () => {
    const { run, alice, bob, car } = await createRunFixture(t);
    await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: alice.token, body: { carId: null } });
    await api(t, 'POST', `/runs/${run.id}/rsvp`, { token: bob.token, body: { carId: car.id } });
    await api(t, 'POST', `/runs/${run.id}/start`, { token: alice.token });

    const wsAlice = new WsClient(t, alice.token, run.id);
    const wsBob = new WsClient(t, bob.token, run.id);
    await Promise.all([wsAlice.open(), wsBob.open()]);
    wsAlice.ws.on('message', (d) => wsPayloads.push(d.toString()));
    wsBob.ws.on('message', (d) => wsPayloads.push(d.toString()));

    const positions = () =>
      (t.runs.db.prepare('SELECT COUNT(*) AS n FROM positions WHERE run_id = ?').get(run.id) as { n: number }).n;

    // A hostile/buggy client sends a position WITH a speed key -> whole message rejected.
    wsBob.send({
      type: 'position',
      lat: MEETUP.lat + 1000 * DEG_PER_METER_LAT,
      lng: MEETUP.lng,
      ts: Date.now(),
      speed: 182.4,
    });
    // And with other extra keys too.
    wsBob.send({ type: 'position', lat: MEETUP.lat, lng: MEETUP.lng, ts: Date.now(), heading: 90 });
    // Give the server a beat to process.
    await new Promise((r) => setTimeout(r, 300));
    expect(positions()).toBe(0); // nothing stored

    // A clean position IS stored and eventually triggers the geofence.
    wsBob.send({ type: 'eta', etaSeconds: 300 });
    wsBob.send({ type: 'position', lat: MEETUP.lat + 1000 * DEG_PER_METER_LAT, lng: MEETUP.lng, ts: Date.now() });
    wsBob.send({ type: 'position', lat: MEETUP.lat + 50 * DEG_PER_METER_LAT, lng: MEETUP.lng, ts: Date.now() + 1 });
    await wsAlice.next((m) => m.type === 'member_arrived', 4000, 'member_arrived');
    expect(positions()).toBe(2);

    await api(t, 'POST', `/runs/${run.id}/end`, { token: alice.token });
    await Promise.all([wsAlice.closed, wsBob.closed]);
  });

  it('SQLite schema contains no speed-like column or SQL', () => {
    const schema = t.runs.db
      .prepare("SELECT name, COALESCE(sql, '') AS sql FROM sqlite_master")
      .all() as { name: string; sql: string }[];
    expect(schema.length).toBeGreaterThan(0);
    for (const obj of schema) {
      expect(obj.sql, `schema object ${obj.name}`).not.toMatch(FORBIDDEN);
    }

    // Column-level check on every table.
    const tables = schema.filter((s) => s.sql.toUpperCase().includes('CREATE TABLE')).map((s) => s.name);
    expect(tables).toContain('positions');
    for (const table of tables) {
      const cols = t.runs.db.pragma(`table_info(${table})`) as { name: string }[];
      for (const col of cols) {
        expect(col.name, `column ${table}.${col.name}`).not.toMatch(FORBIDDEN);
      }
    }
  });

  it('stored position rows carry exactly id/run_id/member_id/lat/lng/ts', () => {
    const rows = t.runs.db.prepare('SELECT * FROM positions').all() as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['id', 'lat', 'lng', 'member_id', 'run_id', 'ts']);
      expect(JSON.stringify(row)).not.toMatch(FORBIDDEN);
    }
  });

  it('no log line ever mentions speed', () => {
    expect(logLines.length).toBeGreaterThan(0); // the flow above did log
    for (const line of logLines) {
      expect(line).not.toMatch(FORBIDDEN);
    }
  });

  it('no broadcast WS payload ever mentions speed', () => {
    expect(wsPayloads.length).toBeGreaterThan(0);
    for (const payload of wsPayloads) {
      expect(payload).not.toMatch(FORBIDDEN);
    }
  });

  it('backend source defines no speed field in schema or payload builders', async () => {
    // Static sweep of src/: the only allowed mentions are the guards/comments
    // that enforce the rule (logger filter, validation, schema comments).
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const srcDir = join(import.meta.dirname, '..', 'src');
    for (const file of await readdir(srcDir)) {
      const text = await readFile(join(srcDir, file), 'utf8');
      for (const [i, line] of text.split('\n').entries()) {
        if (!FORBIDDEN.test(line)) continue;
        const trimmed = line.trim();
        const isGuardOrComment =
          trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('--') ||
          /FORBIDDEN|refusing to log/.test(line);
        expect(isGuardOrComment, `src/${file}:${i + 1} mentions speed outside a guard/comment: ${line.trim()}`).toBe(true);
      }
    }
  });
});
