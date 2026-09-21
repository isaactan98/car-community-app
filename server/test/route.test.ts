/**
 * The road route behind the live map's line.
 *
 * The upstream router is stubbed throughout: these tests are about what this
 * server adds on top of it — the caching and coalescing that let a whole group
 * ride a public router on one call, forgiving parsing of a router we do not
 * control, and the guarantee that no duration (and so no derivable speed) ever
 * crosses this boundary.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  RouteLookup,
  toRouteLine,
  decimate,
  resolveRunRoute,
  type RouteLine,
} from '../src/route.js';
import { loadConfig } from '../src/config.js';
import {
  startTestServer,
  type TestServer,
  api,
  createRunFixture,
  joinMember,
} from './helpers.js';

const MEETUP = { lat: 1.4927, lng: 103.7414, label: 'Gelang Patah R&R' };
const DEST = { lat: 1.3521, lng: 103.8198, label: 'Kranji' };

/** OSRM-shaped answer, with the duration we must never pass on. */
function osrmBody(coords: number[][], distance = 24_310.4) {
  return {
    code: 'Ok',
    routes: [
      {
        geometry: { type: 'LineString', coordinates: coords },
        distance,
        duration: 1_642.2,
        legs: [],
      },
    ],
    waypoints: [],
  };
}

const COORDS = [
  [103.7414, 1.4927],
  [103.7689, 1.4402],
  [103.8011, 1.3903],
  [103.8198, 1.3521],
];

interface Call {
  url: string;
  headers: Record<string, string>;
}

function stubRouter(
  body: unknown,
  opts: { ok?: boolean; status?: number; throws?: boolean; delayMs?: number } = {},
) {
  const calls: Call[] = [];
  const fetchImpl = async (
    url: string,
    init: { headers: Record<string, string>; signal: AbortSignal },
  ) => {
    calls.push({ url, headers: init.headers });
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.throws) throw new Error('ECONNREFUSED');
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => body,
    };
  };
  return { calls, fetchImpl };
}

function lookup(stub: ReturnType<typeof stubRouter>, overrides = {}) {
  const config = loadConfig({
    routerUrl: 'https://router.example/route/v1/driving',
    dbPath: ':memory:',
    ...overrides,
  });
  return new RouteLookup(config, stub.fetchImpl);
}

describe('RouteLookup', () => {
  it('asks the router lng-first and returns the road geometry', async () => {
    const stub = stubRouter(osrmBody(COORDS));
    const route = await lookup(stub).between(MEETUP, DEST);

    expect(route).not.toBeNull();
    expect(route!.points).toHaveLength(4);
    expect(route!.points[0]).toEqual({ lat: 1.4927, lng: 103.7414 });
    expect(route!.points[3]).toEqual({ lat: 1.3521, lng: 103.8198 });
    expect(route!.distanceMeters).toBeCloseTo(24_310.4);

    expect(stub.calls).toHaveLength(1);
    const url = new URL(stub.calls[0]!.url);
    expect(url.pathname).toContain('103.7414,1.4927;103.8198,1.3521');
    expect(url.searchParams.get('geometries')).toBe('geojson');
    expect(url.searchParams.get('overview')).toBe('simplified');
    expect(stub.calls[0]!.headers['User-Agent']).toContain('runs-app');
  });

  it('never carries a duration through — distance over it would be a speed', async () => {
    const stub = stubRouter(osrmBody(COORDS));
    const route = await lookup(stub).between(MEETUP, DEST);
    expect(JSON.stringify(route)).not.toMatch(/speed|velocity|duration/i);
  });

  it('serves the second caller from cache — the road does not move', async () => {
    const stub = stubRouter(osrmBody(COORDS));
    const r = lookup(stub);
    await r.between(MEETUP, DEST);
    await r.between(MEETUP, DEST);
    expect(stub.calls).toHaveLength(1);
  });

  it('coalesces the burst of phones that open the live map at once', async () => {
    const stub = stubRouter(osrmBody(COORDS), { delayMs: 20 });
    const r = lookup(stub);
    const all = await Promise.all(
      Array.from({ length: 50 }, () => r.between(MEETUP, DEST)),
    );
    expect(stub.calls).toHaveLength(1);
    for (const route of all) expect(route!.points).toHaveLength(4);
  });

  it('routes each direction separately — the cache key is ordered', async () => {
    const stub = stubRouter(osrmBody(COORDS));
    const r = lookup(stub);
    await r.between(MEETUP, DEST);
    await r.between(DEST, MEETUP);
    expect(stub.calls).toHaveLength(2);
  });

  it('answers null when the router is unreachable, without throwing', async () => {
    const stub = stubRouter(null, { throws: true });
    await expect(lookup(stub).between(MEETUP, DEST)).resolves.toBeNull();
  });

  it('answers null on an upstream error status', async () => {
    const stub = stubRouter('nope', { ok: false, status: 429 });
    await expect(lookup(stub).between(MEETUP, DEST)).resolves.toBeNull();
  });

  it('holds a failure only briefly, then asks again', async () => {
    const stub = stubRouter(null, { throws: true });
    const r = lookup(stub, { routerFailureTtlMs: 60_000 });
    const t0 = Date.now();
    await r.between(MEETUP, DEST, t0);
    await r.between(MEETUP, DEST, t0 + 30_000);
    expect(stub.calls).toHaveLength(1); // still inside the negative cache
    await r.between(MEETUP, DEST, t0 + 61_000);
    expect(stub.calls).toHaveLength(2);
  });

  it('is off, and silent, when no router is configured', async () => {
    const stub = stubRouter(osrmBody(COORDS));
    await expect(lookup(stub, { routerUrl: '' }).between(MEETUP, DEST)).resolves.toBeNull();
    expect(stub.calls).toHaveLength(0);
  });
});

describe('toRouteLine', () => {
  it('rejects answers that cannot be drawn', () => {
    expect(toRouteLine(null)).toBeNull();
    expect(toRouteLine({ code: 'NoRoute', routes: [] })).toBeNull();
    expect(toRouteLine({ routes: [{ geometry: {} }] })).toBeNull();
    // A single point is not a line.
    expect(toRouteLine(osrmBody([[103.7414, 1.4927]]))).toBeNull();
  });

  it('drops malformed coordinate pairs rather than failing the whole route', () => {
    const line = toRouteLine(
      osrmBody([
        [103.7414, 1.4927],
        ['nonsense', 1.44] as unknown as number[],
        [999, 1.39], // out-of-range lng
        [103.8198, 1.3521],
      ]),
    );
    expect(line!.points).toEqual([
      { lat: 1.4927, lng: 103.7414 },
      { lat: 1.3521, lng: 103.8198 },
    ]);
  });

  it('falls back to zero distance when the router omits it', () => {
    const line = toRouteLine({
      routes: [{ geometry: { type: 'LineString', coordinates: COORDS } }],
    });
    expect(line!.points).toHaveLength(4);
    expect(line!.distanceMeters).toBe(0);
  });
});

describe('decimate', () => {
  const many = Array.from({ length: 5_000 }, (_, i) => ({ lat: i / 1000, lng: 103 }));

  it('leaves a short route alone', () => {
    const short = many.slice(0, 10);
    expect(decimate(short, 100)).toBe(short);
  });

  it('thins a long route but keeps both ends', () => {
    const out = decimate(many, 1_000);
    expect(out).toHaveLength(1_000);
    expect(out[0]).toEqual(many[0]);
    expect(out[999]).toEqual(many[4_999]);
  });
});

describe('GET /runs/:id/route', () => {
  let t: TestServer;

  beforeAll(async () => {
    // `routerUrl` is '' for every test server (see helpers.ts): no test may
    // reach a public router, so the endpoint's job here is to degrade politely.
    t = await startTestServer();
  });

  afterAll(async () => {
    await t.stop();
  });

  it('answers null for a run with no destination', async () => {
    const alice = await joinMember(t, 'NoDestAlice');
    const run = (
      await api(t, 'POST', '/runs', {
        token: alice.token,
        body: {
          name: 'Kopi only',
          meetup: MEETUP,
          startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      })
    ).json;
    const res = await api(t, 'GET', `/runs/${run.id}/route`, { token: alice.token });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ route: null });
  });

  it('answers null — not an error — when no router is configured', async () => {
    const { run, alice } = await createRunFixture(t);
    const res = await api(t, 'GET', `/runs/${run.id}/route`, { token: alice.token });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ route: null });
  });

  it('404s an unknown run and 401s without a token', async () => {
    const alice = await joinMember(t, 'AuthAlice');
    const missing = await api(t, 'GET', '/runs/nope/route', { token: alice.token });
    expect(missing.status).toBe(404);
    const anon = await api(t, 'GET', '/runs/nope/route');
    expect(anon.status).toBe(401);
  });
});

/**
 * The run row is the outermost cache, and the one that actually matters on a
 * homelab: the in-process caches die with every `docker compose up`, and
 * without this the "one upstream call per run, ever" claim would really mean
 * "one per run per redeploy".
 */
describe('stored routes', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });

  afterAll(async () => {
    await t.stop();
  });

  /** A run created through the API, with the route column left empty. */
  async function freshRun() {
    const { run } = await createRunFixture(t);
    t.runs.db.prepare('UPDATE runs SET route_json = NULL WHERE id = ?').run(run.id);
    return t.runs.service.getRun(run.id);
  }

  it('fetches once, then never asks the router again — restart included', async () => {
    const run = await freshRun();
    const stub = stubRouter(osrmBody(COORDS));

    const first = await resolveRunRoute(t.runs.service, lookup(stub), run);
    expect(first!.points).toHaveLength(4);
    expect(stub.calls).toHaveLength(1);

    // A brand-new RouteLookup is exactly what a restarted container has: empty
    // in-memory caches, nothing but the database to go on.
    const afterRestart = await resolveRunRoute(t.runs.service, lookup(stub), run);
    expect(stub.calls).toHaveLength(1);
    expect(afterRestart).toEqual(first);
  });

  it('stores geometry only — no duration ever reaches the database', async () => {
    const run = await freshRun();
    await resolveRunRoute(t.runs.service, lookup(stubRouter(osrmBody(COORDS))), run);
    const stored = t.runs.service.storedRouteJson(run.id)!;
    expect(stored).not.toMatch(/speed|velocity|duration/i);
    expect(JSON.parse(stored).distanceMeters).toBeCloseTo(24_310.4);
  });

  it('stores nothing when the router fails, and retries on the next request', async () => {
    const run = await freshRun();
    const down = stubRouter(null, { throws: true });
    expect(await resolveRunRoute(t.runs.service, lookup(down), run)).toBeNull();
    expect(t.runs.service.storedRouteJson(run.id)).toBeNull();

    const up = stubRouter(osrmBody(COORDS));
    const later = await resolveRunRoute(t.runs.service, lookup(up), run);
    expect(later!.points).toHaveLength(4);
    expect(t.runs.service.storedRouteJson(run.id)).not.toBeNull();
  });

  it('never asks about a run with no destination', async () => {
    const alice = await joinMember(t, 'StoreNoDest');
    const created = (
      await api(t, 'POST', '/runs', {
        token: alice.token,
        body: {
          name: 'Kopi only',
          meetup: MEETUP,
          startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      })
    ).json;
    const stub = stubRouter(osrmBody(COORDS));
    expect(
      await resolveRunRoute(t.runs.service, lookup(stub), t.runs.service.getRun(created.id)),
    ).toBeNull();
    expect(stub.calls).toHaveLength(0);
  });

  it('keeps the first answer — a stored route is never quietly replaced', async () => {
    const run = await freshRun();
    await resolveRunRoute(t.runs.service, lookup(stubRouter(osrmBody(COORDS))), run);

    // A second writer (a racing request, or a router that changed its mind)
    // must not move a line people are already driving to.
    t.runs.service.storeRouteJson(run.id, JSON.stringify({ points: [], distanceMeters: 9 }));
    expect(JSON.parse(t.runs.service.storedRouteJson(run.id)!).points).toHaveLength(4);
  });

  it('refetches rather than serving an unreadable column', async () => {
    const run = await freshRun();
    for (const junk of ['not json at all', '{"points":[]}', '{"points":[{"lat":999,"lng":0},{"lat":1,"lng":2}]}']) {
      t.runs.db.prepare('UPDATE runs SET route_json = ? WHERE id = ?').run(junk, run.id);
      const stub = stubRouter(osrmBody(COORDS));
      const route: RouteLine | null = await resolveRunRoute(t.runs.service, lookup(stub), run);
      expect(stub.calls).toHaveLength(1);
      expect(route!.points).toHaveLength(4);
    }
  });

  it('warms the route in the background when a run is created', async () => {
    const { run } = await createRunFixture(t);
    // The real router is off in tests (`routerUrl: ''`), so nothing is stored —
    // what this proves is that creating a run neither waits for it nor fails.
    expect(run.id).toBeTruthy();
    expect(t.runs.service.storedRouteJson(run.id)).toBeNull();
  });
});
