import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * SQLite schema.
 *
 * Hard Constraint 1 (spec): NO SPEED VALUES ANYWHERE. Positions are
 * lat + lng + ts only. Do not add speed/velocity/heading-derived columns.
 *
 * P2 note (roles): optional roles later would be a plain
 * `ALTER TABLE run_attendees ADD COLUMN role TEXT` — attendee state already
 * lives in its own row per (run, member), so no migration pain. Do NOT add
 * the column now (spec: design for, don't build).
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS invite_codes (
  code        TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  uses        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS members (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  token         TEXT NOT NULL UNIQUE,
  invite_code   TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cars (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id),
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cars_member ON cars(member_id);

CREATE TABLE IF NOT EXISTS runs (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  creator_id       TEXT NOT NULL REFERENCES members(id),
  meetup_lat       REAL NOT NULL,
  meetup_lng       REAL NOT NULL,
  meetup_label     TEXT NOT NULL,
  dest_lat         REAL,
  dest_lng         REAL,
  dest_label       TEXT,
  starts_at        TEXT NOT NULL,           -- ISO-8601
  state            TEXT NOT NULL DEFAULT 'upcoming'
                     CHECK (state IN ('upcoming','active','ended')),
  created_at       INTEGER NOT NULL,
  ended_at         INTEGER,                 -- epoch ms, set when state -> ended
  last_activity_at INTEGER                  -- epoch ms of start or latest position; drives auto-end
);
CREATE INDEX IF NOT EXISTS idx_runs_state ON runs(state);

CREATE TABLE IF NOT EXISTS run_attendees (
  run_id      TEXT NOT NULL REFERENCES runs(id),
  member_id   TEXT NOT NULL REFERENCES members(id),
  car_id      TEXT REFERENCES cars(id),
  status      TEXT NOT NULL DEFAULT 'rsvped'
                CHECK (status IN ('rsvped','arrived','left')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (run_id, member_id)
);

-- Position history: lat, lng, ts ONLY (Hard Constraint 1 of the spec).
-- Purged by the retention sweep 24h after the run ends.
CREATE TABLE IF NOT EXISTS positions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL REFERENCES runs(id),
  member_id  TEXT NOT NULL REFERENCES members(id),
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  ts         INTEGER NOT NULL              -- client epoch ms
);
CREATE INDEX IF NOT EXISTS idx_positions_run_member_ts ON positions(run_id, member_id, ts);
CREATE INDEX IF NOT EXISTS idx_positions_run ON positions(run_id);
`;

export type DB = Database.Database;

export function openDb(dbPath: string): DB {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
