/** E3 session overview: shared row types for `zinin ps`.
 * One row per observed session across machines; adapters fill what their
 * source can prove, merge coalesces, deriveState assigns the final state.
 */
export type PsState = "working" | "idle" | "waiting-tim" | "stuck" | "limit" | "starting" | "closing" | "done";
export interface SessionRow {
  id: string;
  machine: "mac" | "newa" | "unknown";
  engine: string | null;
  model: string | null;
  task: string | null;
  state: PsState;
  lastActivityMs: number | null;
  stuckOn: string | null;
  needs: string | null;
  contextPct: number | null;
  weeklyLimitPct: number | null;
  source: string;
}
export interface MachineInfo { machine: string; memFreeMb: number | null; diskFreeMb: number | null; version?: string | null }
