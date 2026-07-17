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
    if (url.pathname !== '/ws') {
      rejectUpgrade(socket, 404, 'not found');
      return;
    }
    const token = url.searchParams.get('token') ?? '';
    const runId = url.searchParams.get('runId') ?? '';
    const member = token ? service.memberByToken(token) : null;
    if (!member) {
      rejectUpgrade(socket, 401, 'invalid token');
      return;
    }
    const allowed = service.canConnect(runId, member.id);
    if (!allowed.ok) {
      rejectUpgrade(socket, allowed.status, allowed.reason);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, { memberId: member.id, runId });
    });
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, ctx: { memberId: string; runId: string }) => {
    const { memberId, runId } = ctx;
    hub.add(runId, memberId, ws);
    log.info('ws connected', { runId, memberId });

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

function rejectUpgrade(socket: Socket, status: number, reason: string): void {
  const text = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found' }[status] ?? 'Bad Request';
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: ${reason.length}\r\n\r\n${reason}`);
}
