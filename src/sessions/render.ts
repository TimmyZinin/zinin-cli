/** E3 rendering: plain aligned table (no required colors) and --json output. */
import type { SessionRow, MachineInfo } from "./types";

/** N-9: emoji (⚡ etc.) occupy two terminal cells; pad by display width. */
function displayWidth(s: string): number {
  let width = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    width += cp >= 0x1F000 || (cp >= 0x2600 && cp <= 0x27BF) || cp === 0x2B50 ? 2 : 1;
  }
  return width;
}
function pad(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - displayWidth(value)));
}
const HEADERS = ["ID", "MACHINE", "ENGINE", "MODEL", "TASK", "STATE", "IDLE", "STUCK-ON", "NEEDS", "CTX%", "WEEK%"] as const;
function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}
function cell(row: SessionRow, nowMs: number): string[] {
  const idle = row.lastActivityMs === null ? "—"
    : String(Math.max(0, Math.floor((nowMs - row.lastActivityMs) / 60_000)));
  return [
    row.id, row.machine, row.engine ?? "—", row.model ?? "—",
    clip(row.task ?? "—", 32), row.state, idle,
    clip(row.stuckOn ?? "—", 40), clip(row.needs ?? "—", 40),
    row.contextPct === null ? "—" : `${row.contextPct}%`,
    row.weeklyLimitPct === null ? "—" : `${row.weeklyLimitPct}%`,
  ];
}
export function renderTable(rows: SessionRow[], machines: MachineInfo[], nowMs: number): string {
  const table = rows.map(row => cell(row, nowMs));
  const widths = HEADERS.map((header, i) =>
    Math.max(displayWidth(header), ...table.map(cols => displayWidth(cols[i]))));
  const line = (cols: readonly string[]) => cols.map((c, i) => pad(c, widths[i])).join("  ").trimEnd();
  const out = [line(HEADERS), line(widths.map(w => "-".repeat(w)))];
  for (const cols of table) out.push(line(cols));
  for (const machine of machines) {
    if (machine.available === false || (machine.available === undefined && machine.memFreeMb === null && machine.diskFreeMb === null)) {
      out.push(`${machine.machine}: недоступна`);
      continue;
    }
    const parts = [
      machine.memFreeMb === null ? null : `mem ${machine.memFreeMb}M free`,
      machine.diskFreeMb === null ? null : `disk ${machine.diskFreeMb}M free`,
    ].filter(Boolean).join(" · ");
    out.push(`${machine.machine}: ${parts || "источник доступен; метрики не собираются"}`);
    for (const warning of machine.warnings ?? []) out.push(`${machine.machine}: ${warning}`);
  }
  return out.join("\n");
}
export function renderJson(rows: SessionRow[], machines: MachineInfo[], nowMs: number, version?: string, hidden_count = 0): string {
  return JSON.stringify({ generatedAt: new Date(nowMs).toISOString(), ...(version ? { version } : {}), sessions: rows, machines, hidden_count }, null, 2);
}
