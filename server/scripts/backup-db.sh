#!/usr/bin/env sh
# Consistent SQLite backup, safe to run while the server is live — plus an
# optional off-site push and local retention prune for the nightly cron.
#
# Uses `VACUUM INTO` (a proper hot backup that respects WAL) rather than copying
# the file, so you never capture a torn/partial DB. Writes into the mounted data
# volume, so the backup appears at ./data/backup-<timestamp>.db on the host.
#
# Usage (on the docker host, from server/):
#   sh scripts/backup-db.sh
#
# Off-site push (production/SG -> JB over the tailnet): set BACKUP_PUSH_DEST to
# an scp destination reachable via Tailscale and the newest backup is copied
# there after it is written. Keep JB's copy out of any public path.
#   BACKUP_PUSH_DEST='isaac@100.x.y.z:runs-backups/' sh scripts/backup-db.sh
#
# Retention: the newest BACKUP_KEEP (default 14) backup-*.db files are kept
# locally; older ones are pruned. Set BACKUP_KEEP=0 to disable pruning.
#
# Nightly cron on the production box (03:15, after the day's runs have ended):
#   15 3 * * * cd /path/to/server && BACKUP_PUSH_DEST='isaac@<jb-tailnet-ip>:runs-backups/' sh scripts/backup-db.sh >> data/backup.log 2>&1
#
# A backup you have never restored is a wish, not a backup — test the restore
# path once (see "Manual failover" in the root README).
set -e

TS=$(date +%Y%m%d-%H%M%S)
OUT="/app/data/backup-$TS.db"

docker compose exec -T server node -e "
const path = process.env.DB_PATH || 'data/runs.db';
new (require('better-sqlite3'))(path).exec(\"VACUUM INTO '$OUT'\");
console.log('backup written');
"

echo "wrote ./data/backup-$TS.db"

# Off-site push (optional): scp over the tailnet. Fails the script loudly if
# the push fails — a nightly cron that silently stops pushing is how you end
# up with zero off-site copies exactly when the SG box dies.
if [ -n "${BACKUP_PUSH_DEST:-}" ]; then
  scp "./data/backup-$TS.db" "$BACKUP_PUSH_DEST"
  echo "pushed backup-$TS.db -> $BACKUP_PUSH_DEST"
fi

# Local retention prune (newest BACKUP_KEEP kept; 0 disables).
KEEP="${BACKUP_KEEP:-14}"
if [ "$KEEP" -gt 0 ] 2>/dev/null; then
  ls -1t ./data/backup-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | while IFS= read -r old; do
    rm -f "$old"
    echo "pruned $old"
  done
fi
