/** E2 core journal: durable events, idempotent commands, state recovery.
 * PRD §2 model, R08 idempotency, R06 acceptance binding; ORCHESTRATION §1/§6.
 * SQLite is the approved durability candidate (ARCHITECTURE §3; E1-002).
 * Append-only entries with a monotone seq; one local writer (the daemon).
 * Commands are validated against folded state before anything is written;
 * replay applies the same rules, so recovery cannot resurrect bad history.
 */
import { Database } from "bun:sqlite";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type TaskStatus = "draft" | "queued" | "active" | "review_ready" | "finalizing" | "done" | "blocked" | "cancelled";
export type StepStatus = "pending" | "working" | "done" | "failed";
export type RunStatus = "running" | "succeeded" | "failed" | "stopped";
export type ResultStatus = "recorded" | "accepted" | "rejected";

export interface AgentState { agent_id: string; role: string; engine: string; status: "active" | "retired" }
export interface SessionState { session_id: string; agent_id: string; service: string; group: string; goal: string; status: "open" | "closed" }
export interface TaskState { task_id: string; session_id: string; goal: string; criteria: string; status: TaskStatus; version: number }
export interface StepState { step_id: string; task_id: string; owner: string; required: boolean; status: StepStatus }
export interface RunState { run_id: string; task_id: string; session_id: string; provider_session: string | null; status: RunStatus }
export interface ResultState { result_id: string; task_id: string; revision: number; digest: string; evidence_ref: string; status: ResultStatus }
export interface CoreState {
  seq: number;
  agents: Record<string, AgentState>;
  sessions: Record<string, SessionState>;
  tasks: Record<string, TaskState>;
  steps: Record<string, StepState>;
  runs: Record<string, RunState>;
  results: Record<string, ResultState>;
}
export const journalEntryTypes = ["agent_registered", "session_opened", "session_closed", "task_created", "task_transitioned", "step_defined", "step_transitioned", "run_started", "run_finished", "result_recorded", "result_decided"] as const;
export type JournalEntryType = typeof journalEntryTypes[number];
export interface JournalCommand { command_id: string; type: JournalEntryType; payload: Json }
export class JournalError extends Error {
  constructor(public readonly code: "conflict" | "not_found" | "malformed" | "corrupt", message: string) {
    super(message);
  }
}
// PRD «Статусы, приёмка и сохранение»: forward-only task pipeline, blocked/cancelled alternatives.
const taskEdges: Record<TaskStatus, TaskStatus[]> = {
  draft: ["queued", "cancelled"],
  queued: ["active", "blocked", "cancelled"],
  active: ["review_ready", "blocked", "cancelled"],
  review_ready: ["finalizing", "cancelled"],
  finalizing: ["done"],
  done: [], blocked: ["queued", "active", "cancelled"], cancelled: [],
};
const stepEdges: Record<StepStatus, StepStatus[]> = { pending: ["working"], working: ["done", "failed"], done: [], failed: ["working"] };
const runOutcomes: Record<string, RunStatus> = { succeeded: "succeeded", failed: "failed", stopped: "stopped" };
const taskStatuses: TaskStatus[] = ["draft", "queued", "active", "review_ready", "finalizing", "done", "blocked", "cancelled"];
const stepStatuses: StepStatus[] = ["pending", "working", "done", "failed"];
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + Array.from(value, canonical).join(",") + "]";
  if (typeof value === "object" && value && Object.getPrototypeOf(value) === Object.prototype) {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  }
  throw new JournalError("malformed", "Payload must contain only JSON values");
}
function record(value: Json): Record<string, Json> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new JournalError("malformed", "Payload must be an object");
  return value as Record<string, Json>;
}
function str(payload: Record<string, Json>, field: string): string {
  const v = payload[field];
  if (typeof v !== "string" || !v.trim()) throw new JournalError("malformed", `Missing ${field}`);
  return v;
}
function bool(payload: Record<string, Json>, field: string): boolean {
  const v = payload[field];
  if (typeof v !== "boolean") throw new JournalError("malformed", `Missing ${field}`);
  return v;
}
function int(payload: Record<string, Json>, field: string): number {
  const v = payload[field];
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new JournalError("malformed", `Missing ${field}`);
  return v;
}
function validTime(value: string): string {
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new JournalError("malformed", "Invalid recorded_at");
  return value;
}
function emptyState(): CoreState {
  return { seq: 0, agents: {}, sessions: {}, tasks: {}, steps: {}, runs: {}, results: {} };
}
export class CoreJournal {
  private db: Database;
  state: CoreState;
  constructor(path: string, private snapshotRetention = 3) {
    this.db = new Database(path, { create: true });
    this.db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS journal_entries (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL, command_id TEXT NOT NULL,
        payload TEXT NOT NULL, recorded_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS command_outcomes (
        command_id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS journal_snapshots (
        seq INTEGER PRIMARY KEY, state TEXT NOT NULL, taken_at TEXT NOT NULL);`);
    this.state = this.recover();
  }
  close() { this.db.close(); }
  refresh(): CoreState { this.state = this.recover(); return this.state; }
  /** R08: identical resubmission returns the recorded outcome without new entries;
   * the same command_id with a different payload is a conflict, never applied. */
  submit(command: JournalCommand, recorded_at: string): { duplicate: boolean; seq: number } {
    if (typeof command !== "object" || command === null) throw new JournalError("malformed", "Command required");
    if (typeof command.command_id !== "string" || !command.command_id.trim()) throw new JournalError("malformed", "Missing command_id");
    if (!journalEntryTypes.includes(command.type)) throw new JournalError("malformed", "Unknown entry type");
    const at = validTime(recorded_at);
    const payload = record(command.payload);
    const encoded = canonical(payload);
    this.validate(command.type, payload);
    return this.db.transaction(() => {
      const old = this.db.query("SELECT o.seq, o.payload, e.type FROM command_outcomes o JOIN journal_entries e ON e.seq=o.seq WHERE o.command_id=?").get(command.command_id) as { seq: number; payload: string; type: string } | null;
      if (old) {
        if (old.payload !== encoded || old.type !== command.type) throw new JournalError("conflict", "Command ID has different payload");
        this.refresh();
        return { duplicate: true, seq: old.seq };
      }
      const next = structuredClone(this.refresh());
      this.applyTo(next, command.type, payload);
      next.seq++;
      this.db.query("INSERT INTO journal_entries(type,command_id,payload,recorded_at) VALUES(?,?,?,?)").run(command.type, command.command_id, encoded, at);
      const seq = Number(this.db.query("SELECT last_insert_rowid() AS seq").get()!.seq);
      this.db.query("INSERT INTO command_outcomes(command_id,seq,payload) VALUES(?,?,?)").run(command.command_id, seq, encoded);
      this.state = next;
      return { duplicate: false, seq };
    }).immediate();
  }
  snapshot(taken_at: string): number {
    const at = validTime(taken_at);
    this.db.query("INSERT OR REPLACE INTO journal_snapshots(seq,state,taken_at) VALUES(?,?,?)").run(this.state.seq, JSON.stringify(this.state), at);
    // Evict older snapshots: they are derived recovery copies (PRD §6 limits
    // copies, never journal entries). Keep the newest snapshotRetention.
    this.db.query(`DELETE FROM journal_snapshots WHERE seq NOT IN (
      SELECT seq FROM journal_snapshots ORDER BY seq DESC LIMIT ?)`).run(this.snapshotRetention);
    return this.state.seq;
  }
  private recover(): CoreState {
    const snap = this.db.query("SELECT seq, state FROM journal_snapshots ORDER BY seq DESC LIMIT 1").get() as { seq: number; state: string } | null;
    const state: CoreState = snap ? JSON.parse(snap.state) : emptyState();
    const rows = this.db.query("SELECT seq, type, payload FROM journal_entries WHERE seq>? ORDER BY seq").all(snap?.seq ?? 0) as { seq: number; type: JournalEntryType; payload: string }[];
    for (const row of rows) {
      try { this.applyTo(state, row.type, JSON.parse(row.payload)); state.seq = row.seq; }
      catch (error) { throw new JournalError("corrupt", `Journal entry ${row.seq} failed replay: ${(error as Error).message}`); }
    }
    return state;
  }
  /** Full independent fold, used by tests and recovery checks. */
  static fold(path: string): CoreState {
    const probe = new CoreJournal(path);
    try {
      const state = emptyState();
      const rows = probe.db.query("SELECT seq, type, payload FROM journal_entries ORDER BY seq").all() as { seq: number; type: JournalEntryType; payload: string }[];
      for (const row of rows) { probe.applyTo(state, row.type, JSON.parse(row.payload)); state.seq = row.seq; }
      return state;
    } finally { probe.close(); }
  }
  private validate(type: JournalEntryType, payload: Record<string, Json>): void {
    switch (type) {
      case "agent_registered": str(payload, "agent_id"); str(payload, "role"); str(payload, "engine"); break;
      case "session_opened": str(payload, "session_id"); str(payload, "agent_id"); str(payload, "service"); str(payload, "group"); str(payload, "goal"); break;
      case "session_closed": str(payload, "session_id"); break;
      case "task_created": str(payload, "task_id"); str(payload, "session_id"); str(payload, "goal"); str(payload, "criteria"); break;
      case "task_transitioned": str(payload, "task_id"); if (!taskStatuses.includes(str(payload, "to") as TaskStatus)) throw new JournalError("malformed", "Unknown task status"); break;
      case "step_defined": str(payload, "step_id"); str(payload, "task_id"); str(payload, "owner"); bool(payload, "required"); break;
      case "step_transitioned": str(payload, "step_id"); if (!stepStatuses.includes(str(payload, "to") as StepStatus)) throw new JournalError("malformed", "Unknown step status"); break;
      case "run_started": str(payload, "run_id"); str(payload, "task_id"); str(payload, "session_id"); break;
      case "run_finished": str(payload, "run_id"); if (!(str(payload, "outcome") in runOutcomes)) throw new JournalError("malformed", "Unknown outcome"); break;
      case "result_recorded": str(payload, "result_id"); str(payload, "task_id"); int(payload, "revision"); str(payload, "digest"); str(payload, "evidence_ref"); break;
      case "result_decided":
        str(payload, "result_id"); str(payload, "decision"); str(payload, "decided_by");
        if (payload.expected_revision !== undefined || payload.expected_digest !== undefined) { int(payload, "expected_revision"); str(payload, "expected_digest"); }
        break;
    }
    canonical(payload);
  }
  /** Single rule set for accept-time and replay-time application. */
  private applyTo(s: CoreState, type: JournalEntryType, p: Record<string, Json>): void {
    const need = <T>(table: Record<string, T>, id: string, what: string): T => {
      const v = table[id];
      if (!v) throw new JournalError("not_found", `${what} ${id} missing`);
      return v;
    };
    switch (type) {
      case "agent_registered": {
        const id = str(p, "agent_id");
        if (s.agents[id]) throw new JournalError("conflict", `Agent ${id} already registered`);
        s.agents[id] = { agent_id: id, role: str(p, "role"), engine: str(p, "engine"), status: "active" };
        break;
      }
      case "session_opened": {
        const id = str(p, "session_id");
        if (s.sessions[id]) throw new JournalError("conflict", `Session ${id} already open`);
        need(s.agents, str(p, "agent_id"), "Agent");
        s.sessions[id] = { session_id: id, agent_id: str(p, "agent_id"), service: str(p, "service"), group: str(p, "group"), goal: str(p, "goal"), status: "open" };
        break;
      }
      case "session_closed": {
        const session = need(s.sessions, str(p, "session_id"), "Session");
        if (p.require_idle === true && Object.values(s.runs).some(run => run.session_id === session.session_id && run.status === "running")) throw new JournalError("conflict", "Session has an active run");
        session.status = "closed"; break;
      }
      case "task_created": {
        const id = str(p, "task_id");
        if (s.tasks[id]) throw new JournalError("conflict", `Task ${id} already exists`);
        const session = need(s.sessions, str(p, "session_id"), "Session");
        if (session.status !== "open") throw new JournalError("conflict", "Session is closed");
        s.tasks[id] = { task_id: id, session_id: session.session_id, goal: str(p, "goal"), criteria: str(p, "criteria"), status: "draft", version: 1 };
        break;
      }
      case "task_transitioned": {
        const task = need(s.tasks, str(p, "task_id"), "Task");
        const to = str(p, "to") as TaskStatus;
        if (!taskEdges[task.status].includes(to)) throw new JournalError("conflict", `Task cannot go ${task.status} -> ${to}`);
        if (to === "finalizing" && !Object.values(s.results).some(r => r.task_id === task.task_id && r.status === "accepted")) {
          throw new JournalError("conflict", "finalizing requires an accepted result (PRD R06)");
        }
        task.status = to;
        break;
      }
      case "step_defined": {
        const id = str(p, "step_id");
        if (s.steps[id]) throw new JournalError("conflict", `Step ${id} already defined`);
        need(s.tasks, str(p, "task_id"), "Task");
        s.steps[id] = { step_id: id, task_id: str(p, "task_id"), owner: str(p, "owner"), required: bool(p, "required"), status: "pending" };
        break;
      }
      case "step_transitioned": {
        const step = need(s.steps, str(p, "step_id"), "Step");
        const to = str(p, "to") as StepStatus;
        if (!stepEdges[step.status].includes(to)) throw new JournalError("conflict", `Step cannot go ${step.status} -> ${to}`);
        step.status = to;
        break;
      }
      case "run_started": {
        const id = str(p, "run_id");
        if (s.runs[id]) throw new JournalError("conflict", `Run ${id} already started`);
        const task = need(s.tasks, str(p, "task_id"), "Task");
        const session = need(s.sessions, str(p, "session_id"), "Session");
        if (task.status !== "active") throw new JournalError("conflict", "Runs start only on active tasks");
        if (session.status !== "open") throw new JournalError("conflict", "Session is closed");
        if (session.session_id !== task.session_id) throw new JournalError("conflict", "Run session must match the task session");
        const running = Object.values(s.runs).some(r => r.task_id === task.task_id && r.status === "running");
        if (running) throw new JournalError("conflict", "One running run per task (single writer, PRD §2)");
        const provider = p.provider_session;
        s.runs[id] = { run_id: id, task_id: task.task_id, session_id: session.session_id, provider_session: typeof provider === "string" ? provider : null, status: "running" };
        break;
      }
      case "run_finished": {
        const run = need(s.runs, str(p, "run_id"), "Run");
        if (run.status !== "running") throw new JournalError("conflict", `Run is ${run.status}`);
        run.status = runOutcomes[str(p, "outcome")];
        break;
      }
      case "result_recorded": {
        const id = str(p, "result_id");
        if (s.results[id]) throw new JournalError("conflict", `Result ${id} already recorded`);
        need(s.tasks, str(p, "task_id"), "Task");
        s.results[id] = { result_id: id, task_id: str(p, "task_id"), revision: int(p, "revision"), digest: str(p, "digest"), evidence_ref: str(p, "evidence_ref"), status: "recorded" };
        break;
      }
      case "result_decided": {
        const result = need(s.results, str(p, "result_id"), "Result");
        // New addressed commands bind the displayed immutable result. Legacy
        // journal entries without binding remain replayable unchanged.
        if (p.expected_revision !== undefined || p.expected_digest !== undefined) {
          if (int(p, "expected_revision") !== result.revision || str(p, "expected_digest") !== result.digest) throw new JournalError("conflict", "Result revision/digest changed");
          const task = need(s.tasks, result.task_id, "Task");
          if (task.status !== "review_ready" || Object.values(s.runs).some(run => run.task_id === task.task_id && run.status === "running")) throw new JournalError("conflict", "Task is not ready for acceptance");
          if (Object.values(s.results).some(other => other.task_id === result.task_id && other.revision > result.revision && other.status !== "rejected")) throw new JournalError("conflict", "A newer result revision exists");
        }
        if (result.status !== "recorded") throw new JournalError("conflict", `Result is ${result.status}`);
        const decision = str(p, "decision");
        if (decision !== "accepted" && decision !== "rejected") throw new JournalError("malformed", "Unknown decision");
        result.status = decision;
        if (decision === "accepted") {
          const task = need(s.tasks, result.task_id, "Task");
          task.version = Math.max(task.version, result.revision);
        }
        break;
      }
    }
  }
}
