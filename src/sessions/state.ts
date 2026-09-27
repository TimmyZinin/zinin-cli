/** E3 state derivation: accepted rules v2 (jev-packets/e3-session-overview-v2.json,
 * receipt 26.09: state_rules_v2_ok 0.85, limit_state_warranted 0.89).
 * Every state has an exact proof signal; conflicts resolve by priority:
 * done > closing > limit > waiting-tim > starting > stuck > working > idle.
 */
import type { SessionRow, PsState } from "./types";

/** Silence budget per engine, in minutes (README «zinin ps»). */
export const STUCK_MINUTES_BY_ENGINE: Record<string, number> = {
  claude: 20,   // streams continuously while working; compaction is minutes
  kimi: 30,     // turn cycle: <=600s hop + up to 1800s waiting for say
  codex: 30,    // same turn-based cycle as kimi
  unknown: 30,
};
export const WEEKLY_LIMIT_NEAR = 95;

export function stuckThresholdMs(engine: string | null, overrideMinutes?: number): number {
  if (overrideMinutes !== undefined && Number.isFinite(overrideMinutes) && overrideMinutes > 0) {
    return overrideMinutes * 60_000;
  }
  const minutes = STUCK_MINUTES_BY_ENGINE[(engine ?? "unknown").toLowerCase()] ?? STUCK_MINUTES_BY_ENGINE.unknown;
  return minutes * 60_000;
}
export function deriveState(row: SessionRow, nowMs: number, stuckOverrideMinutes?: number): PsState {
  // 1 done / 2 closing: terminal lifecycle facts recorded by adapters.
  if (row.state === "done" || row.state === "closing") return row.state;
  // 3 limit: alive but pinned against a quota — structural signal only (N-1):
  // the weekly limit percentage, never a stray "403" inside some text.
  if (row.weeklyLimitPct !== null && row.weeklyLimitPct >= WEEKLY_LIMIT_NEAR) return "limit";
  // 4 waiting-tim: a human answer unblocks it.
  if (row.state === "waiting-tim" || row.needs !== null) return "waiting-tim";
  // 5 starting: transient, disappears once the first turns land.
  if (row.state === "starting") return "starting";
  // 6 stuck: only a session expected to be working can be stuck; idle silence is normal.
  if (row.state === "working" && row.lastActivityMs !== null) {
    if (nowMs - row.lastActivityMs > stuckThresholdMs(row.engine, stuckOverrideMinutes)) return "stuck";
  }
  // 7 working / 8 idle: base observation.
  return row.state;
}
export function applyDerivedStates(rows: SessionRow[], nowMs: number, stuckOverrideMinutes?: number): SessionRow[] {
  return rows.map(row => ({ ...row, state: deriveState(row, nowMs, stuckOverrideMinutes) }));
}
