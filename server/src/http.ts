import express, { type Request, type Response, type NextFunction } from 'express';
import { HttpError, type Service } from './service.js';
import type { PlaceSearch } from './places.js';
import { resolveRunRoute, warmRunRoute, type RouteLookup } from './route.js';
import { log } from './logger.js';

declare module 'express-serve-static-core' {
  interface Request {
    member?: { id: string; displayName: string };
  }
}

/**
 * Static page for `/__diag/ws`. Deliberately dependency-free and inline: it has
 * to run in an old phone browser with no network beyond the server serving it.
 */
const WS_DIAG_PAGE = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Runs — WebSocket probe</title>
<style>
  body{font:16px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#0B0D11;color:#E6E9EF}
  h1{font-size:18px;margin:0 0 4px}
  p{color:#97A0AE;margin:0 0 20px;font-size:14px}
  #r{padding:16px;border-radius:12px;background:#1A2029;font-family:ui-monospace,monospace;font-size:14px;white-space:pre-wrap;word-break:break-all}
  .ok{color:#5AD18F}.bad{color:#FF6B6B}.wait{color:#F5C451}
</style>
<h1>WebSocket probe</h1>
<p>Dials this server's /ws with no token. "Refused (401)" is the good answer — it means the upgrade reached the server.</p>
<div id="r" class="wait">connecting…</div>
<script>
  var el = document.getElementById('r');
  var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  var done = false;
  function show(cls, text){ if(done) return; done = true; el.className = cls; el.textContent = text; }
  try {
    var ws = new WebSocket(url);
    ws.onopen = function(){ show('bad', 'OPENED without a token — unexpected.\\n' + url); ws.close(); };
    ws.onclose = function(e){
      // A refused upgrade closes without ever opening. Either way the bytes
      // reached the server, which is the whole point of this page.
      show('ok', 'Reached the server.\\nClosed code ' + e.code + (e.reason ? ' (' + e.reason + ')' : '') + '\\n' + url + '\\n\\nNow check the server log for "ws upgrade rejected".');
    };
    ws.onerror = function(){ show('bad', 'Could not reach the server.\\n' + url + '\\n\\nThe upgrade never got through — network path or client, not the server.'); };
    setTimeout(function(){ show('bad', 'Timed out after 10s.\\n' + url); }, 10000);
  } catch (err) {
    show('bad', 'WebSocket constructor threw: ' + err);
  }
</script>`;

export function createHttpApp(
  service: Service,
  places: PlaceSearch,
  routes: RouteLookup,
  enableWsDiag = false,
): express.Express {
  const app = express();
  app.disable('x-powered-by');

  /**
   * Access log — one line per REST call.
   *
   * Without it there is no way to answer "is this phone talking to the server
   * at all?", which is the first question whenever a device sits in degraded
   * mode: the app falls back to its cache and looks *almost* normal, so a
   * phone that cannot reach the server is nearly indistinguishable from one
   * that can. Paired with the `ws upgrade rejected` lines, this separates "the
   * app never got through" from "it got through and we turned it away".
   *
   * `path` deliberately excludes the query string (the WS token lives there),
   * and `ua` is what tells one tester's phone from another — CFNetwork/Darwin
   * for iOS, okhttp for Android.
   */
  app.use((req, res, next) => {
    // The Docker healthcheck hits /healthz every 30s; logging it buries
    // everything that matters.
    if (req.path === '/healthz') return next();
    const startedAt = Date.now();
    // Capture the path now: by the time `finish` fires, Express has rewritten
    // `req.url` relative to whichever router matched, so reading it late gives
    // "/auth/join" for one request and "/api/v1/auth/join" for the next.
    // `originalUrl` is stable; the split drops the query string with it.
    const path = req.originalUrl.split('?')[0];
    res.on('finish', () => {
      log.info('http', {
        method: req.method,
        path,
        status: res.statusCode,
        ms: Date.now() - startedAt,
        remote: req.socket.remoteAddress ?? null,
        memberId: req.member?.id ?? null,
        // `host` is the address the client actually dialled. Two phones that
        // disagree here were built against different EXPO_PUBLIC_SERVER_URLs,
        // which no amount of staring at the app can tell you; `proto` is set
        // only when something is proxying, which would explain REST arriving
        // while a WebSocket upgrade quietly does not.
        host: req.header('host') ?? null,
        proto: req.header('x-forwarded-proto') ?? null,
        ua: (req.header('user-agent') ?? '').slice(0, 120) || null,
      });
    });
    next();
  });

  app.use(express.json({ limit: '64kb' }));

  /** Unauthenticated liveness probe for Docker/monitoring. */
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  /**
   * WebSocket reachability probe, opened in a phone's browser.
   *
   * `/healthz` proves a device can reach us over HTTP, and the access log
   * proves the app can. Neither says whether a *WebSocket upgrade* from that
   * device survives the path — which is the question when REST from a phone
   * lands but its socket never appears in the log at all.
   *
   * The page dials `/ws` with no token. A 401 is the *success* case: the
   * upgrade reached us and was refused on credentials, which the `ws upgrade
   * rejected` log line records. Silence on both ends means the upgrade never
   * arrived, and the problem is the network path or the client, not this
   * server. Carrying no token is what makes it safe to open in a browser.
   */
  if (enableWsDiag) {
    app.get('/__diag/ws', (_req, res) => {
      res.type('html').send(WS_DIAG_PAGE);
    });
  }

  const api = express.Router();
  app.use('/api/v1', api);

  // ----- auth -----

  api.post('/auth/join', (req, res) => {
    const { inviteCode, displayName } = (req.body ?? {}) as Record<string, unknown>;
    res.json(service.join(inviteCode, displayName));
  });

  /** Everything below requires `Authorization: Bearer <token>`. */
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const member = token ? service.memberByToken(token) : null;
    if (!member) {
      res.status(401).json({ error: 'missing or invalid token' });
      return;
    }
    req.member = member;
    next();
  };
  api.use(requireAuth);

  // ----- me & garage -----

  api.get('/me', (req, res) => {
    res.json(service.me(req.member!.id));
  });

  api.post('/me/cars', (req, res) => {
    const { name } = (req.body ?? {}) as Record<string, unknown>;
    res.json(service.addCar(req.member!.id, name));
  });

  api.delete('/me/cars/:carId', (req, res) => {
    service.deleteCar(req.member!.id, req.params.carId);
    res.json({ ok: true });
  });

  // ----- runs -----

  api.post('/runs', (req, res) => {
    const run = service.createRun(req.member!.id, req.body);
    // Fetch the map line now, in the background, so it is already on the run
    // row by the time anyone opens the live map. Creating a run must never
    // block on a third party, nor fail because one is down.
    warmRunRoute(service, routes, run);
    res.json(run);
  });

  api.get('/runs', (_req, res) => {
    res.json(service.listRuns());
  });

  api.get('/runs/:id', (req, res) => {
    res.json(service.getRun(req.params.id));
  });

  api.post('/runs/:id/rsvp', (req, res) => {
    const { carId } = (req.body ?? {}) as Record<string, unknown>;
    res.json(service.rsvp(req.params.id, req.member!.id, carId ?? null));
  });

  api.delete('/runs/:id/rsvp', (req, res) => {
    res.json(service.leave(req.params.id, req.member!.id));
  });

  api.post('/runs/:id/start', (req, res) => {
    res.json(service.startRun(req.params.id, req.member!.id));
  });

  api.post('/runs/:id/end', (req, res) => {
    res.json(service.endRun(req.params.id, req.member!.id));
  });

  /**
   * The road between this run's meetup and its destination, for the line on
   * the live map. `service.getRun` first so an unknown run is a 404 and only
   * an authenticated member can spend an upstream call.
   *
   * Always 200. `{ route: null }` covers all four no-line cases — the run has
   * no destination, the router is off, it did not answer, or it had no route —
   * because the map's response to each is identical: draw the direct line
   * instead. Usually this serves the route already stored on the run row at
   * creation and touches nothing external at all.
   */
  api.get('/runs/:id/route', (req, res, next) => {
    let run;
    try {
      run = service.getRun(req.params.id);
    } catch (err) {
      next(err);
      return;
    }
    resolveRunRoute(service, routes, run)
      .then((route) => res.json({ route }))
      .catch(next);
  });

  // ----- place search (R9) -----

  api.get('/places/search', (req, res, next) => {
    const { q, lat, lng, limit } = req.query;
    places
      .search(req.member!.id, { q, lat, lng, limit })
      .then((found) => res.json({ places: found }))
      .catch(next);
  });

  // ----- errors -----

  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // Body-parser JSON syntax errors and the like.
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid JSON body' });
      return;
    }
    log.error('unhandled error', { message: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
