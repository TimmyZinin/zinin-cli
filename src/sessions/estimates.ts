import type { SessionRow, StatusEstimate, OverviewGroup } from "./types";

export const QUESTION_WINDOW_MINUTES = 20;
export const RUNNING_STALE_MINUTES = 20;
export interface EstimateOptions { questionMinutes?: number; runningMinutes?: number }
const threshold = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
const time = (value: number | null, now: number) =>
  value !== null && Number.isFinite(value) && value >= 0 && value <= now ? value : null;

/** S0 E4-002: estimates never change exact liveness/decision freshness. */
export function addStatusEstimates(row: SessionRow, statusText: string | null,
  statusMtimeMs: number | null, toMtimeMs: number | null, nowMs: number,
  options: EstimateOptions = {}): SessionRow {
  let status: Record<string, unknown> = {};
  try { const parsed = JSON.parse(statusText ?? "null"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) status = parsed; } catch { /* unknown */ }
  const atMs = time(statusMtimeMs, nowMs);
  const questionAt = time(row.decision?.atMs ?? toMtimeMs, nowMs);
  const questionRecent = row.decision !== null && row.decision !== undefined && atMs !== null && questionAt !== null &&
    questionAt >= atMs - threshold(options.questionMinutes, QUESTION_WINDOW_MINUTES) * 60_000;
  let group: OverviewGroup = "unknown";
  if (status.state === "running") group = "working";
  else if (status.state === "failed" || status.state === "timeout") group = "stopped";
  else if (status.state === "idle") group = row.waitingKind || questionRecent ? "waiting" : row.lastSubmission ? "submitted" : "idle";
  const estimate = <T>(value: T): StatusEstimate<T> => ({ value, source: "status-mtime", confidence: "estimate", atMs });
  return { ...row,
    overviewGroup: estimate(group),
    possiblyStuck: estimate(status.state === "running" ? atMs === null ? null : nowMs - atMs > threshold(options.runningMinutes, RUNNING_STALE_MINUTES) * 60_000 : false),
    stoppedReason: estimate(group === "stopped" && typeof status.reason === "string" ? Array.from(status.reason).slice(0, 240).join("") : null),
  };
}
