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
function lastLine(text: string | null): string | null {
  if (!text) return null;
  for (const line of text.trimEnd().split("\n").reverse()) {
    const v = line.replace(/^#+\s*/, "").trim();
    if (v) return v;
  }
  return null;
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
  let state: SessionRow["state"];
  if (status?.live === false || status?.stop_requested === true) state = "closing";
  else if (stateRaw === "running") state = "working";
  else if (stateRaw === "idle" || stateRaw === "waiting") state = "idle";
  else if (stateRaw === "stopped" || stateRaw === "failed") state = "closing";
  else state = "idle";
  const lastActivityMs = input.turnMtimesMs.length ? Math.max(...input.turnMtimesMs) : null;
  const toLast = lastLine(input.toS0Text);
  const reportLast = lastLine(input.reportText);
  let needs: string | null = null;
  if (toLast && /вопрос|жд[ёе]м\s+Тима|блокер|нужен\s+Тим/i.test(toLast)) needs = clip(toLast);
  let done = false;
  for (const line of [toLast, reportLast]) {
    if (line && /ГОТОВ|ИТОГ/i.test(line)) done = true;
  }
  let task = clip(input.taskText?.split("\n").find(l => l.trim()) ?? null);
  if (!task && input.toS0Text) {
    const heading = /^#+\s+(.+)$/m.exec(input.toS0Text);
    task = clip(heading?.[1] ?? null);
  }
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
