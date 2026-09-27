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
  const DONE_WORDS = new Set(["готово", "готов", "готова", "готовы", "итог", "сдано", "сдача", "done", "finished"]);
  interface Token { word: string; punct: string }
  function tokenize(segment: string): Token[] {
    const stripped = segment
      .trim()
      .replace(/^[`'*]+/, "")
      .replace(/^\[?\d{1,2}:\d{2}\]?\s*/, "");
    return stripped.split(/\s+/)
      .map(raw => {
        const word = raw.replace(/^[`'"(*]+/, "").replace(/[.,:;!?()\[\]'"`*]+$/, "").toLowerCase();
        const punct = (raw.match(/[.,:;!?]+$/)?.[0] ?? "");
        return { word, punct };
      })
      .filter(token => token.word);
  }
  const NEGATION = (tokens: Token[], i: number): boolean =>
    tokens[i - 1]?.word === "не" ||
    (i > 1 && (tokens[i - 2]?.word === "ещё" || tokens[i - 2]?.word === "пока") && tokens[i - 1]?.word === "не");
  /** К5-2/К5-3/К6-2: find the first marker word after stripping submission-line
   * decorations («`…`», "[HH:MM]", tags of any alphabet). Null when absent,
   * negated («не»/«ещё не»/«пока не» before or right after), or questioned
   * («ГОТОВО?»). Callers get the word and its punctuation for noun rules. */
  function markerInSegment(segment: string): { word: string; punct: string } | null {
    const tokens = tokenize(segment);
    if (tokens[0]?.word === "что") return null;
    for (let i = 0; i < Math.min(tokens.length, 5); i++) {
      if (!DONE_WORDS.has(tokens[i].word)) continue;
      if (tokens[i].punct.includes("?")) continue;
      if (NEGATION(tokens, i)) return null;
      const after = tokens.slice(i + 1, i + 4).map(t => t.word);
      if (after[0] === "не" || ((after[0] === "пока" || after[0] === "ещё") && after[1] === "не")) return null;
      return tokens[i];
    }
    return null;
  }
  /** К5-2: the last heading counts wholly, however many lines sit below it.
   * К6-2: «итог» is a noun there unless announced («ИТОГ: …»). */
  function headingMarker(heading: string): boolean {
    const dash = /[—–]/.exec(heading);
    const marker = markerInSegment(dash ? heading.slice(dash.index + 1) : heading);
    if (!marker) return false;
    if (marker.word === "итог" && !marker.punct.includes(":")) return false;
    return true;
  }
  function lastHeading(text: string | null): string | null {
    if (!text) return null;
    for (const raw of text.trimEnd().split("\n").reverse()) {
      const v = raw.trim();
      if (!v || SIGNATURE.test(v.replace(/^#+\s*/, ""))) continue;
      if (/^#+\s/.test(v)) return v.replace(/^#+\s*/, "").trim();
    }
    return null;
  }
    let done = false;
  for (const text of [input.toS0Text, input.reportText]) {
    const heading = lastHeading(text);
    if (heading && headingMarker(heading)) done = true;
    for (const { line, heading: isHeading } of lastLines(text, 3)) {
      if (!isHeading && markerInSegment(line)) done = true;
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
