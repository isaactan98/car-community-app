#!/usr/bin/env sh
# Consistent SQLite backup, safe to run while the server is live.
#
# Uses `VACUUM INTO` (a proper hot backup that respects WAL) rather than copying
# the file, so you never capture a torn/partial DB. Writes into the mounted data
# volume, so the backup appears at ./data/backup-<timestamp>.db on the host.
#
# Usage (on the docker host, from server/):  sh scripts/backup-db.sh
set -e

TS=$(date +%Y%m%d-%H%M%S)
OUT="/app/data/backup-$TS.db"

docker compose exec -T server node -e "
const path = process.env.DB_PATH || 'data/runs.db';
new (require('better-sqlite3'))(path).exec(\"VACUUM INTO '$OUT'\");
console.log('backup written');
"

echo "wrote ./data/backup-$TS.db"
