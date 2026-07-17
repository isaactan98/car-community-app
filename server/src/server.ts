import { createServer, type Server } from 'node:http';
import { openDb, type DB } from './db.js';
import { loadConfig, type Config } from './config.js';
import { Service } from './service.js';
import { Hub } from './hub.js';
import { createHttpApp } from './http.js';
import { attachWs } from './ws.js';
import { log } from './logger.js';

export interface RunsServer {
  server: Server;
  db: DB;
  service: Service;
  config: Config;
  /** Bind and start listening; resolves with the actual port. */
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

export function createRunsServer(overrides: Partial<Config> = {}): RunsServer {
  const config = loadConfig(overrides);
  const db = openDb(config.dbPath);
  const hub = new Hub();
  const service = new Service(db, config, hub);
  service.seedInviteCodes(config.seedInviteCodes);

  const app = createHttpApp(service);
  const server = createServer(app);
  const ws = attachWs(server, service, hub, config);

  // Sweeps: auto-end inactive active runs; purge expired position history.
  const sweeper = setInterval(() => {
    try {
      service.sweepAutoEnd();
      service.sweepRetention();
    } catch (err) {
      log.error('sweep failed', { message: err instanceof Error ? err.message : String(err) });
    }
  }, config.sweepIntervalMs);
  sweeper.unref();

  return {
    server,
    db,
    service,
    config,
    listen(port = config.port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          const address = server.address();
          const actual = typeof address === 'object' && address ? address.port : port;
          log.info('runs server listening', { port: actual });
          resolve(actual);
        });
      });
    },
    close() {
      clearInterval(sweeper);
      ws.stop();
      return new Promise((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
        // Don't hang on keep-alive connections during shutdown.
        server.closeAllConnections?.();
      });
    },
  };
}
