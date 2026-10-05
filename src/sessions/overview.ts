import { sessionName } from "./name";
import { meaningfulDescription } from "./description";
import type { SessionRow, MachineInfo } from "./types";

/** Plain output never executes escape/control sequences from a source. */
function short(value: string | null | undefined, max = 72): string {
  const plain = (value ?? "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
  if (Bun.stringWidth(plain) <= max) return plain;
  let clipped = "";
  for (const char of plain) {
    if (Bun.stringWidth(clipped + char) > max - 1) break;
    clipped += char;
  }
  return clipped + "…";
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
export function renderOverview(rows: SessionRow[], machines: MachineInfo[], nowMs: number, hiddenCount = 0, terminalWidth = process.stdout.columns || 100): string {
  const titles = ["Работают сейчас", "Ждут решения владельца", "Сданы", "Простаивают"];
  const blocks: string[][] = titles.map(() => []);
  const width = Number.isFinite(terminalWidth) ? Math.max(40, Math.floor(terminalWidth)) : 100;
  const machineWidth = Math.max(4, ...rows.map(row => Bun.stringWidth(machineName(row.machine))));
  const idWidth = Math.max(1, Math.min(Math.floor(width * 0.32), 36, Math.max(1, ...rows.map(row => Bun.stringWidth(short(sessionName(row), 64))))));
  const timeWidth = Math.max(5, ...rows.map(row => Bun.stringWidth(humanIdle(row.lastActivityMs, nowMs))));
  const descriptionWidth = Math.max(1, width - machineWidth - idWidth - timeWidth - 6);
  const pad = (value: string, columns: number) => value + " ".repeat(Math.max(0, columns - Bun.stringWidth(value)));

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
    const detail = `${short(description, 120) || (row.machine === "newa" ? `${short(row.id)} (по имени папки)` : "задача не указана")}${notes.length ? " · " + notes.join(" · ") : ""}`;
    return [pad(machineName(row.machine), machineWidth), pad(short(sessionName(row), idWidth), idWidth),
      pad(short(detail, descriptionWidth), descriptionWidth), pad(idle, timeWidth)].join("  ").trimEnd();
  };
  for (const row of [...rows].sort((a, b) => (group(a) === 1 && group(b) === 1 ? Number(a.waitingKind === "handoff") - Number(b.waitingKind === "handoff") : 0) || (b.lastActivityMs ?? -1) - (a.lastActivityMs ?? -1) || a.id.localeCompare(b.id))) {
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
  const counts = (machine: string) => {
    const selected = rows.filter(row => row.machine === machine);
    return [0, 1, 2, 3].map(index => selected.filter(row => group(row) === index).length);
  };
  const summary = (machine: string) => {
    const [working, waiting, submitted, idle] = counts(machine);
    return `${machineName(machine)}: ${working} работают, ${waiting} ждут решения, ${submitted} сданы, ${idle} простаивают`;
  };
  out.push(`${summary("mac")} · ${summary("newa")}`);
  return out.join("\n").trimEnd();
}
