/** E3 session overview: shared row types for `zinin ps`.
 * One row per observed session across machines; adapters fill what their
 * source can prove, merge coalesces, deriveState assigns the final state.
 */
export type PsState = "working" | "idle" | "waiting-tim" | "stuck" | "limit" | "starting" | "closing" | "done";
/** Independent observations: a submission does not end a worker's activity. */
export type SessionActivity = "working" | "idle" | "starting" | "closing" | "unknown";
export interface SessionEvidence {
  text: string;
  source: "TO-S0.md" | "REPORT-S0.md";
  atMs: number | null;
}
export interface DecisionEvidence extends SessionEvidence {
  freshness: "current" | "stale" | "unknown";
}
export type OverviewGroup = "working" | "waiting" | "submitted" | "idle" | "stopped" | "unknown";
export interface StatusEstimate<T> {
  value: T;
  source: "status-mtime";
  confidence: "estimate";
  atMs: number | null;
}
export interface SessionRow {
  id: string;
  machine: "mac" | "newa" | "unknown";
  engine: string | null;
  model: string | null;
  task: string | null;
  taskSource?: string | null;
  state: PsState;
  lastActivityMs: number | null;
  stuckOn: string | null;
  needs: string | null;
  contextPct: number | null;
  weeklyLimitPct: number | null;
  source: string;
  // Optional for compatibility with E3 adapters and remote payloads.
  liveness?: "alive" | "stopped" | "unknown";
  activity?: SessionActivity;
  decision?: DecisionEvidence | null;
  lastSubmission?: SessionEvidence | null;
  lastSayMs?: number | null;
  overviewGroup?: StatusEstimate<OverviewGroup>;
  possiblyStuck?: StatusEstimate<boolean | null>;
  stoppedReason?: StatusEstimate<string | null>;
}
export interface MachineInfo { machine: string; memFreeMb: number | null; diskFreeMb: number | null; version?: string | null; available?: boolean; warnings?: string[] }
