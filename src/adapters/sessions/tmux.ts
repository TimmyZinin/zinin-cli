/** E3 adapter: `tmux ls` on newa (worker sessions live as af-<name>).
 * Pure text-in; the live wrapper runs tmux -S /run/apparat-agents/tmux.sock ls.
 */
import type { SessionRow } from "../../sessions/types";

const STARTING_WINDOW_MS = 120_000;
/** "Sat Sep 26 05:53:53 2026" as produced by tmux ls (host local time). */
function parseCreatedMs(created: string | undefined, nowMs: number): number | null {
  if (!created) return null;
  const parsed = Date.parse(created.trim());
  // tmux prints host-local time without a zone; Date.parse treats it as local.
  return Number.isFinite(parsed) ? parsed : null;
}
export function parseTmuxSessions(text: string, nowMs: number): SessionRow[] {
  const rows: SessionRow[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || !line.includes(":")) continue;
    const match = /^([^:]+):\s+\d+\s+windows?.*?\(created\s+([^)]+)\)/.exec(line);
    if (!match) continue;
    const sessionName = match[1].trim();
    const id = sessionName.startsWith("af-") ? sessionName.slice(3) : sessionName;
    const createdMs = parseCreatedMs(match[2], nowMs);
    const starting = createdMs !== null && nowMs - createdMs >= 0 && nowMs - createdMs < STARTING_WINDOW_MS;
    rows.push({
      id,
      machine: "newa",
      engine: null,
      model: null,
      task: null,
      state: starting ? "starting" : line.includes("(attached)") ? "working" : "idle",
      lastActivityMs: nowMs,
      stuckOn: null,
      needs: null,
      contextPct: null,
      weeklyLimitPct: null,
      source: "tmux",
    });
  }
  return rows;
}
