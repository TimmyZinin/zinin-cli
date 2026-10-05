import type { SessionRow } from "./types";
export const DEFAULT_SINCE_MS = 24 * 60 * 60_000;
export function parseSince(value: string | undefined): number {
  const match = /^(\d+(?:\.\d+)?)(m|h|d)$/.exec(value ?? "");
  const ms = match ? Number(match[1]) * ({m: 60_000, h: 3_600_000, d: 86_400_000}[match[2]] ?? 0) : 0;
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new Error("--since expects a positive duration, for example 24h, 30m or 7d");
  return ms;
}
export function filterRecent(rows: SessionRow[], nowMs: number, all = false, sinceMs = DEFAULT_SINCE_MS): { rows: SessionRow[]; hidden_count: number } {
  const visible = all ? rows : rows.filter(row => row.activity === "working" || row.overviewGroup?.value === "working" ||
    (!row.activity && ["working", "stuck", "starting", "closing"].includes(row.state)) ||
    (row.lastActivityMs !== null && row.lastActivityMs >= nowMs - sinceMs && row.lastActivityMs <= nowMs));
  return { rows: visible, hidden_count: rows.length - visible.length };
}
