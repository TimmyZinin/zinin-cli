/** E3 adapter: one worker directory on newa (/home/agents/work/<name>).
 * Pure inputs assembled by the live wrapper (file texts + turn mtimes);
 * never touches the filesystem itself.
 */
import type { SessionRow } from "../../sessions/types";

export interface NewaDirInput {
  name: string;
  metaText: string | null;     // meta.json: {"name","engine","model"}
  statusText: string | null;   // status.json: {"state","live","stop_requested",...}
  toS0Text: string | null;
  reportText: string | null;
  taskText: string | null;     // first lines of TASK*.md
  turnMtimesMs: number[];      // mtimes of turns/* (jsonl + .started)
  nowMs: number;
}
function clean(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v ? v : null;
}
function clip(value: string, max = 120): string | null {
  const v = clean(value);
  if (!v) return null;
  return v.length > max ? v.slice(0, max - 1) + "…" : v;
}
/** Signature lines ("— newa (E3)") are not content — skip them when looking
 * for substantive lines (K3-4). */
const SIGNATURE = /^\s*[—–-]\s+\S.{0,40}\([^)]*\)\s*$/;
interface SubstantiveLine { line: string; heading: boolean }
/** Last n substantive lines (К4-4: search window for the done marker), most
 * recent first; heading flag preserved. */
function lastLines(text: string | null, n = 3): SubstantiveLine[] {
  if (!text) return [];
  const out: SubstantiveLine[] = [];
  for (const raw of text.trimEnd().split("\n").reverse()) {
    const heading = /^#+\s/.test(raw);
    const v = raw.replace(/^#+\s*/, "").trim();
    if (!v || SIGNATURE.test(v)) continue;
    out.push({ line: v, heading });
    if (out.length >= n) break;
  }
  return out;
}
function lastLine(text: string | null): string | null {
  return lastLines(text, 1)[0]?.line ?? null;
}
function readJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
  } catch { return null; }
}
export function parseNewaDir(input: NewaDirInput): SessionRow {
  const meta = readJson(input.metaText);
  const status = readJson(input.statusText);
  const engine = clean(typeof meta?.engine === "string" ? meta.engine : null);
  const model = clean(typeof meta?.model === "string" ? meta.model : null);
  const stateRaw = clean(typeof status?.state === "string" ? status.state : null);
  // P1-10: "closing" only while a stop was requested and the worker is still
  // around. Long-stopped workers (live=false / stopped / failed) are done when
  // a ГОТОВО/ИТОГ marker says so, otherwise plainly idle — age shows in IDLE.
  const alive = status?.live !== false;
  let state: SessionRow["state"];
  if (status?.stop_requested === true && alive) state = "closing";
  else if (!alive) state = "idle"; // stale status file of a gone worker
  else if (stateRaw === "running") state = "working";
  else if (stateRaw === "idle" || stateRaw === "waiting") state = "idle";
  else state = "idle";
  const lastActivityMs = input.turnMtimesMs.length ? Math.max(...input.turnMtimesMs) : null;
  const toLast = lastLine(input.toS0Text);
  const reportLast = lastLine(input.reportText);
  let needs: string | null = null;
  if (toLast && /вопрос|жд[ёе]м\s+Тима|блокер|нужен\s+Тим/i.test(toLast)) needs = clip(toLast);
  const DONE_WORDS = "(ГОТОВО|ГОТОВ|ГОТОГО|ИТОГ|СДАНО|DONE|FINISHED)";
  // Head-anchored for plain lines (after "[HH:MM] "/tag/dash): «пока не готов»
  // and «ещё не готово» must stay working. Headings ("## Ход 21 — … ГОТОВО")
  // get the word anywhere inside — that is the announced-result idiom.
  const DONE_HEAD = new RegExp(`^(?:\\[?\\d{1,2}:\\d{2}\\]?\\s+)?(?:[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\\s+)?[—–-]?\\s*${DONE_WORDS}(?![\\p{L}\\p{N}])`, "iu");
  const DONE_ANYWHERE = new RegExp(`(^|[^\\p{L}\\p{N}])${DONE_WORDS}(?![\\p{L}\\p{N}])`, "iu");
  let done = false;
  for (const text of [input.toS0Text, input.reportText]) {
    for (const { line, heading } of lastLines(text, 3)) {
      if (heading ? DONE_ANYWHERE.test(line) : DONE_HEAD.test(line)) done = true;
    }
  }
  let task = clip(input.taskText?.split("\n").find(l => l.trim()) ?? null);
  let contextPct: number | null = null;
  const haystack = `${toLast ?? ""}\n${reportLast ?? ""}`;
  const ctx = /context:\s*(\d+)%/i.exec(haystack);
  if (ctx) contextPct = Number(ctx[1]);
  return {
    id: input.name,
    machine: "newa",
    engine,
    model,
    task,
    state: done ? "done" : state,
    lastActivityMs,
    stuckOn: null,
    needs,
    contextPct,
    weeklyLimitPct: null,
    source: "newa-workdir",
  };
}
