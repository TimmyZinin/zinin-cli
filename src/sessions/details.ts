import type { SessionDetails, SessionRow, MachineInfo } from "./types";
import { sessionName } from "./name";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && Buffer.byteLength(v) <= 128 * 1024;
const nullableText = (v: unknown) => v === null || text(v);
const timestamp = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
/** Only newa details are accepted from SSH. Unknown nested fields are dropped. */
export function parseRemoteDetails(v: unknown): SessionDetails {
  if (!object(v) || !object(v.task) || !nullableText(v.task.text) || !nullableText(v.task.source) ||
      !nullableText(v.status) || !nullableText(v.reason) || v.terminal !== null ||
      !Array.isArray(v.reportLines) || v.reportLines.length > 15 || !v.reportLines.every(text)) throw new Error("invalid remote details");
  const evidence = (value: unknown, decision: boolean) => {
    if (value === null) return null;
    if (!object(value) || !text(value.text) || !["TO-S0.md", "REPORT-S0.md"].includes(value.source as string) || !timestamp(value.atMs) ||
        (decision && !["current", "stale", "unknown"].includes(value.freshness as string))) throw new Error("invalid detail evidence");
    return {text:value.text, source:value.source, atMs:value.atMs, ...(decision ? {freshness:value.freshness} : {})};
  };
  return {task:{text:v.task.text,source:v.task.source}, question:evidence(v.question,true), submission:evidence(v.submission,false),
    reportLines:[...v.reportLines],status:v.status,reason:v.reason,terminal:null} as SessionDetails;
}
export function matchSessions(rows: SessionRow[], query: string): SessionRow[] {
  const aliases = (row: SessionRow) => [row.id, sessionName(row), `${row.machine}:${row.id}`, `${row.machine}:${sessionName(row)}`];
  const exact = rows.filter(row => aliases(row).includes(query));
  return exact.length ? exact : rows.filter(row => aliases(row).some(name => name.toLowerCase().includes(query.toLowerCase())));
}
export interface ShowResult {
  query: string; status: "found" | "ambiguous" | "not-found" | "unavailable";
  sessions: SessionRow[]; machines: MachineInfo[]; generatedAt: string;
}
const plain = (value: string | null | undefined) => (value ?? "неизвестно")
  .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
  .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, " ");
export function renderSessionDetails(result: ShowResult): string {
  const diagnostics=result.machines.filter(m=>m.available===false).map(m=>`Недоступно: ${plain(m.machine)}`);
  for(const m of result.machines) for(const warning of m.warnings??[]) diagnostics.push(`${plain(m.machine)}: ${plain(warning)}`);
  if(result.status!=="found") return [result.status==="ambiguous" ? "Несколько совпадений; укажите точный machine:id:" : result.status==="unavailable" ? "Подробности недоступны; источник не ответил или сессия исчезла." : "Сессия не найдена.",
    ...result.sessions.map(row=>`${row.machine}:${plain(row.id)}  ${plain(sessionName(row))}  ${plain(row.task)}`),...diagnostics].join("\n");
  const row=result.sessions[0], d=row.details;
  const out=[`${row.machine}:${plain(row.id)} — ${plain(sessionName(row))}`,
    `Состояние: ${plain(d?.status ?? row.activity ?? row.state)}; процесс: ${plain(row.liveness)}`,
    `Движок: ${plain(row.engine)}; модель: ${plain(row.model)}`,
    `Причина остановки: ${plain(d?.reason ?? row.stoppedReason?.value)}`,
    `Задача [${plain(d?.task.source ?? row.taskSource)}]:\n${plain(d?.task.text ?? row.task)}`];
  const question=d?.question ?? row.decision;
  out.push(`Вопрос [${plain(question?.source)}]:\n${plain(question?.text ?? row.needs)}`);
  const submission=d?.submission ?? row.lastSubmission;
  out.push(`Последняя сдача [${plain(submission?.source)}; ${submission?.atMs == null ? "время неизвестно" : new Date(submission.atMs).toISOString()}]:\n${plain(submission?.text)}`);
  if(d?.terminal) out.push(`Заголовок: ${plain(d.terminal.title)}`,`TTY: ${plain(d.terminal.tty)}`,`Каталог: ${plain(d.terminal.cwd)}`,
    "Последние 15 строк экрана:",...d.terminal.screenLines.map(plain));
  else out.push("Последние 15 содержательных строк REPORT-S0.md:",...(d?.reportLines.length ? d.reportLines.map(plain) : ["нет"]));
  return [...out,...diagnostics].join("\n");
}
