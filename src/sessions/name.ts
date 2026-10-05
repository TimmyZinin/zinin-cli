import type { SessionRow } from "./types";
export function sessionName(row: SessionRow): string {
  if (row.source === "work-journal") return row.id;
  if (row.machine !== "mac") return row.id;
  if (row.engine) return row.engine;
  return `окно ${row.windowId ?? /(?:mac-win-|mac-tab-)(\d+)/.exec(row.id)?.[1] ?? "?"}`;
}
