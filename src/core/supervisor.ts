/** Process supervisor: owns real child processes for runs and bridges the
 * lease reconcile output to actual signals. ORCHESTRATION §7 (user stops an
 * owned run; a crash surfaces through observed facts), README stop pattern
 * (SIGTERM first, SIGKILL after grace, own process group only).
 * Library only: the caller drives the loop; no timers inside.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { Database } from "bun:sqlite";
import { LeaseRegistry } from "./leases";

export class SupervisorError extends Error {
  constructor(public readonly code: "not_found" | "malformed", message: string) {
    super(message);
  }
}
interface ProcRow { run_id: string; pid: number; started_at: string; stop_requested_at: string | null; stopped_at: string | null }
export class Supervisor {
  private db: Database;
  private leases: LeaseRegistry;
  private children = new Map<string, ChildProcess>();
  constructor(leasesPath: string, dbPath: string, private graceMs = 5_000) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS supervisor_procs (
        run_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, started_at TEXT NOT NULL,
        stop_requested_at TEXT, stopped_at TEXT);`);
    this.leases = new LeaseRegistry(leasesPath);
  }
  close() { this.leases.close(); this.db.close(); }
  validTime(value: string): string {
    if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
      throw new SupervisorError("malformed", "Invalid host time");
    }
    return value;
  }
  /** Spawn a child for a run and record it durably. */
  start(run_id: string, argv: string[], now: string, cwd?: string): number {
    if (!run_id.trim() || !argv.length) throw new SupervisorError("malformed", "run_id and argv required");
    const at = this.validTime(now);
    if (this.children.has(run_id) || this.row(run_id)) throw new SupervisorError("not_found", `Run ${run_id} already supervised`);
    const child = spawn(argv[0], argv.slice(1), { cwd: cwd ?? "/", stdio: "ignore" });
    const pid = child.pid!;
    this.children.set(run_id, child);
    this.db.query("INSERT INTO supervisor_procs VALUES(?,?,?,NULL,NULL)").run(run_id, pid, at);
    child.on("exit", () => {
      this.children.delete(run_id);
      this.db.query("UPDATE supervisor_procs SET stopped_at=? WHERE run_id=? AND stopped_at IS NULL").run(new Date().toISOString(), run_id);
    });
    return pid;
  }
  private row(run_id: string): ProcRow | null {
    return this.db.query("SELECT * FROM supervisor_procs WHERE run_id=?").get(run_id) as ProcRow | null;
  }
  private alive(row: ProcRow): boolean {
    const child = this.children.get(row.run_id);
    if (child) return child.exitCode === null; // killed flag only means a signal was sent
    // A child from a previous daemon generation: signal 0 probes existence.
    try { process.kill(row.pid, 0); return true; } catch { return false; }
  }
  /** Observed facts for the lease reconcile. */
  liveRunIds(): string[] {
    const rows = this.db.query("SELECT * FROM supervisor_procs WHERE stopped_at IS NULL").all() as ProcRow[];
    return rows.filter(r => this.alive(r)).map(r => r.run_id);
  }
  /** Deliver stop intents from reconcile: SIGTERM once per run. Then sweep
   * every still-pending stop: reaped children are closed out, children past
   * the grace window get SIGKILL. Repeated calls with no new intents deliver
   * no new signals, but escalation stays live for stubborn children. */
  applyStops(now: string): { terminated: string[]; escalated: string[] } {
    const at = this.validTime(now);
    const actions = this.leases.reconcile(this.liveRunIds(), at);
    const terminated: string[] = [];
    const escalated: string[] = [];
    for (const action of actions) {
      if (action.kind !== "stop") continue;
      const row = this.row(action.run_id);
      if (!row || !this.alive(row) || row.stop_requested_at) continue;
      this.db.query("UPDATE supervisor_procs SET stop_requested_at=? WHERE run_id=?").run(at, action.run_id);
      const child = this.children.get(action.run_id);
      if (child) child.kill("SIGTERM"); else process.kill(row.pid, "SIGTERM");
      terminated.push(action.run_id);
    }
    const pending = this.db.query("SELECT * FROM supervisor_procs WHERE stop_requested_at IS NOT NULL AND stopped_at IS NULL").all() as ProcRow[];
    for (const row of pending) {
      const child = this.children.get(row.run_id);
      if (!this.alive(row)) {
        this.db.query("UPDATE supervisor_procs SET stopped_at=? WHERE run_id=?").run(at, row.run_id);
        continue;
      }
      if (Date.parse(at) - Date.parse(row.stop_requested_at!) > this.graceMs) {
        if (child) child.kill("SIGKILL"); else { try { process.kill(row.pid, "SIGKILL"); } catch { /* already gone */ } }
        this.db.query("UPDATE supervisor_procs SET stopped_at=? WHERE run_id=?").run(at, row.run_id);
        escalated.push(row.run_id);
      }
    }
    return { terminated, escalated };
  }
  /** Pending SIGTERM deliveries still within grace (not yet reaped). */
  stoppingRunIds(): string[] {
    const rows = this.db.query("SELECT run_id FROM supervisor_procs WHERE stop_requested_at IS NOT NULL AND stopped_at IS NULL").all() as { run_id: string }[];
    return rows.map(r => r.run_id).filter(run_id => {
      const row = this.row(run_id);
      return row ? this.alive(row) : false;
    });
  }
}
