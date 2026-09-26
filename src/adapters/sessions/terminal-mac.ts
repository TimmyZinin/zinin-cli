/** E3 adapter: macOS Terminal windows (titles + last status line of the tab).
 * Pure text-in → rows-out; the live wrapper on the Mac produces the TSV
 * (one window per line: index, title, statusline, tty) via osascript + ps.
 * Title grammar (observed 26.09):
 *   <user> — <glyph> <task> — <process chain> — <cols>×<rows>
 */
import type { SessionRow, PsState } from "../../sessions/types";

const GLYPH_BUSY = /^[◑◐✳●▶▷▸▹►]/;
const GLYPH_IDLE = /^[○◌◎⊙]/;

function clean(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v ? v : null;
}
function clip(value: string, max = 120): string {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}
/** task title without user prefix, dims suffix, busy glyph, process tail. */
export function parseWindowTitle(raw: string): { task: string | null; glyphState: PsState | null; idleTitle: boolean } {
  let line = raw.trim();
  line = line.replace(/\s+—\s+\d+\s*×\s*\d+\s*$/, "");
  const firstBreak = line.indexOf(" — ");
  if (firstBreak >= 0) line = line.slice(firstBreak + 3);
  let glyphState: PsState | null = null;
  if (GLYPH_BUSY.test(line)) glyphState = "working";
  else if (GLYPH_IDLE.test(line)) glyphState = "idle";
  line = line.replace(/^[◑◐✳●▶▷▸▹►○◌◎⊙✦✧☀-➿⏳⌛]\s*/, "");
  const segments = line.split(" — ");
  const task = clean(segments[0]);
  const idleTitle = !!task && /\|\s*idle\s*$/.test(task);
  return { task, glyphState, idleTitle };
}
export function parseStatusLine(statusline: string): {
  model: string | null; contextPct: number | null; weeklyLimitPct: number | null;
  stuckOn: string | null; waiting: boolean;
} {
  const line = statusline.trim();
  if (!line) return { model: null, contextPct: null, weeklyLimitPct: null, stuckOn: null, waiting: false };
  let model: string | null = null;
  let contextPct: number | null = null;
  let weeklyLimitPct: number | null = null;
  let stuckOn: string | null = null;
  let waiting = false;
  const kimiCtx = /context:\s*(\d+)%\s*\(([^)]*)\)/i.exec(line);
  if (kimiCtx) {
    contextPct = Number(kimiCtx[1]);
    const kimiModel = /\b(K\d+(?:\.\d+)?)\b/.exec(line);
    if (kimiModel) model = kimiModel[1];
  }
  const claudeCtx = /\b(opus|sonnet|haiku|o[0-9]+)\s+([0-9][0-9.]*)\s+(\d+)%/i.exec(line);
  if (claudeCtx) {
    model = `${claudeCtx[1]} ${claudeCtx[2]}`;
    contextPct = Number(claudeCtx[3]);
  }
  const weekly = /You've used\s+(\d+)%\s+of your weekly limit/i.exec(line);
  if (weekly) weeklyLimitPct = Number(weekly[1]);
  if (/What should .*do instead/i.test(line) || /жд[ёе]т ввода|awaiting input/i.test(line)) waiting = true;
  const stuck = /Interrupted|ERROR|\b403\b|timed out|rate[_ -]?limit|limit reached|context low/i.exec(line);
  if (stuck && !weekly) stuckOn = clip(line);
  return { model, contextPct, weeklyLimitPct, stuckOn, waiting };
}
export function detectEngine(text: string): string | null {
  if (/kimi/i.test(text)) return "kimi";
  if (/claude/i.test(text)) return "claude";
  if (/codex/i.test(text)) return "codex";
  return null;
}
/** TSV: index\ttitle\tstatusline\ttty (title never contains a tab). */
export function parseTerminalWindows(text: string): SessionRow[] {
  const rows: SessionRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [index, title = "", statusline = ""] = line.split("\t");
    const { task, glyphState, idleTitle } = parseWindowTitle(title);
    const status = parseStatusLine(statusline);
    const engine = detectEngine(`${title} ${statusline}`);
    let state: PsState = glyphState ?? (idleTitle || !engine ? "idle" : "working");
    if (status.waiting) state = "waiting-tim";
    rows.push({
      id: `mac-win-${(index ?? rows.length + 1).toString().trim()}`,
      machine: "mac",
      engine,
      model: status.model,
      task,
      state,
      lastActivityMs: null,
      stuckOn: status.stuckOn,
      needs: null,
      contextPct: status.contextPct,
      weeklyLimitPct: status.weeklyLimitPct,
      source: "terminal-mac",
    });
  }
  return rows;
}
