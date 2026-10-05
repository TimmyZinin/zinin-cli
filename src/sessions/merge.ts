/** E3 merge: rows from several adapters coalesce into one row per session.
 * Priority follows proof quality: a workdir with files beats a tmux presence.
 */
import type { SessionRow } from "./types";

const SOURCE_PRIORITY = ["newa-workdir", "terminal-mac", "tmux", "claude-transcript"];
function rank(source: string): number {
  const index = SOURCE_PRIORITY.indexOf(source);
  return index < 0 ? SOURCE_PRIORITY.length : index;
}
export function mergeRows(rows: SessionRow[]): SessionRow[] {
  const groups = new Map<string, SessionRow[]>();
  for (const row of rows) {
    const key = `${row.machine}:${row.id}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const merged: SessionRow[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => rank(a.source) - rank(b.source));
    const base = ordered[0];
    const pick = <K extends keyof SessionRow>(field: K): SessionRow[K] => {
      for (const row of ordered) {
        const value = row[field];
        if (value !== null && value !== undefined && value !== "") return value;
      }
      return base[field];
    };
    // State: strongest source wins unless it only knows "starting".
    let state = base.state;
    for (const row of ordered) {
      if (row.state !== "starting") { state = row.state; break; }
    }
    if (ordered.every(row => row.state === "starting")) state = "starting";
    // Activity: real mtimes beat tmux's synthetic "alive now".
    const timed = ordered.filter(row => row.source !== "tmux" && row.lastActivityMs !== null);
    const lastActivityMs = base.activity !== undefined ? base.lastActivityMs : timed.length
      ? Math.max(...timed.map(row => row.lastActivityMs as number))
      : pick("lastActivityMs");
    merged.push({
      ...base,
      engine: pick("engine"),
      model: pick("model"),
      task: pick("task"),
      state,
      lastActivityMs,
      stuckOn: pick("stuckOn"),
      needs: base.decision === undefined ? pick("needs") : base.decision?.freshness === "current" ? base.decision.text : null,
      contextPct: pick("contextPct"),
      weeklyLimitPct: pick("weeklyLimitPct"),
      source: Array.from(new Set(ordered.map(row => row.source))).join("+"),
    });
  }
  return merged.sort((a, b) => a.machine === b.machine
    ? a.id.localeCompare(b.id)
    : a.machine.localeCompare(b.machine));
}
