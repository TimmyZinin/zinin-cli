import { meaningfulDescription } from "./description";
import type { SessionRow, MachineInfo } from "./types";

/** Plain output never executes escape/control sequences from a source. */
function short(value: string | null | undefined, max = 72): string {
  const plain = (value ?? "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(plain);
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : plain;
}
const machineName = (value: string) => value === "mac" ? "Мак" : value === "newa" ? "newa" : "неизвестно";
function group(row: SessionRow): number {
  // Explicit running activity wins over any stale submission/group label.
  if (row.activity === "working" || row.overviewGroup?.value === "working") return 0;
  if (row.overviewGroup?.value === "waiting" || row.state === "waiting-tim") return 1;
  if (row.activity === "working" || row.overviewGroup?.value === "working" ||
      (!row.activity && ["working", "starting", "closing", "stuck"].includes(row.state))) return 0;
  if (row.lastSubmission || row.overviewGroup?.value === "submitted" || row.state === "done") return 2;
  return 3;
}
export function humanIdle(lastActivityMs: number | null, nowMs: number): string {
  if (lastActivityMs === null) return "неизвестно";
  const minutes = Math.max(0, Math.floor((nowMs - lastActivityMs) / 60_000));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)} дн`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)} ч`;
  return `${minutes} мин`;
}
export function renderOverview(rows: SessionRow[], machines: MachineInfo[], nowMs: number, hiddenCount = 0): string {
  const titles = ["Работают сейчас", "Ждут решения владельца", "Сданы", "Простаивают"];
  const blocks: string[][] = titles.map(() => []);
  const line = (row: SessionRow, target: number) => {
    const question = row.decision?.text ?? row.needs;
    const description = target === 1 ? question ?? row.task
      : target === 2 ? meaningfulDescription(row.lastSubmission?.text ?? "") ?? row.task : row.task;
    const idle = humanIdle(row.lastActivityMs, nowMs);
    const notes: string[] = [];
    if (row.lastSubmission && target !== 2) notes.push(`сдано раньше: ${short(row.lastSubmission.text)}`);
    if (target === 0 && row.possiblyStuck?.value) notes.push("возможно зависла");
    if (target === 3 && (row.overviewGroup?.value === "idle" || (!row.overviewGroup && row.state === "idle"))) notes.push("простаивает");
    if (target === 3 && row.overviewGroup?.value === "stopped" && row.stoppedReason?.value) notes.push(`ход остановлен: ${short(row.stoppedReason.value)}`);
    if (question && target !== 1) notes.push(`вопрос: ${short(question)}`);
    if (question && row.decision?.freshness === "stale") notes.push("вопрос из прошлого хода");
    return `${machineName(row.machine)}  ${short(row.id, 64)}  ${short(description) || "задача не указана"}  — без движения ${idle}${notes.length ? " · " + notes.join(" · ") : ""}`;
  };
  for (const row of [...rows].sort((a, b) => (b.lastActivityMs ?? -1) - (a.lastActivityMs ?? -1) || a.id.localeCompare(b.id))) {
    const target = group(row);
    blocks[target].push(line(row, target));

  }
  const out = [1, 0, 2, 3].flatMap(i => [titles[i], ...(blocks[i].length ? blocks[i] : ["нет"]), ""]);
  for (const machine of machines) {
    if (machine.available === false) out.push(`Недоступно: ${machineName(machine.machine)}`);
    for (const warning of machine.warnings ?? []) out.push(`${machineName(machine.machine)}: ${short(warning, 160)}`);
  }
  if (rows.some(row => row.overviewGroup)) out.push("* Оценка по времени файла: состояния newa; подробности в --json.");
  if (rows.some(row => row.decision?.freshness === "unknown")) out.push("* Точная свежесть вопроса неизвестна; текст вопроса сохранён, подробности в --json.");
  if (hiddenCount) out.push(`ещё ${hiddenCount} старых скрыто — zinin ps --all`);
  const macLive = rows.filter(row => row.machine === "mac" && (row.liveness === "alive" || row.source === "terminal-mac")).length;
  const newa = rows.filter(row => row.machine === "newa");
  const working = newa.filter(row => group(row) === 0).length;
  const waiting = newa.filter(row => group(row) === 1).length;
  // Undated and stale evidence cannot substantiate "submitted within a day".
  const submitted = newa.filter(row => group(row) === 2 && row.lastSubmission?.atMs != null && row.lastSubmission.atMs >= nowMs - 86_400_000 && row.lastSubmission.atMs <= nowMs).length;
  out.push(`Мак: ${macLive} живых · newa: ${working} работают, ${waiting} ждут решения, ${submitted} сдано за сутки`);
  return out.join("\n").trimEnd();
}
