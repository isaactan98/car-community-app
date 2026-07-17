import { createRunsServer } from './server.js';
import { log } from './logger.js';

const runs = createRunsServer();

runs.listen().catch((err) => {
  log.error('failed to start', { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info('shutting down', { signal });
    void runs.close().then(() => process.exit(0));
  });
}
