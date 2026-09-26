/** E3 adapter: macOS Terminal windows. Live format (S0-verified on Mac,
 * e3-live-findings P0-1/P0-2): records separated by ASCII 30, fields by tab —
 * id, title, whole visible screen of the selected tab. The screen is many
 * lines, so the status line is found by shape, not by "last line".
 */
import type { SessionRow, PsState } from "../../sessions/types";

const GLYPH_BUSY = /^[◑◐◒◓●▶▷▸▹►]/;
/** ✳ in the title marks an idle Claude window (observed on Mac 26.09). */
const GLYPH_IDLE = /^[○◌◎⊙✳]/;
/** Live spinner line, e.g. "✻ Whisking… (11m 26s · ↓ 67.1k tokens …)". */
const SPINNER = /^\s*[✻✽✳✶✢·*]\s+\S+…\s+\(\d+[ms]/m;
export const RECORD_SEP = "\x1e";

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
  line = line.replace(/^[◑◐◒◓●▶▷▸▹►○◌◎⊙✳✦✧⏳⌛]\s*/, "");
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
  // Wide-window status: "| fable 5.1 37% ▓▓▓░░░░░░░ 369k/1M | 5h:53% (15m) | 7d:14%".
  // Model names are open-ended (fable, sonnet 5, opus…), the bar glyph anchors the regex.
  const claudeCtx = /\b([a-z][a-z-]*)\s+([0-9][0-9.]*)\s+(\d+)%\s+[▓░]/i.exec(line);
  if (claudeCtx) {
    model = `${claudeCtx[1]} ${claudeCtx[2]}`;
    contextPct = Number(claudeCtx[3]);
  }
  const sevenDay = /\b7d:\s*(\d+)%/.exec(line);
  if (sevenDay) weeklyLimitPct = Number(sevenDay[1]);
  const weekly = /You've used\s+(\d+)%\s+of your weekly limit/i.exec(line);
  if (weekly) weeklyLimitPct = Number(weekly[1]);
  if (/What should .*do instead/i.test(line) || /жд[ёе]т ввода|awaiting input/i.test(line)) waiting = true;
  const stuck = /Interrupted|ERROR|\b403\b|timed out|rate[_ -]?limit|limit reached|context low/i.exec(line);
  if (stuck && !sevenDay && !weekly) stuckOn = clip(line);
  return { model, contextPct, weeklyLimitPct, stuckOn, waiting };
}
/** Screen tail (last non-empty lines) + shape-picked status line + spinner fact. */
export function pickStatusLine(screen: string): { statusline: string; spinning: boolean; tail: string[] } {
  const tail = screen.replace(/\r/g, "").split("\n").map(l => l.replace(/\s+$/, "")).filter(Boolean).slice(-14);
  const claude = tail.find(l => /\bgit:\S+/.test(l) && /\d+%/.test(l)) ?? "";
  const kimi = tail.find(l => /context:\s*\d+%/i.test(l)) ?? "";
  return { statusline: claude || kimi, spinning: SPINNER.test(tail.join("\n")), tail };
}
export function detectEngine(text: string): string | null {
  if (/kimi/i.test(text)) return "kimi";
  if (/claude/i.test(text)) return "claude";
  if (/codex/i.test(text)) return "codex";
  return null;
}
/** Engine from the process-chain segment only ("caffeinate ◂ claude --flags <prompt…>"):
 * the prompt text after the flags may name any engine (P1-8). */
export function detectEngineFromTitle(title: string): string | null {
  const segments = title.replace(/\s+—\s+\d+\s*×\s*\d+\s*$/, "").split(" — ");
  const chain = (segments[2] ?? "").split(/\s--/)[0];
  return detectEngine(chain);
}
/** Live output: records separated by RECORD_SEP, fields "id\ttitle\tscreen".
 * onScreen reports the picked status line per row id (transcript enrichment). */
export function parseTerminalWindows(
  text: string,
  onScreen?: (id: string, statusline: string, cwd: string | null) => void,
): SessionRow[] {
  const rows: SessionRow[] = [];
  for (const record of text.split(RECORD_SEP)) {
    const fields = record.replace(/^\n+/, "").split("\t");
    const index = (fields[0] ?? "").trim();
    const title = (fields[1] ?? "").trim();
    if (!title) continue; // window without tabs (closed) — skip the phantom
    const screen = fields.slice(2).join("\t");
    const picked = pickStatusLine(screen);
    const { task, glyphState, idleTitle } = parseWindowTitle(title);
    const status = parseStatusLine(picked.statusline);
    const tail = picked.tail.join("\n");
    const engine = detectEngineFromTitle(title);
    let state: PsState = glyphState ?? (idleTitle || !engine ? "idle" : "working");
    if (picked.spinning) state = "working";
    if (status.waiting || /What should .*do instead/i.test(tail)) state = "waiting-tim";
    const interrupted = picked.tail.filter(l => /Interrupted/.test(l)).join(" ");
    const cwd = /(?:^|\s)(Users\/\S+?)\s*[|▸]/.exec(picked.statusline)?.[1] ?? null;
    const id = `mac-win-${index || rows.length + 1}`;
    onScreen?.(id, picked.statusline, cwd);
    rows.push({
      id,
      machine: "mac",
      engine,
      model: status.model,
      task,
      state,
      lastActivityMs: null,
      stuckOn: status.stuckOn ?? (interrupted ? clip(interrupted) : null),
      needs: null,
      contextPct: status.contextPct,
      weeklyLimitPct: status.weeklyLimitPct,
      source: "terminal-mac",
    });
  }
  return rows;
}
