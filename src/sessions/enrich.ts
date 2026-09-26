/** E3 enrichment: attach transcript facts to the ONE window that owns the
 * session (N-4). Two windows of the same project must not share movement
 * time or errors — the parked window keeps an honest "—".
 */
import type { SessionRow } from "./types";

export interface SlugFacts { lastActivityMs: number; stuckOn: string | null }
export interface WindowScreen {
  statusline: string;
  cwd: string | null;
  spinning: boolean;
  busy: boolean;
}
function signal(row: SessionRow, screen: WindowScreen | undefined): number {
  let score = 0;
  if (screen?.spinning) score += 10;         // live spinner on screen
  if (screen?.busy) score += 5;              // Terminal says the tab is busy
  if (row.state === "working") score += 2;   // busy glyph / attached
  else if (row.state === "waiting-tim") score += 1;
  return score;
}
/** Mutates rows in place: per project slug, the strongest live window gets
 * lastActivityMs/stuckOn; ties resolve to the lowest window id (deterministic). */
export function enrichRowsWithTranscripts(
  rows: SessionRow[],
  screens: Map<string, WindowScreen>,
  facts: Map<string, SlugFacts>,
  slugOf: (cwd: string) => string,
): void {
  const candidates = new Map<string, { row: SessionRow; score: number; fact: SlugFacts }[]>();
  for (const row of rows) {
    if (row.machine !== "mac" || row.lastActivityMs !== null) continue;
    const cwd = screens.get(row.id)?.cwd;
    if (!cwd) continue;
    const fact = facts.get(slugOf(cwd));
    if (!fact) continue;
    const list = candidates.get(slugOf(cwd)) ?? [];
    list.push({ row, score: signal(row, screens.get(row.id)), fact });
    candidates.set(slugOf(cwd), list);
  }
  for (const list of candidates.values()) {
    list.sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
    const owner = list[0];
    owner.row.lastActivityMs = owner.fact.lastActivityMs;
    owner.row.stuckOn = owner.row.stuckOn ?? owner.fact.stuckOn;
  }
}
