/**
 * Create an invite code:  npm run invite:create [-- MY-CODE]
 * Uses DB_PATH (default data/runs.db). Prints the code to stdout.
 */
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { Service } from '../src/service.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const service = new Service(db, config, {
  broadcast() {},
  closeRun() {},
  closeMember() {},
});

const requested = process.argv[2];
const code = service.createInviteCode(requested);
console.log(code);
db.close();
