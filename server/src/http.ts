import express, { type Request, type Response, type NextFunction } from 'express';
import { HttpError, type Service } from './service.js';
import { log } from './logger.js';

declare module 'express-serve-static-core' {
  interface Request {
    member?: { id: string; displayName: string };
  }
}

export function createHttpApp(service: Service): express.Express {
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
    res.json(service.createRun(req.member!.id, req.body));
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
