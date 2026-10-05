import { parseRemoteDetails } from "./details";
import type { SessionRow, MachineInfo } from "./types";
import type { SourceSnapshot } from "./newa-collector";
import { MAX_COMMAND_BYTES } from "./command";
const states = new Set(["working", "idle", "waiting-tim", "stuck", "limit", "starting", "closing", "done"]);
const activity = new Set(["working", "idle", "starting", "closing", "unknown"]);
const groups = new Set(["working", "waiting", "submitted", "idle", "stopped", "unknown"]);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 4096): v is string => typeof v === "string" && v.length <= max;
const text = (v: unknown) => v === null || str(v);
const number = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
const percent = (v: unknown) => number(v) && (v === null || (v as number) <= 100);
function evidence(v: unknown, decision = false): boolean {
  return v === null || (object(v) && str(v.text) && ["TO-S0.md", "REPORT-S0.md"].includes(v.source as string) && number(v.atMs) &&
    (!decision || ["current", "stale", "unknown"].includes(v.freshness as string)));
}
function estimate(v: unknown, validate: (value: unknown) => boolean): boolean {
  return object(v) && v.source === "status-mtime" && v.confidence === "estimate" && number(v.atMs) && validate(v.value);
}
/** Validate the whole remote snapshot before accepting any of its rows. */
export function parseRemoteSnapshot(raw: string): SourceSnapshot {
  if (Buffer.byteLength(raw) > MAX_COMMAND_BYTES) throw new Error("remote payload too large");
  const parsed: unknown = JSON.parse(raw);
  if (!object(parsed) || !Array.isArray(parsed.sessions) || parsed.sessions.length > 2048 || !Array.isArray(parsed.machines) || parsed.machines.length !== 1) throw new Error("invalid remote snapshot");
  if (parsed.version !== undefined && !str(parsed.version, 128)) throw new Error("invalid remote version");
  // The caller requests --all; silently accepting a partial remote list would
  // make local --all and --since impossible to honour.
  if (parsed.hidden_count !== undefined && parsed.hidden_count !== 0) throw new Error("remote snapshot must include all sessions");
  const ids = new Set<string>();
  const rows: SessionRow[] = [];
  for (const v of parsed.sessions) {
    if (!object(v) || !str(v.id, 256) || !v.id || ids.has(v.id) || v.machine !== "newa" || !states.has(v.state as string) ||
      !str(v.source, 1024) || ![v.engine, v.model, v.task, v.stuckOn, v.needs].every(text) ||
      !number(v.lastActivityMs) || !percent(v.contextPct) || !percent(v.weeklyLimitPct) ||
      (v.taskSource !== undefined && !text(v.taskSource)) ||
      (v.liveness !== undefined && !["alive", "stopped", "unknown"].includes(v.liveness as string)) ||
      (v.activity !== undefined && !activity.has(v.activity as string)) ||
      (v.decision !== undefined && !evidence(v.decision, true)) ||
      (v.lastSubmission !== undefined && !evidence(v.lastSubmission)) ||
      (v.lastSayMs !== undefined && !number(v.lastSayMs)) ||
      (v.overviewGroup !== undefined && !estimate(v.overviewGroup, x => groups.has(x as string))) ||
      (v.possiblyStuck !== undefined && !estimate(v.possiblyStuck, x => x === null || typeof x === "boolean")) ||
      (v.stoppedReason !== undefined && !estimate(v.stoppedReason, text))) throw new Error("invalid remote session");
    ids.add(v.id);
    const copy: Record<string, unknown> = {};
    for (const key of ["id", "machine", "state", "source", "engine", "model", "task", "taskSource", "stuckOn", "needs", "lastActivityMs", "contextPct", "weeklyLimitPct", "liveness", "activity", "decision", "lastSubmission", "lastSayMs", "overviewGroup", "possiblyStuck", "stoppedReason"]) {
      if (v[key] !== undefined) copy[key] = v[key];
    }
    for (const key of ["decision", "lastSubmission"]) {
      const signal = v[key];
      if (object(signal)) copy[key] = { text: signal.text, source: signal.source, atMs: signal.atMs,
        ...(key === "decision" ? { freshness: signal.freshness } : {}) };
    }
    for (const key of ["overviewGroup", "possiblyStuck", "stoppedReason"]) {
      const signal = v[key];
      if (object(signal)) copy[key] = { value: signal.value, source: signal.source, confidence: signal.confidence, atMs: signal.atMs };
    }
    if (v.details !== undefined) copy.details = parseRemoteDetails(v.details);
    rows.push(copy as unknown as SessionRow);
  }
  const m = parsed.machines[0];
  if (!object(m) || m.machine !== "newa" || !number(m.memFreeMb) || !number(m.diskFreeMb) ||
    (m.version !== undefined && m.version !== null && !str(m.version, 128)) ||
    (m.available !== undefined && typeof m.available !== "boolean") ||
    (m.warnings !== undefined && (!Array.isArray(m.warnings) || m.warnings.length > 100 || !m.warnings.every(v => str(v, 1024))))) throw new Error("invalid remote machine");
  const machine: MachineInfo = { machine: "newa", memFreeMb: m.memFreeMb as number | null, diskFreeMb: m.diskFreeMb as number | null,
    available: m.available as boolean | undefined ?? true,
    ...(m.warnings === undefined ? {} : { warnings: m.warnings as string[] }),
    version: (m.version ?? parsed.version ?? null) as string | null };
  return { rows, machine };
}
