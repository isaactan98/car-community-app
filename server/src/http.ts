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
