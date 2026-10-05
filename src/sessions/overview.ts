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
  switch (row.overviewGroup?.value) {
    case "working": return 0;
    case "waiting": return 1;
    case "submitted": return 2;
    case "idle": case "stopped": case "unknown": return 3;
  }
  if (row.state === "waiting-tim") return 1;
  if (row.state === "done") return 2;
  if (["working", "starting", "closing", "stuck"].includes(row.state)) return 0;
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
  const titles = ["Работают сейчас", "Ждут решения владельца", "Сданы", "Не отвечают/неизвестно"];
  const blocks: string[][] = titles.map(() => []);
  const line = (row: SessionRow, target: number) => {
    const question = row.decision?.text ?? row.needs;
    const description = target === 1 ? question ?? row.task
      : target === 2 ? row.lastSubmission?.text ?? row.task : row.task;
    const idle = humanIdle(row.lastActivityMs, nowMs);
    const notes: string[] = [];
    if (row.overviewGroup && target !== 2) notes.push("оценка по времени файла");
    if (target === 0 && row.possiblyStuck?.value) notes.push("возможно зависла");
    if (target === 3 && (row.overviewGroup?.value === "idle" || (!row.overviewGroup && row.state === "idle"))) notes.push("простаивает");
    if (target === 3 && row.overviewGroup?.value === "stopped") notes.push(`ход остановлен: ${short(row.stoppedReason?.value) || "причина не указана"}`);
    if (question && target !== 1) notes.push(`вопрос: ${short(question)}`);
    if (question && row.decision?.freshness === "stale") notes.push("вопрос из прошлого хода");
    if (question && row.decision?.freshness === "unknown") notes.push("точная свежесть вопроса неизвестна");
    return `${machineName(row.machine)}  ${short(row.id, 64)}  ${short(description) || "задача не указана"}  — без движения ${idle}${notes.length ? " · " + notes.join(" · ") : ""}`;
  };
  for (const row of [...rows].sort((a, b) => (b.lastActivityMs ?? -1) - (a.lastActivityMs ?? -1) || a.id.localeCompare(b.id))) {
    const target = group(row);
    blocks[target].push(line(row, target));
    // A previous submission survives while the same session works or waits.
    if (row.lastSubmission && target !== 2) blocks[2].push(line(row, 2));
  }
  const out = [1, 0, 2, 3].flatMap(i => [titles[i], ...(blocks[i].length ? blocks[i] : ["нет"]), ""]);
  for (const machine of machines) {
    if (machine.available === false) out.push(`${machineName(machine.machine)}: источник недоступен`);
    for (const warning of machine.warnings ?? []) out.push(`${machineName(machine.machine)}: ${short(warning, 160)}`);
  }
  if (hiddenCount) out.push(`ещё ${hiddenCount} старых скрыто — zinin ps --all`);
  const macLive = rows.filter(row => row.machine === "mac" && (row.liveness === "alive" || row.source === "terminal-mac")).length;
  const newa = rows.filter(row => row.machine === "newa");
  const working = newa.filter(row => group(row) === 0).length;
  const waiting = newa.filter(row => group(row) === 1).length;
  // Undated and stale evidence cannot substantiate "submitted within a day".
  const submitted = newa.filter(row => row.lastSubmission?.atMs != null && row.lastSubmission.atMs >= nowMs - 86_400_000 && row.lastSubmission.atMs <= nowMs).length;
  out.push(`Мак: ${macLive} живых · newa: ${working} работают, ${waiting} ждут решения, ${submitted} сдано за сутки`);
  return out.join("\n").trimEnd();
}
