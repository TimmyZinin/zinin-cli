/** E2 process ownership: leases with epoch fencing, durable stop intents,
 * deterministic reconcile, permission policy for external actions.
 * ORCHESTRATION §2 (epoch fencing), §7 (user stops owned run; crash is not a
 * blind repeat of an external action); R11 (policy/approvals separate from
 * result acceptance); PRD §6 (single local daemon owns leases).
 * SQLite, one local writer; host time comes from the caller. This module
 * records ownership facts and computes actions; it never signals processes
 * itself (the executor adapter does that outside, using reconcile output).
 */
import { Database } from "bun:sqlite";

export type LeaseState = "active" | "released" | "revoked" | "expired";
export interface Lease {
  lease_id: string; run_id: string; session_id: string; actor: string;
  epoch: number; granted_at: string; expires_at: string; state: LeaseState;
}
export type ReconcileAction =
  | { kind: "stop"; run_id: string; reason: string; request_seq: number }
  | { kind: "orphan"; lease_id: string; run_id: string; session_id: string };
export class LeaseError extends Error {
  constructor(public readonly code: "conflict" | "not_found" | "forbidden" | "malformed" | "expired", message: string) {
    super(message);
  }
}
function validTime(value: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new LeaseError("malformed", "Invalid host time");
  }
  return value;
}
function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new LeaseError("malformed", `Missing ${field}`);
  return value;
}
const roles = ["user", "orchestrator", "executor"] as const;
type Role = typeof roles[number];
function role(value: unknown): Role {
  if (typeof value !== "string" || !(roles as readonly string[]).includes(value)) throw new LeaseError("malformed", "Unknown role");
  return value as Role;
}
interface LeaseRow extends Omit<Lease, "epoch"> { epoch: number }
export class LeaseRegistry {
  private db: Database;
  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS leases (
        lease_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, session_id TEXT NOT NULL,
        actor TEXT NOT NULL, epoch INTEGER NOT NULL,
        granted_at TEXT NOT NULL, expires_at TEXT NOT NULL, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS stop_requests (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, reason TEXT NOT NULL,
        requested_at TEXT NOT NULL, emitted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS approvals (
        approval_id TEXT PRIMARY KEY, action TEXT NOT NULL, actor TEXT NOT NULL,
        granted_by TEXT NOT NULL, granted_at TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);`);
  }
  close() { this.db.close(); }
  /** One active lease per run; each grant gets a fresh epoch (fencing). */
  grant(run_id: string, session_id: string, actor: string, now: string, ttl_ms: number): Lease {
    id(run_id, "run_id"); id(session_id, "session_id"); id(actor, "actor");
    const at = validTime(now);
    if (!Number.isSafeInteger(ttl_ms) || ttl_ms <= 0) throw new LeaseError("malformed", "Invalid ttl");
    return this.db.transaction(() => {
      this.sweep(at);
      const active = this.db.query("SELECT lease_id FROM leases WHERE run_id=? AND state='active'").get(run_id);
      if (active) throw new LeaseError("conflict", "Run already has an active lease");
      const epoch = Number((this.db.query("SELECT COALESCE(MAX(epoch),0) AS epoch FROM leases WHERE run_id=?").get(run_id) as { epoch: number }).epoch) + 1;
      const lease_id = `ls-${run_id}-${epoch}`;
      const expires_at = new Date(Date.parse(at) + ttl_ms).toISOString();
      this.db.query("INSERT INTO leases VALUES(?,?,?,?,?,?,?,'active')").run(lease_id, run_id, session_id, actor, epoch, at, expires_at);
      return { lease_id, run_id, session_id, actor, epoch, granted_at: at, expires_at, state: "active" };
    }).immediate();
  }
  private row(lease_id: string): LeaseRow {
    const row = this.db.query("SELECT * FROM leases WHERE lease_id=?").get(lease_id) as LeaseRow | null;
    if (!row) throw new LeaseError("not_found", `Lease ${lease_id} missing`);
    return row;
  }
  private live(row: LeaseRow, now: string): LeaseRow {
    if (row.state === "active" && Date.parse(row.expires_at) <= Date.parse(validTime(now))) {
      this.db.query("UPDATE leases SET state='expired' WHERE lease_id=?").run(row.lease_id);
      throw new LeaseError("expired", `Lease ${row.lease_id} expired`);
    }
    if (row.state !== "active") throw new LeaseError("conflict", `Lease is ${row.state}`);
    return row;
  }
  /** Epoch-fenced operation; stale epochs are rejected (ORCHESTRATION §2). */
  release(lease_id: string, epoch: number, now: string): void {
    this.db.transaction(() => {
      const row = this.live(this.row(lease_id), now);
      if (row.epoch !== epoch) throw new LeaseError("conflict", "Stale lease epoch");
      this.db.query("UPDATE leases SET state='released' WHERE lease_id=?").run(lease_id);
    }).immediate();
  }
  revoke(lease_id: string, epoch: number, now: string): void {
    this.db.transaction(() => {
      const row = this.live(this.row(lease_id), now);
      if (row.epoch !== epoch) throw new LeaseError("conflict", "Stale lease epoch");
      this.db.query("UPDATE leases SET state='revoked' WHERE lease_id=?").run(lease_id);
    }).immediate();
  }
  /** Mark expired leases; returns how many changed. Deterministic, no timers. */
  sweep(now: string): number {
    const at = validTime(now);
    return Number(this.db.query("UPDATE leases SET state='expired' WHERE state='active' AND expires_at<=?").run(at).changes);
  }
  get(lease_id: string): Lease | null {
    const row = this.db.query("SELECT * FROM leases WHERE lease_id=?").get(lease_id) as LeaseRow | null;
    return row ? { ...row } : null;
  }
  /** Durable stop intent, written before any signal is sent. Same run + same
   * pending reason is idempotent; a new reason (or an already-emitted one)
   * records a new request. */
  requestStop(run_id: string, reason: string, now: string): number {
    id(run_id, "run_id"); id(reason, "reason");
    const at = validTime(now);
    return this.db.transaction(() => {
      const pending = this.db.query("SELECT seq FROM stop_requests WHERE run_id=? AND reason=? AND emitted=0").get(run_id, reason) as { seq: number } | null;
      if (pending) return pending.seq;
      this.db.query("INSERT INTO stop_requests(run_id,reason,requested_at) VALUES(?,?,?)").run(run_id, reason, at);
      return Number(this.db.query("SELECT last_insert_rowid() AS seq").get()!.seq);
    }).immediate();
  }
  /** Deterministic reconcile over caller-observed facts: pending stop intents
   * are emitted exactly once; active leases whose run is not observed become
   * orphan actions (reap by revoking the lease; until then they stay derived
   * facts, so a repeated call with the same facts adds no new actions). */
  reconcile(observed_run_ids: string[], now: string): ReconcileAction[] {
    validTime(now);
    const observed = new Set(observed_run_ids);
    return this.db.transaction(() => {
      this.sweep(now);
      const stops = this.db.query("SELECT seq, run_id, reason FROM stop_requests WHERE emitted=0 ORDER BY seq").all() as { seq: number; run_id: string; reason: string }[];
      const actions: ReconcileAction[] = stops.map(s => ({ kind: "stop", run_id: s.run_id, reason: s.reason, request_seq: s.seq }));
      this.db.query("UPDATE stop_requests SET emitted=1 WHERE emitted=0").run();
      const stopping = new Set((this.db.query("SELECT DISTINCT run_id FROM stop_requests").all() as { run_id: string }[]).map(r => r.run_id));
      const leases = this.db.query("SELECT lease_id, run_id, session_id FROM leases WHERE state='active'").all() as { lease_id: string; run_id: string; session_id: string }[];
      for (const lease of leases) {
        if (observed.has(lease.run_id) || stopping.has(lease.run_id)) continue;
        actions.push({ kind: "orphan", lease_id: lease.lease_id, run_id: lease.run_id, session_id: lease.session_id });
      }
      return actions;
    }).immediate();
  }
  /** R11 + owner decision 25.09: internal actions are allowed to known roles;
   * external actions (publish/send outside) additionally need a one-shot
   * human approval, separate from result acceptance. */
  checkInternal(actorRole: string): void {
    role(actorRole);
  }
  approve(action: string, actor: string, granted_by_role: string, now: string): string {
    id(action, "action"); id(actor, "actor");
    if (role(granted_by_role) !== "user") throw new LeaseError("forbidden", "Only the user grants external approvals");
    const at = validTime(now);
    const approval_id = `ap-${action}-${actor}-${Date.parse(at)}`;
    this.db.query("INSERT OR REPLACE INTO approvals VALUES(?,?,?,?,?,0)").run(approval_id, action, actor, granted_by_role, at);
    return approval_id;
  }
  checkExternal(action: string, actor: string, actorRole: string): string {
    id(action, "action"); id(actor, "actor"); role(actorRole);
    return this.db.transaction(() => {
      const approval = this.db.query("SELECT approval_id FROM approvals WHERE action=? AND actor=? AND consumed=0 ORDER BY granted_at LIMIT 1").get(action, actor) as { approval_id: string } | null;
      if (!approval) throw new LeaseError("forbidden", "External action requires a fresh user approval (R11)");
      this.db.query("UPDATE approvals SET consumed=1 WHERE approval_id=?").run(approval.approval_id);
      return approval.approval_id;
    }).immediate();
  }
}
