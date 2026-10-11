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
  tty?: string | null;
  /** К4-2: transcript-project key resolved from the engine process launch
   * directory (tty → pid → lsof cwd). When set, it wins over `cwd`. */
  key?: string | null;
}
/** К4-2: transcript-project key for a window. The engine process launch
 * directory (tty → pid → lsof cwd) is primary — Claude Code files transcripts
 * under the directory the process was started in, so a window that `cd`s
 * afterwards still maps home; the status-line cwd is the fallback. */
export function windowProjectKey(
  screen: { cwd: string | null; tty?: string | null },
  launchDirs: Map<string, string>,
  slugOf: (cwd: string) => string,
): string | null {
  if (screen.tty) {
    const launch = launchDirs.get(screen.tty);
    if (launch) return slugOf(launch.replace(/^\//, ""));
  }
  return screen.cwd ? slugOf(screen.cwd) : null;
}
/** К4-3: numeric window-id order for ties — the smaller id is the older
 * window and takes the facts. localeCompare would rank "mac-win-1054"
 * below "mac-win-63" and "10" below "9". */
export function windowIdCompare(a: string, b: string): number {
  const na = /(\d+)$/.exec(a)?.[1];
  const nb = /(\d+)$/.exec(b)?.[1];
  if (na !== undefined && nb !== undefined && na !== nb) return Number(na) - Number(nb);
  if (na !== undefined) return -1;
  if (nb !== undefined) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
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
    const screen = screens.get(row.id);
    if (!screen) continue;
    const key = screen.key ?? (screen.cwd ? slugOf(screen.cwd) : null);
    if (!key) continue;
    const fact = facts.get(key);
    if (!fact) continue;
    const list = candidates.get(key) ?? [];
    list.push({ row, score: signal(row, screen), fact });
    candidates.set(key, list);
  }
  for (const list of candidates.values()) {
    list.sort((a, b) => b.score - a.score || windowIdCompare(a.row.id, b.row.id));
    const owner = list[0];
    owner.row.lastActivityMs = owner.fact.lastActivityMs;
    owner.row.stuckOn = owner.row.stuckOn ?? owner.fact.stuckOn;
  }
}
