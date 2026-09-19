/**
 * R9 — place search.
 *
 * The upstream geocoder is stubbed here on purpose: these tests are about the
 * things this server adds on top of it — validation, the cache, the per-member
 * ceiling that keeps us inside a free provider's usage policy, and turning
 * half-populated GeoJSON into something a pin picker can list.
 */
import { describe, it, expect } from 'vitest';
import { PlaceSearch, toPlaces } from '../src/places.js';
import { loadConfig } from '../src/config.js';
import { HttpError } from '../src/service.js';

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** Stub upstream that records every call and answers with `body`. */
function stubGeocoder(body: unknown, opts: { ok?: boolean; status?: number } = {}) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => {
    calls.push({ url, headers: init.headers });
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => body,
    };
  };
  return { calls, fetchImpl };
}

const CALTEX = {
  features: [
    {
      geometry: { coordinates: [103.7712, 1.5231], type: 'Point' },
      properties: {
        name: 'Caltex',
        street: 'Jalan Molek 1/29',
        district: 'Taman Molek',
        city: 'Johor Bahru',
        state: 'Johor',
        country: 'Malaysia',
        osm_key: 'amenity',
        osm_value: 'fuel',
      },
    },
  ],
};

function search(body: unknown, overrides = {}) {
  const { calls, fetchImpl } = stubGeocoder(body);
  const config = loadConfig({ dbPath: ':memory:', ...overrides });
  return { places: new PlaceSearch(config, fetchImpl), calls, config };
}

describe('place search validation', () => {
  it('rejects a missing, empty or oversized query', async () => {
    const { places } = search(CALTEX);
    for (const q of [undefined, '', '   ', 42, 'x'.repeat(200)]) {
      await expect(places.search('m1', { q })).rejects.toMatchObject({ status: 400 });
    }
  });

  it('rejects a bias point that is not a coordinate, and a silly limit', async () => {
    const { places } = search(CALTEX);
    await expect(places.search('m1', { q: 'caltex', lat: 999, lng: 103 })).rejects.toMatchObject({ status: 400 });
    await expect(places.search('m1', { q: 'caltex', lat: 1.5, lng: 'nope' })).rejects.toMatchObject({ status: 400 });
    await expect(places.search('m1', { q: 'caltex', limit: 99 })).rejects.toMatchObject({ status: 400 });
    await expect(places.search('m1', { q: 'caltex', limit: 0 })).rejects.toMatchObject({ status: 400 });
  });

  it('treats an absent bias point as optional', async () => {
    const { places, calls } = search(CALTEX);
    await places.search('m1', { q: 'caltex' });
    expect(calls[0]!.url).not.toContain('lat=');
  });
});

describe('upstream call', () => {
  it('forwards the query and the bias point, and identifies itself', async () => {
    const { places, calls, config } = search(CALTEX);
    await places.search('m1', { q: 'caltex taman molek', lat: 1.49, lng: 103.76, limit: 5 });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('q')).toBe('caltex taman molek');
    expect(url.searchParams.get('lat')).toBe('1.49');
    expect(url.searchParams.get('lon')).toBe('103.76');
    expect(url.searchParams.get('limit')).toBe('5');
    // A real, identifying User-Agent is a condition of using the free
    // geocoders at all — an anonymous one is how a deployment gets banned.
    expect(calls[0]!.headers['User-Agent']).toBe(config.geocoderUserAgent);
    expect(calls[0]!.headers['User-Agent']).not.toBe('');
  });

  it('answers 502 when the geocoder errors, and when it is unreachable', async () => {
    const bad = stubGeocoder(null, { ok: false, status: 503 });
    const p1 = new PlaceSearch(loadConfig({ dbPath: ':memory:' }), bad.fetchImpl);
    await expect(p1.search('m1', { q: 'caltex' })).rejects.toMatchObject({ status: 502 });

    const dead = new PlaceSearch(loadConfig({ dbPath: ':memory:' }), async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(dead.search('m1', { q: 'caltex' })).rejects.toBeInstanceOf(HttpError);
    await expect(dead.search('m1', { q: 'caltex' })).rejects.toMatchObject({ status: 502 });
  });
});

describe('cache and rate limit', () => {
  it('serves a repeated query from cache without touching upstream', async () => {
    const { places, calls } = search(CALTEX);
    const first = await places.search('m1', { q: 'Caltex', lat: 1.49, lng: 103.76 });
    const second = await places.search('m2', { q: '  caltex  ', lat: 1.492, lng: 103.763 });
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1); // case, padding and a small map nudge all hit
  });

  it('goes back upstream once the entry expires', async () => {
    const { places, calls } = search(CALTEX, { geocoderCacheTtlMs: 1000 });
    const now = Date.now();
    await places.search('m1', { q: 'caltex' }, now);
    await places.search('m1', { q: 'caltex' }, now + 500);
    expect(calls).toHaveLength(1);
    await places.search('m1', { q: 'caltex' }, now + 1500);
    expect(calls).toHaveLength(2);
  });

  it('caps a member at the configured searches per minute, per member', async () => {
    const { places, calls } = search(CALTEX, { geocoderRatePerMinute: 3 });
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      await places.search('m1', { q: `query ${i}` }, now);
    }
    await expect(places.search('m1', { q: 'one too many' }, now)).rejects.toMatchObject({ status: 429 });
    // Another member has their own budget.
    await expect(places.search('m2', { q: 'someone else' }, now)).resolves.toBeInstanceOf(Array);
    // And the window rolls over.
    await expect(places.search('m1', { q: 'next minute' }, now + 60_001)).resolves.toBeInstanceOf(Array);
    expect(calls).toHaveLength(5);
  });

  it('does not spend budget on a cached query', async () => {
    const { places } = search(CALTEX, { geocoderRatePerMinute: 1 });
    const now = Date.now();
    await places.search('m1', { q: 'caltex' }, now);
    // Same query again: cached, so it must not count against the ceiling.
    await expect(places.search('m1', { q: 'caltex' }, now)).resolves.toHaveLength(1);
    await expect(places.search('m1', { q: 'something new' }, now)).rejects.toMatchObject({ status: 429 });
  });
});

describe('mapping GeoJSON to places', () => {
  it('reads name, locality and coordinates', () => {
    expect(toPlaces(CALTEX)).toEqual([
      {
        label: 'Caltex',
        detail: 'Jalan Molek 1/29, Taman Molek, Johor Bahru',
        lat: 1.5231,
        lng: 103.7712,
      },
    ]);
  });

  it('falls back to the street address when a feature has no name', () => {
    const [place] = toPlaces({
      features: [
        {
          geometry: { coordinates: [103.8, 1.35] },
          properties: { housenumber: '12', street: 'Jalan Sutera', city: 'Johor Bahru' },
        },
      ],
    });
    expect(place!.label).toBe('12 Jalan Sutera');
    expect(place!.detail).toBe('Jalan Sutera, Johor Bahru');
  });

  it('drops features that cannot become a pin, without failing the search', () => {
    expect(
      toPlaces({
        features: [
          { geometry: { coordinates: [103.8] }, properties: { name: 'Truncated' } },
          { geometry: { coordinates: [999, 999] }, properties: { name: 'Off the planet' } },
          { geometry: { coordinates: [103.8, 1.35] }, properties: {} }, // nothing to label it with
          { geometry: { coordinates: [103.8, 1.35] }, properties: { name: 'Keeper' } },
        ],
      }),
    ).toEqual([{ label: 'Keeper', detail: '', lat: 1.35, lng: 103.8 }]);
  });

  it('survives a response that is not GeoJSON at all', () => {
    expect(toPlaces(null)).toEqual([]);
    expect(toPlaces({})).toEqual([]);
    expect(toPlaces({ features: 'nope' })).toEqual([]);
  });
});

describe('GET /api/v1/places/search', () => {
  it('requires auth, answers the contract envelope, and surfaces upstream failure', async () => {
    const { createServer } = await import('node:http');
    const { startTestServer, api, joinMember } = await import('./helpers.js');

    // A stand-in geocoder on localhost: no injection seam, and it exercises the
    // real HTTP path including the User-Agent we are obliged to send.
    let agent = '';
    let fail = false;
    const upstream = createServer((req, res) => {
      agent = req.headers['user-agent'] ?? '';
      if (fail) {
        res.writeHead(500).end('upstream is having a day');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(CALTEX));
    });
    await new Promise<void>((resolve) => upstream.listen(0, resolve));
    const { port } = upstream.address() as { port: number };

    const t = await startTestServer({ geocoderUrl: `http://127.0.0.1:${port}/api/` });
    try {
      expect((await api(t, 'GET', '/places/search?q=caltex')).status).toBe(401);

      const m = await joinMember(t, 'Searcher');
      const ok = await api(t, 'GET', '/places/search?q=caltex&lat=1.49&lng=103.76', { token: m.token });
      expect(ok.status).toBe(200);
      expect(ok.json).toEqual({
        places: [
          { label: 'Caltex', detail: 'Jalan Molek 1/29, Taman Molek, Johor Bahru', lat: 1.5231, lng: 103.7712 },
        ],
      });
      expect(agent).not.toBe('');

      expect((await api(t, 'GET', '/places/search', { token: m.token })).status).toBe(400);

      fail = true;
      const down = await api(t, 'GET', '/places/search?q=somewhere%20else', { token: m.token });
      expect(down.status).toBe(502);
    } finally {
      await t.stop();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
