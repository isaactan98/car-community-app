import { WebSocketServer, type WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { Service } from './service.js';
import type { Hub } from './hub.js';
import type { Config } from './config.js';
import { log } from './logger.js';

/**
 * Realtime endpoint: /ws?token=<token>&runId=<runId>
 * Client -> server: position, eta (validated in Service; anything else dropped).
 * Server -> client: snapshot (on connect + every ~5 s), member_arrived, run_state.
 */
export function attachWs(server: Server, service: Service, hub: Hub, config: Config): { stop(): void } {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const remote = req.socket.remoteAddress ?? null;
    if (url.pathname !== '/ws') {
      rejectUpgrade(socket, 404, 'not found', { path: url.pathname, remote });
      return;
    }
    const token = url.searchParams.get('token') ?? '';
    const runId = url.searchParams.get('runId') ?? '';
    const member = token ? service.memberByToken(token) : null;
    if (!member) {
      rejectUpgrade(socket, 401, 'invalid token', {
        path: url.pathname,
        remote,
        runId,
        hasToken: token.length > 0,
      });
      return;
    }
    const allowed = service.canConnect(runId, member.id);
    if (!allowed.ok) {
      rejectUpgrade(socket, allowed.status, allowed.reason, {
        path: url.pathname,
        remote,
        runId,
        memberId: member.id,
      });
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, { memberId: member.id, runId });
    });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage, ctx: { memberId: string; runId: string }) => {
    const { memberId, runId } = ctx;
    hub.add(runId, memberId, ws);
    // `remote` pairs this line with the `ws upgrade rejected` lines above, so a
    // tester's phone can be followed end to end through one log.
    log.info('ws connected', { runId, memberId, remote: req.socket.remoteAddress ?? null });

    // Snapshot on connect (contract).
    hub.send(ws, service.snapshot(runId));

    ws.on('message', (data) => {
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        log.warn('ws message dropped', { runId, memberId, reason: 'invalid_json' });
        return;
      }
      if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
        log.warn('ws message dropped', { runId, memberId, reason: 'not_an_object' });
        return;
      }
      const record = msg as Record<string, unknown>;
      let rejection: string | null;
      switch (record.type) {
        case 'position':
          rejection = service.ingestPosition(runId, memberId, record);
          break;
        case 'eta':
          rejection = service.ingestEta(runId, memberId, record);
          break;
        default:
          rejection = 'unknown_type';
      }
      if (rejection) {
        // Reasons are fixed enum strings — payload contents never reach logs.
        log.warn('ws message rejected', { runId, memberId, reason: rejection });
      }
    });

    ws.on('error', () => ws.close());

    // The other half of the picture: a phone that connects and then drops every
    // few seconds looks identical to one that never connected, unless the churn
    // is on the record. Codes 4000/4001 are our own hard stops (run ended / left
    // run); anything else is the network or the client going away.
    ws.on('close', (code: number, reasonBuf: Buffer) => {
      log.info('ws disconnected', {
        runId,
        memberId,
        code,
        reason: reasonBuf?.toString() || null,
      });
    });
  });

  // Periodic snapshot broadcast (~5 s) to every run that has live sockets.
  const ticker = setInterval(() => {
    for (const runId of hub.runIdsWithClients()) {
      try {
        hub.broadcast(runId, service.snapshot(runId));
      } catch (err) {
        log.error('snapshot broadcast failed', { runId, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }, config.snapshotIntervalMs);
  ticker.unref();

  return {
    stop() {
      clearInterval(ticker);
      hub.closeAll();
      wss.close();
    },
  };
}

/**
 * Refuse a WebSocket upgrade — and leave a trace.
 *
 * A rejected upgrade used to be invisible from both ends: the app's
 * `ws.onerror` is a deliberate no-op (no payloads in logs) and nothing was
 * written here, so "the live map says Offline" had no server-side record to
 * check against. Every rejection is now one line, which is the difference
 * between diagnosing a phone in five seconds and guessing for an evening.
 *
 * Never log the token itself — it is a bearer credential. `hasToken`
 * separates "the app sent nothing" from "the app sent something we don't
 * recognise", which is all the triage needs. `remote` is what tells one
 * tester's phone from another's on the tailnet.
 */
function rejectUpgrade(
  socket: Socket,
  status: number,
  reason: string,
  ctx: {
    path: string;
    remote: string | null;
    runId?: string;
    memberId?: string;
    hasToken?: boolean;
  },
): void {
  log.warn('ws upgrade rejected', { status, reason, ...ctx });
  const text = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found' }[status] ?? 'Bad Request';
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: ${reason.length}\r\n\r\n${reason}`);
}
