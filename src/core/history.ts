/** History and cache policy (E2-R03): the journal stays the source of truth;
 * an in-memory window serves the screen with bounded size and paging; recovery
 * rebuilds the window from the journal, so a lost process never loses history.
 * Policy numbers follow the E1 storage proposal reviewed in the handoff:
 * 2000 logical lines per run window, 16 KiB per line, 1 MiB per run cache.
 */
import type { CoreState } from "./journal";

export const historyPolicy = {
  maxLinesPerRun: 2000,
  maxCharsPerLine: 16 * 1024,
  maxBytesPerRun: 1024 * 1024,
} as const;
export interface HistoryLine { seq: number; text: string; ts: string }
export interface Page { lines: HistoryLine[]; total: number; offset: number; limit: number }

function clip(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars - 1) + "…";
}
/** Deterministic projection of the journal into history lines per run.
 * Text is clipped to the policy at projection time, so the cache holds
 * exactly what the screen is allowed to show. */
export function projectHistory(state: CoreState, run_id: string): HistoryLine[] {
  const task = Object.values(state.tasks).find(t => Object.values(state.runs).some(r => r.run_id === run_id && r.task_id === t.task_id));
  if (!task) return [];
  const lines: HistoryLine[] = [];
  const push = (seq: number, text: string, ts: string) => lines.push({ seq, text: clip(text, historyPolicy.maxCharsPerLine), ts });
  push(1, `task ${task.task_id} created: ${task.goal}`, task.task_id);
  for (const step of Object.values(state.steps).filter(s => s.task_id === task.task_id).sort((a, b) => a.step_id.localeCompare(b.step_id))) {
    push(lines.length + 1, `step ${step.step_id} ${step.status} (owner ${step.owner})`, step.step_id);
  }
  for (const result of Object.values(state.results).filter(r => r.task_id === task.task_id)) {
    push(lines.length + 1, `result ${result.result_id} rev=${result.revision} ${result.status} ${result.evidence_ref}`, result.result_id);
  }
  return lines;
}
/** In-memory cache window for one run. Everything outside the window still
 * lives in the journal; `page` reads older slices by re-projecting on demand. */
export class HistoryCache {
  private lines: HistoryLine[];
  private bytes: number;
  constructor(private state: CoreState, private run_id: string) {
    this.lines = projectHistory(state, run_id);
    this.bytes = this.lines.reduce((n, l) => n + l.text.length, 0);
    this.enforce();
  }
  private enforce() {
    while (this.lines.length > historyPolicy.maxLinesPerRun || this.bytes > historyPolicy.maxBytesPerRun) {
      const dropped = this.lines.shift();
      if (!dropped) break;
      this.bytes -= dropped.text.length;
    }
  }
  get size(): number { return this.lines.length; }
  /** Latest lines as shown live. */
  tail(limit = 50): HistoryLine[] {
    return this.lines.slice(Math.max(0, this.lines.length - limit));
  }
  /** Older lines are re-projected from the journal on demand; nothing here
   * can fail to return because the window dropped it. */
  page(offset: number, limit: number): Page {
    const all = projectHistory(this.state, this.run_id);
    return { lines: all.slice(offset, offset + limit), total: all.length, offset, limit };
  }
  /** Case-insensitive substring search over the same projection; reading
   * only, never touches the journal. */
  search(query: string, offset = 0, limit = 50): Page {
    const needle = query.toLowerCase();
    const matches = projectHistory(this.state, this.run_id).filter(l => l.text.toLowerCase().includes(needle));
    return { lines: matches.slice(offset, offset + limit), total: matches.length, offset, limit };
  }
}
