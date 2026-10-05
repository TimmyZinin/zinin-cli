/** E4 adapter: one worker directory on newa (/home/agents/work/<name>).
 * Pure inputs assembled by the live wrapper (texts + explicit observations);
 * never touches the filesystem itself.
 */
import type { SessionRow, SessionActivity, SessionEvidence, DecisionEvidence } from "../../sessions/types";

export interface NewaDirInput {
  name: string;
  metaText: string | null;     // meta.json: {"name","engine","model"}
  statusText: string | null;   // status.json: {"state","live","stop_requested",...}
  toS0Text: string | null;
  reportText: string | null;
  taskText: string | null;     // first lines of TASK*.md
  readmeText?: string | null;
  taskFile?: string;
  turnMtimesMs?: number[];     // legacy caller input; E4 collectors must not read turns/
  activityMs?: number | null; // observed activity, never collection time
  lastSayMs?: number | null;  // explicit incoming-message boundary; absent means unknown
  nowMs: number;
}
function clean(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v ? v : null;
}
function clip(value: string | null | undefined, max = 120): string | null {
  const v = clean(value);
  if (!v) return null;
  const chars = Array.from(v);
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : v;
}
/** Signature lines ("— newa (E3)") are not content — skip them when looking
 * for substantive lines (K3-4). */
const SIGNATURE = /^\s*[—–-]\s+\S.{0,40}\([^)]*\)\s*$/;
interface SignalLine { line: string; heading: boolean; level: number; atMs: number | null }
const ISO_PREFIX = /^\[?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\]?/;
function validTime(value: number | null | undefined, nowMs: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= nowMs ? value : null;
}
/** Timestamps belong to entries, not file mtimes. Code examples are not signals. */
function signalLines(text: string | null, nowMs: number): SignalLine[] {
  const lines: SignalLine[] = [];
  let headingTime: number | null = null;
  let fence: string | null = null;
  for (const raw of (text ?? "").split("\n")) {
    const trimmed = raw.trim();
    const delimiter = /^(?:`{3,}|~{3,})/.exec(trimmed)?.[0];
    if (delimiter) {
      if (fence === null) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = null;
      continue;
    }
    if (fence || !trimmed || trimmed.startsWith(">")) continue;
    const heading = /^#+\s/.test(trimmed);
    let line = trimmed.replace(/^#+\s*/, "");
    if (SIGNATURE.test(line)) continue;
    const iso = ISO_PREFIX.exec(line);
    const explicitTime = iso ? validTime(Date.parse(iso[1]), nowMs) : null;
    if (heading) headingTime = explicitTime;
    if (iso) line = line.slice(iso[0].length).replace(/^\s*[—–:]?\s*/, "");
    if (line) lines.push({ line, heading, level: /^#+/.exec(trimmed)?.[0].length ?? 0, atMs: iso ? explicitTime : headingTime });
  }
  return lines;
}
const QUESTION = /(?:^|[\s:,.—–-])(?:вопрос|блокер)(?=[\s:,.!?]|$)|WAITING_S0_RECEIPT|(?:жд(?:у|[ёе]м|[ёе]т|ут)|ожида(?:ю|ем|ет|ется|ют)|требуется|нужна).*?(?:квитанци|решени|ответ|Тима|S0|владельц)|нужен\s+(?:Тим|S0|владелец)/i;
const RESOLVED = /(?:блокер\s+снят|вопрос\s+(?:реш[ёе]н|закрыт)|(?:решение|ответ|квитанция)\s+(?:S0\s+)?получен[ао]?)(?=[\s.,;:]|$)/i;
function readJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
export function parseNewaDir(input: NewaDirInput): SessionRow {
  const meta = readJson(input.metaText);
  const status = readJson(input.statusText);
  const engine = clean(typeof meta?.engine === "string" ? meta.engine : null);
  const model = clean(typeof meta?.model === "string" ? meta.model : null);
  const stateRaw = clean(typeof status?.state === "string" ? status.state : null);
  const liveness: SessionRow["liveness"] = status?.live === true ? "alive"
    : status?.live === false ? "stopped" : "unknown";
  let activity: SessionActivity = "unknown";
  if (liveness === "stopped") activity = "idle";
  else if (status?.stop_requested === true) activity = "closing";
  else if (stateRaw === "running") activity = "working";
  else if (stateRaw === "starting") activity = "starting";
  else if (["idle", "waiting", "stopped", "failed"].includes(stateRaw ?? "")) activity = "idle";
  const observed = (input.turnMtimesMs ?? []).map(t => validTime(t, input.nowMs)).filter((t): t is number => t !== null);
  const lastActivityMs = validTime(input.activityMs, input.nowMs) ?? (observed.length ? Math.max(...observed) : null);
  const toLines = signalLines(input.toS0Text, input.nowMs);
  const reportLines = signalLines(input.reportText, input.nowMs);
  const lastSayMs = validTime(input.lastSayMs, input.nowMs);
  let decision: DecisionEvidence | null = null;
  for (const item of toLines) {
    if (RESOLVED.test(item.line)) { decision = null; continue; }
    if (!QUESTION.test(item.line)) continue;
    decision = {
      text: clip(item.line)!, source: "TO-S0.md", atMs: item.atMs,
      freshness: item.atMs === null || lastSayMs === null ? "unknown"
        : item.atMs > lastSayMs ? "current" : "stale",
    };
  }
  const needs = decision?.freshness === "current" ? decision.text : null;
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
  /** A submission heading counts wholly, however many lines sit below it.
   * К6-2: «итог» is a noun there unless announced («ИТОГ: …»). */
  function headingMarker(heading: string): boolean {
    const dash = /[—–]/.exec(heading);
    const marker = markerInSegment(dash ? heading.slice(dash.index + 1) : heading);
    if (!marker) return false;
    if (marker.word === "итог" && !marker.punct.includes(":")) return false;
    return true;
  }
  let lastSubmission: SessionEvidence | null = null;
  for (const [source, lines] of [["TO-S0.md", toLines], ["REPORT-S0.md", reportLines]] as const) {
    let candidate: SessionEvidence | null = null;
    for (const item of lines) {
      if (item.heading ? headingMarker(item.line) : markerInSegment(item.line)) {
        candidate = { text: clip(item.line)!, source, atMs: item.atMs };
      }
    }
    // Prefer REPORT for undated cross-file evidence; never invent chronology.
    if (candidate && (!lastSubmission || candidate.atMs === null || lastSubmission.atMs === null || candidate.atMs >= lastSubmission.atMs)) {
      lastSubmission = candidate;
    }
  }
  // Skip boilerplate instructions; descriptions must identify actual work.
  const useful = (line: string) => !/^(?:[-*_]{3,}|исполнитель(?:\s+newa)?|read AGENTS\.md|communicate only|ты выполняешь только|с Тимом напрямую|вопросы\/блокеры|результаты и доказательства|перед существенным|не передавать в пакет|работай только|не читать auth|не выполнять отправки|никаких Telegram|не включать MCP|не запускать демоны|логи\/история|данные из сети|при недоступности модели|#?\s*REPORT-S0|#?\s*TO-S0)(?=\s|[.,:]|$)/i.test(line);
  const meaningful = (text: string | null | undefined) => signalLines(text ?? null, input.nowMs).find(item => !item.heading && useful(item.line))?.line;
  const withoutDate = (line: string) => line.replace(/^\[?\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:Z| UTC)?)?\]?\s*[—–:|-]?\s*/, "");
  const candidates: [string | undefined, string][] = [
    [meaningful(input.taskText), input.taskFile ?? "TASK*.md"],
    [[...reportLines].reverse().find(item => /^СТАТУС:\s*\S/i.test(item.line))?.line.replace(/^СТАТУС:\s*/i, ""), "REPORT-S0.md:status"],
    [[...reportLines].reverse().filter(item => item.level === 2).map(item => withoutDate(item.line)).find(line => line && useful(line)), "REPORT-S0.md:heading"],
    [[...reportLines].reverse().find(item => !item.heading && useful(item.line))?.line, "REPORT-S0.md:line"],
    [meaningful(input.readmeText), "README.md"],
    [meaningful(input.toS0Text), "TO-S0.md"],
  ];
  const selected = candidates.find(([text]) => text?.trim());
  const task = clip(selected?.[0]?.replace(/^[*_-]+\s*|[*_]+$/g, "").replace(/\s+/g, " ") ?? null);
  const taskSource = task ? selected![1] : null;
  let contextPct: number | null = null;
  const haystack = `${toLines.at(-1)?.line ?? ""}\n${reportLines.at(-1)?.line ?? ""}`;
  const ctx = /context:\s*(\d+)%/i.exec(haystack);
  if (ctx) contextPct = Number(ctx[1]);
  return {
    id: input.name,
    machine: "newa",
    engine,
    model,
    task,
    taskSource,
    state: activity === "unknown" ? "idle" : activity,
    liveness,
    activity,
    decision,
    lastSubmission,
    lastActivityMs,
    stuckOn: null,
    needs,
    contextPct,
    weeklyLimitPct: null,
    source: "newa-workdir",
  };
}
