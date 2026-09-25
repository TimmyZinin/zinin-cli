/** E2 main screen layout. PRD §5 (header orchestrator, permanent session tree,
 * details order A: scope/task -> B: run/step -> C: transcript/tools ->
 * D: Todo -> E: composer -> F: telemetry); R17 (5-7 sessions, same-row updates
 * are the render layer's job). Pure function: projection in, identified rows
 * out. No terminal access here.
 */
export interface SessionRow {
  id: string; service: string; group: string; agent: string; engine: string;
  status: string; process: string;
}
export interface TodoItem { id: string; text: string; status: "pending" | "working" | "done" | "failed" }
export interface ScreenProjection {
  orchestrator: { agent: string; engine: string } | null;
  sessions: SessionRow[];
  selected: string | null;
  scope: string | null;
  run: string | null;
  transcript: string[];
  todo: TodoItem[];
  draft: string;
  queued: number;
  context: string | null;
  quota: string | null;
  cost: string | null;
  width: number;
  height: number;
}
export interface Row { id: string; text: string }
export const maxTreeSessions = 7;
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
function crop(s: string, width: number): string {
  return s.length <= width ? s : s.slice(0, Math.max(0, width - 1)) + "…";
}
export function layout(p: ScreenProjection): Row[] {
  const compact = p.width < 80;
  const w = Math.max(20, p.width);
  const rows: Row[] = [];
  const orch = p.orchestrator ? `Orchestrator: ${p.orchestrator.agent} · ${p.orchestrator.engine}` : "Orchestrator: none";
  rows.push({ id: "header", text: crop(compact ? `ZININ ${orch}` : `ZININ CODE  ${orch}`, w) });
  rows.push({ id: "blank-0", text: "" });
  const shown = p.sessions.slice(0, maxTreeSessions);
  shown.forEach((s, i) => {
    const marker = s.id === p.selected ? "▶" : " ";
    const body = compact
      ? `${marker}${s.id} ${s.agent} ${s.status} ${s.process}`
      : `${marker} ${s.id} ${s.service}/${s.group} ${s.agent} ${s.engine} ${s.status} ${s.process}`;
    rows.push({ id: `tree-${s.id}`, text: crop(pad(body, compact ? 0 : 40), w) });
    void i;
  });
  for (let i = shown.length; i < maxTreeSessions; i++) rows.push({ id: `tree-slot-${i}`, text: "" });
  rows.push({ id: "blank-1", text: "" });
  const fixed: Row[] = [
    { id: "A", text: crop(`A scope/task ${p.scope ?? "—"}`, w) },
    { id: "B", text: crop(`B run/step ${p.run ?? "—"}`, w) },
  ];
  const todoRows: Row[] = p.todo.slice(0, 24).map(t => ({ id: `D-${t.id}`, text: crop(`D [${t.status}] ${t.text}`, w) }));
  const footer: Row[] = [
    { id: "E", text: crop(`E › ${p.draft}${p.queued ? `  (queued ${p.queued})` : ""}`, w) },
    { id: "F", text: crop(`F context=${p.context ?? "unknown"} quota=${p.quota ?? "unknown"} cost=${p.cost ?? "unknown"}`, w) },
  ];
  const budget = Math.max(0, p.height - rows.length - fixed.length - todoRows.length - footer.length);
  const transcriptRows: Row[] = p.transcript.slice(0, budget).map((line, i) => ({ id: `C-${i}`, text: crop(`C ${line}`, w) }));
  rows.push(...fixed, ...transcriptRows, ...todoRows, ...footer);
  while (rows.length < p.height) rows.push({ id: `pad-${rows.length}`, text: "" });
  return rows.slice(0, Math.max(p.height, footer.length));
}
