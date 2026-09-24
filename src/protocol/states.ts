/** PRD §2/4 (statuses and acceptance), R05/R06; CONTRACTS §4;
 * ORCHESTRATION §4/7: delivery and provider completion do not accept a Task.
 * These are separate vocabularies, not a coordinator/state-transition engine.
 */
export type WorkSessionState = "idle" | "busy" | "attention" | "limited" | "closed";
export type TaskState = "draft" | "queued" | "active" | "review_ready" | "finalizing" | "done" | "blocked" | "cancelled";
export type StepState = "pending" | "in_progress" | "waiting_user" | "blocked" | "done" | "skipped";
export type RunState = "queued" | "starting" | "running" | "waiting_tool" | "waiting_user" | "rate_limited" | "compacting" | "stopping" | "completed" | "failed" | "cancelled" | "handed_off" | "needs_reconciliation";
export type ApprovalState = "pending" | "allowed" | "denied" | "expired" | "superseded";
export type SyncState = "local_only" | "pending" | "syncing" | "synced" | "conflict" | "failed";
export type DeliveryState = "queued" | "adapter_delivered" | "acknowledged" | "answered" | "expired" | "rejected" | "needs_reconciliation";
export function requiredTodoCount(steps: readonly { required: boolean; state: StepState }[]) {
  const required = steps.filter(step => step.required);
  return { done: required.filter(step => step.state === "done").length, total: required.length };
}
