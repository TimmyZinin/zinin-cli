/** E3 rendering: plain aligned table (no required colors) and --json output. */
import type { SessionRow, MachineInfo } from "./types";

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
    Math.max(header.length, ...table.map(cols => cols[i].length)));
  const line = (cols: readonly string[]) => cols.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  const out = [line(HEADERS), line(widths.map(w => "-".repeat(w)))];
  for (const cols of table) out.push(line(cols));
  for (const machine of machines) {
    if (machine.memFreeMb === null && machine.diskFreeMb === null) continue;
    const parts = [
      machine.memFreeMb === null ? null : `mem ${machine.memFreeMb}M free`,
      machine.diskFreeMb === null ? null : `disk ${machine.diskFreeMb}M free`,
    ].filter(Boolean).join(" · ");
    out.push(`${machine.machine}: ${parts}`);
  }
  return out.join("\n");
}
export function renderJson(rows: SessionRow[], machines: MachineInfo[], nowMs: number): string {
  return JSON.stringify({ generatedAt: new Date(nowMs).toISOString(), sessions: rows, machines }, null, 2);
}
