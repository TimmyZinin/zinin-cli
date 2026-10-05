/** First working cycle: local deterministic executor. Takes the oldest
 * unsubmitted/active task from the core journal, drives it queued -> active,
 * runs its steps under an epoch-fenced lease, records a result with a
 * verification digest, and moves the task to review_ready for the human.
 * PRD R06 (result with evidence), §2 (single writer per task), R08 (all
 * commands carry deterministic ids; reruns resume without duplicates).
 * No network, no model calls; step output comes from a pure function.
 */
import { createHash } from "node:crypto";
import { CoreJournal, JournalError } from "./journal";
import { LeaseRegistry } from "./leases";

export interface EngineLike {
  run(prompt: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<{ text: string; provider_session: string | null }>;
}
export interface CycleSummary {
  task_id: string; run_id: string; steps_done: string[]; result_id: string | null;
  provider_session?: string | null; error?: string;
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
  constructor(journalPath: string, leasesPath: string, private engine?: EngineLike, private engineName = engine ? "kimi-cli" : "local-demo") {
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
  async runOnce(now: string): Promise<CycleSummary | null> {
    const task = Object.values(this.journal.refresh().tasks)
      .filter(t => t.status === "draft" || t.status === "queued" || t.status === "active")
      .sort((a, b) => a.task_id.localeCompare(b.task_id))[0];
    return task ? this.runTask(task.task_id, now) : null;
  }
  /** Explicit target only: no fallback to another queued task or session. */
  async runTask(taskId: string, now: string): Promise<CycleSummary | null> {
    const state = this.journal.refresh();
    const task = state.tasks[taskId];
    if (!task) throw new JournalError("not_found", `Task ${taskId} missing`);
    if (state.sessions[task.session_id]?.status !== "open") throw new JournalError("conflict", "Session is closed");
    if (["review_ready", "finalizing", "done"].includes(task.status)) return null;
    if (!["draft", "queued", "active"].includes(task.status)) throw new JournalError("conflict", `Task is ${task.status}`);
    if (Object.values(state.runs).some(run => run.task_id === taskId && run.status === "running")) throw new JournalError("conflict", "Task already has an active run");
    const session = state.sessions[task.session_id];
    if (!session) return null;
    if (task.status === "draft") this.cmd(`exec-${taskId}-queued`, "task_transitioned", { task_id: taskId, to: "queued" }, now);
    if (this.journal.state.tasks[taskId].status === "queued") this.cmd(`exec-${taskId}-active`, "task_transitioned", { task_id: taskId, to: "active" }, now);
    const attempt = Object.values(this.journal.state.runs).filter(r => r.task_id === taskId).length + 1;
    const run_id = `run-${taskId}-${attempt}`;
    let leaseEpoch = 0;
    try {
      if (!Object.values(this.journal.state.runs).some(r => r.run_id === run_id)) {
        const lease = this.leases.grant(run_id, session.session_id, "local-executor", now, 300_000);
        leaseEpoch = lease.epoch;
        this.cmd(`exec-${taskId}-run-${attempt}`, "run_started", { run_id, task_id: taskId, session_id: session.session_id, provider_session: this.engineName }, now);
      }
      let steps = Object.values(this.journal.state.steps).filter(s => s.task_id === taskId).sort((a, b) => a.step_id.localeCompare(b.step_id));
      if (!steps.length) {
        this.cmd(`exec-${taskId}-plan`, "step_defined", { step_id: `${taskId}-deliver`, task_id: taskId, owner: "local-executor", required: true }, now);
        steps = Object.values(this.journal.state.steps).filter(s => s.task_id === taskId);
      }
      const done: string[] = [];
      const outputs: string[] = [];
      let provider_session: string | null = null;
      for (const step of steps) {
        if (step.status === "pending") this.cmd(`exec-${taskId}-${step.step_id}-work`, "step_transitioned", { step_id: step.step_id, to: "working" }, now);
        if (this.journal.state.steps[step.step_id].status === "working") {
          try {
            if (this.engine) {
              const produced = await this.engine.run(`Задача: ${task.goal}\nШаг: ${step.step_id}\nВерни краткий итог шага одним абзацем.`, { timeoutMs: 120_000 });
              provider_session = provider_session ?? produced.provider_session;
              outputs.push(produced.text);
            } else {
              outputs.push(performStep(task.goal, step.step_id));
            }
          } catch (error) {
            this.cmd(`exec-${taskId}-finish-${attempt}`, "run_finished", { run_id, outcome: "failed" }, now);
            return { task_id: taskId, run_id, steps_done: done, result_id: null, provider_session, error: (error as Error).message };
          }
          this.cmd(`exec-${taskId}-${step.step_id}-done`, "step_transitioned", { step_id: step.step_id, to: "done" }, now);
          done.push(step.step_id);
        }
      }
      if (this.journal.state.runs[run_id]?.status === "running") this.cmd(`exec-${taskId}-finish-${attempt}`, "run_finished", { run_id, outcome: "succeeded" }, now);
      let result_id: string | null = null;
      const results = Object.values(this.journal.state.results).filter(r => r.task_id === taskId);
      if (!results.length) {
        result_id = `res-${taskId}`;
        const text = outputs.join("\n");
        const d = digest(text);
        const evidence = provider_session ? `verify:local-sha256:${d};engine-session:${provider_session}` : `verify:local-sha256:${d}${this.engine ? "" : ";mode:local-demo"}`;
        this.cmd(`exec-${taskId}-result`, "result_recorded", { result_id: result_id, task_id: taskId, revision: 1, digest: d, evidence_ref: evidence }, now);
      }
      if (this.journal.state.tasks[taskId].status === "active") this.cmd(`exec-${taskId}-review`, "task_transitioned", { task_id: taskId, to: "review_ready" }, now);
      return { task_id: taskId, run_id, steps_done: done, result_id, provider_session };
    } finally {
      if (leaseEpoch) {
        try { this.leases.release(`ls-${run_id}-${leaseEpoch}`, leaseEpoch, now); } catch { /* lease may have expired; state already durable */ }
      }
    }
  }
}
