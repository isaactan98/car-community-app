import { randomUUID, randomBytes } from 'node:crypto';
import type { DB } from './db.js';
import type { Config } from './config.js';
import { haversineMeters } from './geo.js';
import { log } from './logger.js';

// ---------- wire types (mirror docs/CONTRACT.md exactly) ----------

export interface Point {
  lat: number;
  lng: number;
  label: string;
}

export interface AttendeeView {
  memberId: string;
  displayName: string;
  carName: string | null;
  status: 'rsvped' | 'arrived' | 'left';
}

export interface RunView {
  id: string;
  name: string;
  creatorId: string;
  meetup: Point;
  destination: Point | null;
  startsAt: string;
  state: 'upcoming' | 'active' | 'ended';
  inviteDeepLink: string;
  attendees: AttendeeView[];
}

export interface SnapshotMember {
  memberId: string;
  displayName: string;
  carName: string | null;
  status: 'rsvped' | 'arrived';
  lastPosition: { lat: number; lng: number; ts: number } | null;
  etaSeconds: number | null;
}

export interface SnapshotMessage {
  type: 'snapshot';
  runState: 'upcoming' | 'active' | 'ended';
  members: SnapshotMember[];
}

/**
 * Realtime side effects the domain layer triggers. Implemented by the WS hub;
 * a no-op in unit contexts.
 */
export interface RealtimeNotifier {
  broadcast(runId: string, message: object): void;
  /** Hard-stop: close every socket for the run (run ended). */
  closeRun(runId: string): void;
  /** Hard-stop: close a single member's sockets for the run (member left). */
  closeMember(runId: string, memberId: string): void;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface MemberRow {
  id: string;
  display_name: string;
  token: string;
}

interface RunRow {
  id: string;
  name: string;
  creator_id: string;
  meetup_lat: number;
  meetup_lng: number;
  meetup_label: string;
  dest_lat: number | null;
  dest_lng: number | null;
  dest_label: string | null;
  starts_at: string;
  state: 'upcoming' | 'active' | 'ended';
  ended_at: number | null;
  last_activity_at: number | null;
}

export class Service {
  /** Client-computed ETAs, in memory only (runId -> memberId -> seconds). */
  private etas = new Map<string, Map<string, number>>();

  constructor(
    private db: DB,
    private config: Config,
    private realtime: RealtimeNotifier,
  ) {}

  setRealtime(realtime: RealtimeNotifier): void {
    this.realtime = realtime;
  }

  // ---------- invites & auth ----------

  createInviteCode(code?: string): string {
    const value = code ?? 'RUNS-' + randomBytes(4).toString('hex').toUpperCase();
    this.db
      .prepare('INSERT OR IGNORE INTO invite_codes (code, created_at) VALUES (?, ?)')
      .run(value, Date.now());
    return value;
  }

  seedInviteCodes(codes: string[]): void {
    for (const code of codes) this.createInviteCode(code);
    if (codes.length > 0) log.info('seeded invite codes', { count: codes.length });
  }

  join(inviteCode: unknown, displayName: unknown): { token: string; member: { id: string; displayName: string } } {
    if (typeof inviteCode !== 'string' || inviteCode.trim() === '')
      throw new HttpError(400, 'inviteCode is required');
    if (typeof displayName !== 'string' || displayName.trim() === '' || displayName.length > 80)
      throw new HttpError(400, 'displayName is required (max 80 chars)');
    const invite = this.db
      .prepare('SELECT code FROM invite_codes WHERE code = ?')
      .get(inviteCode.trim()) as { code: string } | undefined;
    if (!invite) throw new HttpError(401, 'invalid invite code');

    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO members (id, display_name, token, invite_code, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, displayName.trim(), token, invite.code, Date.now());
    this.db.prepare('UPDATE invite_codes SET uses = uses + 1 WHERE code = ?').run(invite.code);
    log.info('member joined', { memberId: id });
    return { token, member: { id, displayName: displayName.trim() } };
  }

  memberByToken(token: string): { id: string; displayName: string } | null {
    const row = this.db.prepare('SELECT id, display_name FROM members WHERE token = ?').get(token) as
      | Pick<MemberRow, 'id' | 'display_name'>
      | undefined;
    return row ? { id: row.id, displayName: row.display_name } : null;
  }

  // ---------- me & garage ----------

  me(memberId: string): { id: string; displayName: string; cars: { id: string; name: string }[] } {
    const m = this.db.prepare('SELECT id, display_name FROM members WHERE id = ?').get(memberId) as
      | Pick<MemberRow, 'id' | 'display_name'>
      | undefined;
    if (!m) throw new HttpError(401, 'unknown member');
    const cars = this.db
      .prepare('SELECT id, name FROM cars WHERE member_id = ? ORDER BY created_at')
      .all(memberId) as { id: string; name: string }[];
    return { id: m.id, displayName: m.display_name, cars };
  }

  addCar(memberId: string, name: unknown): { id: string; name: string } {
    if (typeof name !== 'string' || name.trim() === '' || name.length > 120)
      throw new HttpError(400, 'name is required (max 120 chars)');
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO cars (id, member_id, name, created_at) VALUES (?, ?, ?, ?)')
      .run(id, memberId, name.trim(), Date.now());
    return { id, name: name.trim() };
  }

  deleteCar(memberId: string, carId: string): void {
    const res = this.db.prepare('DELETE FROM cars WHERE id = ? AND member_id = ?').run(carId, memberId);
    if (res.changes === 0) throw new HttpError(404, 'car not found');
    // Detach the car from any RSVPs that referenced it.
    this.db.prepare('UPDATE run_attendees SET car_id = NULL WHERE car_id = ?').run(carId);
  }

  // ---------- runs ----------

  private runRow(runId: string): RunRow {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined;
    if (!row) throw new HttpError(404, 'run not found');
    return row;
  }

  private attendeeViews(runId: string): AttendeeView[] {
    const rows = this.db
      .prepare(
        `SELECT ra.member_id, ra.status, m.display_name, c.name AS car_name
         FROM run_attendees ra
         JOIN members m ON m.id = ra.member_id
         LEFT JOIN cars c ON c.id = ra.car_id
         WHERE ra.run_id = ?
         ORDER BY ra.created_at`,
      )
      .all(runId) as { member_id: string; status: AttendeeView['status']; display_name: string; car_name: string | null }[];
    return rows.map((r) => ({
      memberId: r.member_id,
      displayName: r.display_name,
      carName: r.car_name,
      status: r.status,
    }));
  }

  private toRunView(row: RunRow): RunView {
    return {
      id: row.id,
      name: row.name,
      creatorId: row.creator_id,
      meetup: { lat: row.meetup_lat, lng: row.meetup_lng, label: row.meetup_label },
      destination:
        row.dest_lat !== null && row.dest_lng !== null
          ? { lat: row.dest_lat, lng: row.dest_lng, label: row.dest_label ?? '' }
          : null,
      startsAt: row.starts_at,
      state: row.state,
      inviteDeepLink: this.config.deepLinkBase + row.id,
      attendees: this.attendeeViews(row.id),
    };
  }

  getRun(runId: string): RunView {
    return this.toRunView(this.runRow(runId));
  }

  createRun(creatorId: string, body: unknown): RunView {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.name !== 'string' || b.name.trim() === '' || b.name.length > 120)
      throw new HttpError(400, 'name is required (max 120 chars)');
    const meetup = parsePoint(b.meetup, 'meetup', true);
    if (!meetup) throw new HttpError(400, 'meetup is required');
    const destination = parsePoint(b.destination, 'destination', false);
    if (typeof b.startsAt !== 'string' || Number.isNaN(Date.parse(b.startsAt)))
      throw new HttpError(400, 'startsAt must be an ISO-8601 string');

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO runs (id, name, creator_id, meetup_lat, meetup_lng, meetup_label,
                           dest_lat, dest_lng, dest_label, starts_at, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', ?)`,
      )
      .run(
        id,
        b.name.trim(),
        creatorId,
        meetup.lat,
        meetup.lng,
        meetup.label,
        destination?.lat ?? null,
        destination?.lng ?? null,
        destination?.label ?? null,
        b.startsAt,
        Date.now(),
      );
    log.info('run created', { runId: id, creatorId });
    return this.getRun(id);
  }

  /** Upcoming + active first (soonest start first), then recent ended. */
  listRuns(): RunView[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM runs
         ORDER BY CASE state WHEN 'ended' THEN 1 ELSE 0 END,
                  CASE WHEN state = 'ended' THEN -ended_at ELSE NULL END,
                  starts_at`,
      )
      .all() as RunRow[];
    return rows.map((r) => this.toRunView(r));
  }

  rsvp(runId: string, memberId: string, carId: unknown): RunView {
    const run = this.runRow(runId);
    if (run.state === 'ended') throw new HttpError(409, 'run has ended');
    let car: string | null = null;
    if (carId !== null && carId !== undefined) {
      if (typeof carId !== 'string') throw new HttpError(400, 'carId must be a string or null');
      const owned = this.db.prepare('SELECT id FROM cars WHERE id = ? AND member_id = ?').get(carId, memberId);
      if (!owned) throw new HttpError(400, 'carId does not reference one of your cars');
      car = carId;
    }
    const existing = this.db
      .prepare('SELECT status FROM run_attendees WHERE run_id = ? AND member_id = ?')
      .get(runId, memberId) as { status: AttendeeView['status'] } | undefined;
    if (!existing) {
      this.db
        .prepare('INSERT INTO run_attendees (run_id, member_id, car_id, status, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(runId, memberId, car, 'rsvped', Date.now());
    } else {
      // Idempotent: keep 'arrived' if already arrived; re-joining after leave resets to 'rsvped'.
      const status = existing.status === 'arrived' ? 'arrived' : 'rsvped';
      this.db
        .prepare('UPDATE run_attendees SET car_id = ?, status = ? WHERE run_id = ? AND member_id = ?')
        .run(car, status, runId, memberId);
    }
    return this.getRun(runId);
  }

  /** Leave a run. Hard privacy stop: sockets closed, ETA dropped. */
  leave(runId: string, memberId: string): RunView {
    this.runRow(runId);
    this.db
      .prepare("UPDATE run_attendees SET status = 'left' WHERE run_id = ? AND member_id = ?")
      .run(runId, memberId);
    this.etas.get(runId)?.delete(memberId);
    this.realtime.closeMember(runId, memberId);
    log.info('member left run', { runId, memberId });
    return this.getRun(runId);
  }

  startRun(runId: string, memberId: string): RunView {
    const run = this.runRow(runId);
    if (run.creator_id !== memberId) throw new HttpError(403, 'only the creator can start the run');
    if (run.state === 'ended') throw new HttpError(409, 'run has ended');
    if (run.state === 'upcoming') {
      this.db
        .prepare("UPDATE runs SET state = 'active', last_activity_at = ? WHERE id = ?")
        .run(Date.now(), runId);
      this.realtime.broadcast(runId, { type: 'run_state', state: 'active' });
      log.info('run started', { runId });
    }
    return this.getRun(runId); // idempotent when already active
  }

  endRun(runId: string, memberId: string): RunView {
    const run = this.runRow(runId);
    if (run.creator_id !== memberId) throw new HttpError(403, 'only the creator can end the run');
    if (run.state !== 'ended') this.finishRun(runId, 'creator');
    return this.getRun(runId); // idempotent when already ended
  }

  /** Shared end path (creator action or auto-end sweep). */
  finishRun(runId: string, reason: 'creator' | 'auto_end'): void {
    this.db
      .prepare("UPDATE runs SET state = 'ended', ended_at = ? WHERE id = ? AND state != 'ended'")
      .run(Date.now(), runId);
    this.etas.delete(runId);
    this.realtime.broadcast(runId, { type: 'run_state', state: 'ended' });
    this.realtime.closeRun(runId); // hard privacy stop for everyone
    log.info('run ended', { runId, reason });
  }

  // ---------- realtime ingest ----------

  /**
   * Validate + store a position message. Contract: exactly
   * { type:"position", lat, lng, ts } — any extra key (esp. speed) rejects
   * the whole message (Hard Constraint 1). Returns a rejection reason or null.
   */
  ingestPosition(runId: string, memberId: string, msg: Record<string, unknown>): string | null {
    const keys = Object.keys(msg).sort();
    if (keys.length !== 4 || keys[0] !== 'lat' || keys[1] !== 'lng' || keys[2] !== 'ts' || keys[3] !== 'type') {
      return 'unexpected_keys'; // do not echo key names: they must never reach logs
    }
    const { lat, lng, ts } = msg;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return 'invalid_lat';
    if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return 'invalid_lng';
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return 'invalid_ts';

    const run = this.runRow(runId);
    if (run.state !== 'active') return 'run_not_active';
    const attendee = this.db
      .prepare('SELECT status FROM run_attendees WHERE run_id = ? AND member_id = ?')
      .get(runId, memberId) as { status: AttendeeView['status'] } | undefined;
    if (!attendee || attendee.status === 'left') return 'not_joined';

    this.db
      .prepare('INSERT INTO positions (run_id, member_id, lat, lng, ts) VALUES (?, ?, ?, ?, ?)')
      .run(runId, memberId, lat, lng, ts);
    this.db.prepare('UPDATE runs SET last_activity_at = ? WHERE id = ?').run(Date.now(), runId);

    // Geofence auto check-in (spec R3): rsvped member enters 150 m of meetup.
    if (attendee.status === 'rsvped') {
      const dist = haversineMeters(lat, lng, run.meetup_lat, run.meetup_lng);
      if (dist <= this.config.geofenceRadiusM) {
        this.db
          .prepare("UPDATE run_attendees SET status = 'arrived' WHERE run_id = ? AND member_id = ?")
          .run(runId, memberId);
        this.etas.get(runId)?.delete(memberId); // arrived: ETA no longer applies
        this.realtime.broadcast(runId, { type: 'member_arrived', memberId });
        log.info('member arrived (geofence)', { runId, memberId });
      }
    }
    return null;
  }

  /** Validate + store an ETA message (in memory only). */
  ingestEta(runId: string, memberId: string, msg: Record<string, unknown>): string | null {
    const keys = Object.keys(msg).sort();
    if (keys.length !== 2 || keys[0] !== 'etaSeconds' || keys[1] !== 'type') return 'unexpected_keys';
    const { etaSeconds } = msg;
    if (typeof etaSeconds !== 'number' || !Number.isFinite(etaSeconds) || etaSeconds < 0)
      return 'invalid_etaSeconds';

    const run = this.runRow(runId);
    if (run.state !== 'active') return 'run_not_active';
    const attendee = this.db
      .prepare('SELECT status FROM run_attendees WHERE run_id = ? AND member_id = ?')
      .get(runId, memberId) as { status: AttendeeView['status'] } | undefined;
    if (!attendee || attendee.status === 'left') return 'not_joined';
    if (attendee.status === 'arrived') return null; // pre-arrival only; silently ignore

    let runEtas = this.etas.get(runId);
    if (!runEtas) {
      runEtas = new Map();
      this.etas.set(runId, runEtas);
    }
    runEtas.set(memberId, Math.round(etaSeconds));
    return null;
  }

  /** Is this member allowed to hold a socket on this run right now? */
  canConnect(runId: string, memberId: string): { ok: true } | { ok: false; status: number; reason: string } {
    const run = this.db.prepare('SELECT state FROM runs WHERE id = ?').get(runId) as
      | { state: RunRow['state'] }
      | undefined;
    if (!run) return { ok: false, status: 404, reason: 'run not found' };
    if (run.state === 'ended') return { ok: false, status: 403, reason: 'run has ended' };
    const attendee = this.db
      .prepare('SELECT status FROM run_attendees WHERE run_id = ? AND member_id = ?')
      .get(runId, memberId) as { status: AttendeeView['status'] } | undefined;
    if (!attendee || attendee.status === 'left')
      return { ok: false, status: 403, reason: 'not a participant of this run' };
    return { ok: true };
  }

  /** Build the snapshot broadcast for a run (contract shape, verbatim). */
  snapshot(runId: string): SnapshotMessage {
    const run = this.runRow(runId);
    const rows = this.db
      .prepare(
        `SELECT ra.member_id, ra.status, m.display_name, c.name AS car_name
         FROM run_attendees ra
         JOIN members m ON m.id = ra.member_id
         LEFT JOIN cars c ON c.id = ra.car_id
         WHERE ra.run_id = ? AND ra.status != 'left'
         ORDER BY ra.created_at`,
      )
      .all(runId) as { member_id: string; status: 'rsvped' | 'arrived'; display_name: string; car_name: string | null }[];
    const lastPos = this.db.prepare(
      `SELECT lat, lng, ts FROM positions
       WHERE run_id = ? AND member_id = ?
       ORDER BY ts DESC, id DESC LIMIT 1`,
    );
    const runEtas = this.etas.get(runId);
    return {
      type: 'snapshot',
      runState: run.state,
      members: rows.map((r) => {
        const p = lastPos.get(runId, r.member_id) as { lat: number; lng: number; ts: number } | undefined;
        return {
          memberId: r.member_id,
          displayName: r.display_name,
          carName: r.car_name,
          status: r.status,
          lastPosition: p ?? null,
          etaSeconds: runEtas?.get(r.member_id) ?? null,
        };
      }),
    };
  }

  // ---------- sweeps ----------

  /** Auto-end active runs with no position updates for `autoEndAfterMs`. */
  sweepAutoEnd(now = Date.now()): string[] {
    const cutoff = now - this.config.autoEndAfterMs;
    const stale = this.db
      .prepare(
        `SELECT id FROM runs
         WHERE state = 'active' AND COALESCE(last_activity_at, 0) < ?`,
      )
      .all(cutoff) as { id: string }[];
    for (const { id } of stale) this.finishRun(id, 'auto_end');
    return stale.map((r) => r.id);
  }

  /** Purge position history `retentionMs` after a run ends (spec R7 / retention). */
  sweepRetention(now = Date.now()): number {
    const cutoff = now - this.config.retentionMs;
    const res = this.db
      .prepare(
        `DELETE FROM positions WHERE run_id IN
           (SELECT id FROM runs WHERE state = 'ended' AND ended_at IS NOT NULL AND ended_at < ?)`,
      )
      .run(cutoff);
    if (res.changes > 0) log.info('purged position history', { rows: res.changes });
    return res.changes;
  }
}

function parsePoint(value: unknown, field: string, required: boolean): Point | null {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  const v = value as Record<string, unknown>;
  const { lat, lng } = v;
  if (
    typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180
  ) {
    throw new HttpError(400, `${field} must have numeric lat (-90..90) and lng (-180..180)`);
  }
  const label = typeof v.label === 'string' ? v.label : '';
  return { lat, lng, label };
}
