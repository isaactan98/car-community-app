import type { WebSocket } from 'ws';
import type { RealtimeNotifier } from './service.js';

interface Client {
  ws: WebSocket;
  runId: string;
  memberId: string;
}

/**
 * Registry of live sockets per run. Owns broadcast + the hard-stop closes
 * (run ended / member left). Snapshot ticking lives in ws.ts.
 */
export class Hub implements RealtimeNotifier {
  private byRun = new Map<string, Set<Client>>();

  add(runId: string, memberId: string, ws: WebSocket): void {
    let set = this.byRun.get(runId);
    if (!set) {
      set = new Set();
      this.byRun.set(runId, set);
    }
    const client: Client = { ws, runId, memberId };
    set.add(client);
    ws.on('close', () => {
      set.delete(client);
      if (set.size === 0) this.byRun.delete(runId);
    });
  }

  runIdsWithClients(): string[] {
    return [...this.byRun.keys()];
  }

  broadcast(runId: string, message: object): void {
    const set = this.byRun.get(runId);
    if (!set) return;
    const payload = JSON.stringify(message);
    for (const c of set) {
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(payload);
    }
  }

  send(ws: WebSocket, message: object): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }

  closeRun(runId: string): void {
    const set = this.byRun.get(runId);
    if (!set) return;
    for (const c of [...set]) c.ws.close(4000, 'run ended');
    this.byRun.delete(runId);
  }

  closeMember(runId: string, memberId: string): void {
    const set = this.byRun.get(runId);
    if (!set) return;
    for (const c of [...set]) {
      if (c.memberId === memberId) {
        c.ws.close(4001, 'left run');
        set.delete(c);
      }
    }
  }

  closeAll(): void {
    for (const runId of [...this.byRun.keys()]) this.closeRun(runId);
  }
}
