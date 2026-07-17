import WebSocket from 'ws';
import { createRunsServer, type RunsServer } from '../src/server.js';
import type { Config } from '../src/config.js';

export const INVITE = 'TEST-INVITE';

/** Meetup: Singapore. ~111,320 m per degree of latitude. */
export const MEETUP = { lat: 1.3521, lng: 103.8198, label: 'Kranji Carpark' };
export const DEG_PER_METER_LAT = 1 / 111_320;

export interface TestServer {
  runs: RunsServer;
  port: number;
  base: string;
  stop(): Promise<void>;
}

export async function startTestServer(overrides: Partial<Config> = {}): Promise<TestServer> {
  const runs = createRunsServer({
    dbPath: ':memory:',
    seedInviteCodes: [INVITE],
    snapshotIntervalMs: 150,
    // Sweeps are driven manually in tests (service.sweepAutoEnd / sweepRetention).
    sweepIntervalMs: 3_600_000,
    ...overrides,
  });
  const port = await runs.listen(0);
  return {
    runs,
    port,
    base: `http://127.0.0.1:${port}/api/v1`,
    stop: () => runs.close(),
  };
}

export async function api(
  t: TestServer,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(t.base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

export async function joinMember(t: TestServer, displayName: string): Promise<{ token: string; id: string }> {
  const { status, json } = await api(t, 'POST', '/auth/join', {
    body: { inviteCode: INVITE, displayName },
  });
  if (status !== 200) throw new Error(`join failed: ${status}`);
  return { token: json.token, id: json.member.id };
}

/** WebSocket client wrapper that queues every received message. */
export class WsClient {
  ws: WebSocket;
  messages: any[] = [];
  closed: Promise<{ code: number; reason: string }>;
  private waiters: { predicate: (m: any) => boolean; resolve: (m: any) => void }[] = [];

  constructor(t: TestServer, token: string, runId: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${t.port}/ws?token=${token}&runId=${runId}`);
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      this.messages.push(msg);
      for (let i = 0; i < this.waiters.length; i++) {
        const w = this.waiters[i]!;
        if (w.predicate(msg)) {
          this.waiters.splice(i, 1);
          w.resolve(msg);
          break;
        }
      }
    });
    this.closed = new Promise((resolve) => {
      this.ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
      this.ws.once('unexpected-response', (_req, res) => reject(new Error(`upgrade rejected: ${res.statusCode}`)));
    });
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolve with the next (or an already-queued) message matching the predicate. */
  next(predicate: (m: any) => boolean, timeoutMs = 4_000, label = 'message'): Promise<any> {
    const queued = this.messages.find(predicate);
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
      this.waiters.push({
        predicate,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  /** Wait for a FUTURE message matching predicate (ignores the backlog). */
  nextAfterNow(predicate: (m: any) => boolean, timeoutMs = 4_000, label = 'message'): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
      this.waiters.push({
        predicate,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Standard fixture: two members, one run created by member A. */
export async function createRunFixture(t: TestServer) {
  const alice = await joinMember(t, 'Alice');
  const bob = await joinMember(t, 'Bob');
  const car = (await api(t, 'POST', '/me/cars', { token: bob.token, body: { name: 'ND2 MX-5' } })).json;
  const run = (
    await api(t, 'POST', '/runs', {
      token: alice.token,
      body: {
        name: 'JB Breakfast Run',
        meetup: MEETUP,
        destination: { lat: 1.4655, lng: 103.7578, label: 'JB Kopitiam' },
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    })
  ).json;
  return { alice, bob, car, run };
}
