import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreJournal, JournalError, type JournalCommand } from "../../src/core/journal";

// Synthetic IDs only (CONTRACTS §9). No provider calls or real task data.
const t0 = "2026-09-25T00:00:00Z";
function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), "zinin-e2-journal-")), "core.sqlite");
  return { path, journal: new CoreJournal(path) };
}
function cmd(command_id: string, type: JournalCommand["type"], payload: JournalCommand["payload"]): JournalCommand {
  return { command_id, type, payload };
}
function errorCode(action: () => unknown, code: string) {
  try { action(); throw new Error("Expected journal rejection"); }
  catch (error) { expect(error).toBeInstanceOf(JournalError); expect((error as JournalError).code).toBe(code); }
}
function bootstrap(journal: CoreJournal) {
  journal.submit(cmd("c1", "agent_registered", { agent_id: "a1", role: "orchestrator", engine: "kimi" }), t0);
  journal.submit(cmd("c2", "session_opened", { session_id: "s1", agent_id: "a1", service: "svc", group: "grp", goal: "g" }), t0);
  journal.submit(cmd("c3", "task_created", { task_id: "t1", session_id: "s1", goal: "goal", criteria: "crit" }), t0);
  journal.submit(cmd("c4", "step_defined", { step_id: "st1", task_id: "t1", owner: "a1", required: true }), t0);
  journal.submit(cmd("c5", "task_transitioned", { task_id: "t1", to: "queued" }), t0);
  journal.submit(cmd("c6", "task_transitioned", { task_id: "t1", to: "active" }), t0);
}
test("happy path: full task lifecycle with run and accepted result", () => {
  const { journal } = fixture();
  try {
    bootstrap(journal);
    journal.submit(cmd("c7", "run_started", { run_id: "r1", task_id: "t1", session_id: "s1", provider_session: "p1" }), t0);
    journal.submit(cmd("c8", "step_transitioned", { step_id: "st1", to: "working" }), t0);
    journal.submit(cmd("c9", "step_transitioned", { step_id: "st1", to: "done" }), t0);
    journal.submit(cmd("c10", "run_finished", { run_id: "r1", outcome: "succeeded" }), t0);
    journal.submit(cmd("c11", "result_recorded", { result_id: "res1", task_id: "t1", revision: 1, digest: "d1", evidence_ref: "e1" }), t0);
    journal.submit(cmd("c12", "task_transitioned", { task_id: "t1", to: "review_ready" }), t0);
    journal.submit(cmd("c13", "result_decided", { result_id: "res1", decision: "accepted", decided_by: "tim" }), t0);
    expect(journal.state.tasks.t1.version).toBe(1);
    journal.submit(cmd("c14", "task_transitioned", { task_id: "t1", to: "finalizing" }), t0);
    journal.submit(cmd("c15", "task_transitioned", { task_id: "t1", to: "done" }), t0);
    expect(journal.state.tasks.t1.status).toBe("done");
    expect(journal.state.runs.r1.status).toBe("succeeded");
    expect(journal.state.results.res1.status).toBe("accepted");
    expect(journal.state.seq).toBe(15);
  } finally { journal.close(); }
});
test("R08: identical resubmission returns recorded outcome without new entries", () => {
  const { journal } = fixture();
  try {
    bootstrap(journal);
    const again = journal.submit(cmd("c6", "task_transitioned", { task_id: "t1", to: "active" }), t0);
    expect(again).toEqual({ duplicate: true, seq: 6 });
    expect(journal.state.seq).toBe(6);
  } finally { journal.close(); }
});
test("R08: same command_id with different payload is a conflict, never applied", () => {
  const { journal } = fixture();
  try {
    bootstrap(journal);
    errorCode(() => journal.submit(cmd("c6", "task_transitioned", { task_id: "t1", to: "queued" }), t0), "conflict");
    expect(journal.state.seq).toBe(6);
    expect(journal.state.tasks.t1.status).toBe("active");
  } finally { journal.close(); }
});
test("task pipeline is forward-only; finalizing requires an accepted result (PRD R06)", () => {
  const { journal } = fixture();
  try {
    bootstrap(journal);
    errorCode(() => journal.submit(cmd("x1", "task_transitioned", { task_id: "t1", to: "done" }), t0), "conflict");
    journal.submit(cmd("x2", "task_transitioned", { task_id: "t1", to: "review_ready" }), t0);
    errorCode(() => journal.submit(cmd("x3", "task_transitioned", { task_id: "t1", to: "finalizing" }), t0), "conflict");
    expect(journal.state.tasks.t1.status).toBe("review_ready");
    errorCode(() => journal.submit(cmd("x4", "task_transitioned", { task_id: "missing", to: "active" }), t0), "not_found");
  } finally { journal.close(); }
});
test("one running run per task; runs start only on active tasks", () => {
  const { journal } = fixture();
  try {
    bootstrap(journal);
    journal.submit(cmd("y0", "task_created", { task_id: "t2", session_id: "s1", goal: "g2", criteria: "c2" }), t0);
    errorCode(() => journal.submit(cmd("y1", "run_started", { run_id: "r0", task_id: "t2", session_id: "s1" }), t0), "conflict");
    errorCode(() => journal.submit(cmd("y1b", "run_started", { run_id: "r0", task_id: "missing", session_id: "s1" }), t0), "not_found");
    journal.submit(cmd("y2", "run_started", { run_id: "r1", task_id: "t1", session_id: "s1" }), t0);
    errorCode(() => journal.submit(cmd("y3", "run_started", { run_id: "r2", task_id: "t1", session_id: "s1" }), t0), "conflict");
    journal.submit(cmd("y4", "run_finished", { run_id: "r1", outcome: "stopped" }), t0);
    journal.submit(cmd("y5", "run_started", { run_id: "r2", task_id: "t1", session_id: "s1" }), t0);
    expect(journal.state.runs.r2.status).toBe("running");
  } finally { journal.close(); }
});
test("closed session rejects new work; duplicate entities are conflicts", () => {
  const { journal } = fixture();
  try {
    bootstrap(journal);
    errorCode(() => journal.submit(cmd("z1", "session_opened", { session_id: "s1", agent_id: "a1", service: "svc", group: "grp", goal: "g2" }), t0), "conflict");
    journal.submit(cmd("z2", "session_closed", { session_id: "s1" }), t0);
    errorCode(() => journal.submit(cmd("z3", "run_started", { run_id: "r9", task_id: "t1", session_id: "s1" }), t0), "conflict");
    errorCode(() => journal.submit(cmd("z4", "task_created", { task_id: "t9", session_id: "s1", goal: "g", criteria: "c" }), t0), "conflict");
  } finally { journal.close(); }
});
test("recovery: reopened journal rebuilds identical state and continues the sequence", () => {
  const { path, journal } = fixture();
  bootstrap(journal);
  journal.submit(cmd("c7", "run_started", { run_id: "r1", task_id: "t1", session_id: "s1" }), t0);
  journal.close();
  const reopened = new CoreJournal(path);
  try {
    expect(reopened.state).toEqual(CoreJournal.fold(path));
    const next = reopened.submit(cmd("c8", "step_transitioned", { step_id: "st1", to: "working" }), t0);
    expect(next.duplicate).toBe(false);
    expect(reopened.state.steps.st1.status).toBe("working");
  } finally { reopened.close(); }
});
test("snapshot plus tail replay equals a full independent fold", () => {
  const { path, journal } = fixture();
  bootstrap(journal);
  journal.snapshot(t0);
  journal.submit(cmd("c7", "run_started", { run_id: "r1", task_id: "t1", session_id: "s1" }), t0);
  journal.submit(cmd("c8", "run_finished", { run_id: "r1", outcome: "failed" }), t0);
  journal.close();
  const reopened = new CoreJournal(path);
  try {
    expect(reopened.state).toEqual(CoreJournal.fold(path));
    expect(reopened.state.runs.r1.status).toBe("failed");
    expect(reopened.state.seq).toBe(8);
  } finally { reopened.close(); }
});
