/** First working cycle: local deterministic executor. Takes the oldest
 * unsubmitted/active task from the core journal, drives it queued -> active,
 * runs its steps under an epoch-fenced lease, records a result with a
 * verification digest, and moves the task to review_ready for the human.
 * PRD R06 (result with evidence), §2 (single writer per task), R08 (all
 * commands carry deterministic ids; reruns resume without duplicates).
 * No network, no model calls; step output comes from a pure function.
 */
import { createHash } from "node:crypto";
import { CoreJournal } from "./journal";
import { LeaseRegistry } from "./leases";

export interface CycleSummary {
  task_id: string; run_id: string; steps_done: string[]; result_id: string | null;
}
/** Pure stand-in for real tool work; deterministic per step id + task goal. */
function performStep(taskGoal: string, stepId: string): string {
  return `artifact for "${taskGoal}" step ${stepId}: local deterministic output`;
}
function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
export class LocalExecutor {
  private journal: CoreJournal;
  private leases: LeaseRegistry;
  constructor(journalPath: string, leasesPath: string) {
    this.journal = new CoreJournal(journalPath);
    this.leases = new LeaseRegistry(leasesPath);
  }
  close() { this.journal.close(); this.leases.close(); }
  private cmd(id: string, type: Parameters<CoreJournal["submit"]>[0]["type"], payload: Record<string, unknown>, now: string) {
    this.journal.submit({ command_id: id, type, payload: payload as never }, now);
  }
  /** Advance at most one task by one full pass; null when nothing to do.
   * Safe to call repeatedly: command ids are deterministic, leases fence
   * concurrent owners, and each phase checks current state first. */
  runOnce(now: string): CycleSummary | null {
    const state = this.journal.state;
    const task = Object.values(state.tasks)
      .filter(t => t.status === "draft" || t.status === "queued" || t.status === "active")
      .sort((a, b) => a.task_id.localeCompare(b.task_id))[0];
    if (!task) return null;
    const taskId = task.task_id;
    const session = state.sessions[task.session_id];
    if (!session) return null;
    if (task.status === "draft") this.cmd(`exec-${taskId}-queued`, "task_transitioned", { task_id: taskId, to: "queued" }, now);
    if (this.journal.state.tasks[taskId].status === "queued") this.cmd(`exec-${taskId}-active`, "task_transitioned", { task_id: taskId, to: "active" }, now);
    const run_id = `run-${taskId}`;
    const started = Object.values(this.journal.state.runs).some(r => r.run_id === run_id);
    let leaseEpoch = 0;
    if (!started) {
      const lease = this.leases.grant(run_id, session.session_id, "local-executor", now, 300_000);
      leaseEpoch = lease.epoch;
      this.cmd(`exec-${taskId}-run`, "run_started", { run_id, task_id: taskId, session_id: session.session_id, provider_session: "local-executor" }, now);
    }
    try {
      let steps = Object.values(this.journal.state.steps).filter(s => s.task_id === taskId).sort((a, b) => a.step_id.localeCompare(b.step_id));
      if (!steps.length) {
        this.cmd(`exec-${taskId}-plan`, "step_defined", { step_id: `${taskId}-deliver`, task_id: taskId, owner: "local-executor", required: true }, now);
        steps = Object.values(this.journal.state.steps).filter(s => s.task_id === taskId);
      }
      const done: string[] = [];
      for (const step of steps) {
        if (step.status === "pending") this.cmd(`exec-${taskId}-${step.step_id}-work`, "step_transitioned", { step_id: step.step_id, to: "working" }, now);
        if (this.journal.state.steps[step.step_id].status === "working") {
          done.push(step.step_id);
          this.cmd(`exec-${taskId}-${step.step_id}-done`, "step_transitioned", { step_id: step.step_id, to: "done" }, now);
        }
      }
      if (this.journal.state.runs[run_id]?.status === "running") this.cmd(`exec-${taskId}-finish`, "run_finished", { run_id, outcome: "succeeded" }, now);
      let result_id: string | null = null;
      const results = Object.values(this.journal.state.results).filter(r => r.task_id === taskId);
      if (!results.length) {
        result_id = `res-${taskId}`;
        const text = done.map(s => performStep(task.goal, s)).join("\n");
        const d = digest(text);
        this.cmd(`exec-${taskId}-result`, "result_recorded", { result_id: result_id, task_id: taskId, revision: 1, digest: d, evidence_ref: `verify:local-sha256:${d}` }, now);
      }
      if (this.journal.state.tasks[taskId].status === "active") this.cmd(`exec-${taskId}-review`, "task_transitioned", { task_id: taskId, to: "review_ready" }, now);
      return { task_id: taskId, run_id, steps_done: done, result_id };
    } finally {
      if (leaseEpoch) {
        try { this.leases.release(`ls-${run_id}-${leaseEpoch}`, leaseEpoch, now); } catch { /* lease may have expired; state already durable */ }
      }
    }
  }
}
