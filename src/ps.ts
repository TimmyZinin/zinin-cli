/** E3 live collector — the thin wrapper around the pure adapters.
 * Reads-only: osascript/tmux/ps/file mtimes. One failing source warns on
 * stderr and never aborts the overview. Verified live by S0 on the Mac.
 */
import { platform } from "node:os";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SessionRow, MachineInfo } from "./sessions/types";
import { parseTerminalWindows } from "./adapters/sessions/terminal-mac";
import { parseTranscriptTail } from "./adapters/sessions/claude-transcript";
import { parseNewaDir } from "./adapters/sessions/newa-workdir";
import { parseTmuxSessions } from "./adapters/sessions/tmux";
import { parseMeminfo, parseDf } from "./adapters/sessions/machine";
import { mergeRows } from "./sessions/merge";
import { applyDerivedStates } from "./sessions/state";
import { renderTable, renderJson } from "./sessions/render";

export interface PsOptions {
  watchSeconds: number | null;
  json: boolean;
  stuckMinutes: number | undefined;
  sources: "mac" | "newa" | "all";
}
function warn(message: string): void {
  console.error(`zinin ps: ${message}`);
}
async function collectMac(rows: SessionRow[]): Promise<MachineInfo> {
  let windowsTsv = "";
  try {
    // S0: verify on Mac — titles of all Terminal windows + last line of each tab.
    const script = [
      'tell application "Terminal"',
      "  set out to \"\"",
      "  repeat with w in windows",
      "    set out to out & (id of w as text) & tab & (name of w) & tab",
      "    try",
      "      set out to out & (contents of front tab of w)",
      "    end try",
      "    set out to out & linefeed",
      "  end repeat",
      "  return out",
      "end tell",
    ].join("\n");
    const proc = Bun.spawn(["osascript", "-e", script], { stdout: "pipe", stderr: "pipe" });
    windowsTsv = await new Response(proc.stdout).text();
  } catch (error) {
    warn(`mac windows unavailable: ${(error as Error).message}`);
  }
  for (const row of parseTerminalWindows(windowsTsv)) rows.push(row);
  // Claude transcripts: mtime = last movement, tail = errors/limits.
  try {
    const root = join(process.env.HOME ?? "~", ".claude", "projects");
    if (existsSync(root)) {
      for (const proj of readdirSync(root)) {
        const dir = join(root, proj);
        for (const file of readdirSync(dir).filter(f => f.endsWith(".jsonl"))) {
          const path = join(dir, file);
          const tail = readFileSync(path, "utf8").split("\n").slice(-50).join("\n");
          const facts = parseTranscriptTail(tail);
          if (facts.stuckOn || facts.contextPct !== null || facts.weeklyLimitPct !== null) {
            rows.push({
              id: file.replace(/\.jsonl$/, ""), machine: "mac", engine: "claude",
              model: null, task: null, state: "working", lastActivityMs: statSync(path).mtimeMs,
              stuckOn: facts.stuckOn, needs: null, contextPct: facts.contextPct,
              weeklyLimitPct: facts.weeklyLimitPct, source: "claude-transcript",
            });
          }
        }
      }
    }
  } catch (error) {
    warn(`claude transcripts unavailable: ${(error as Error).message}`);
  }
  let mem: number | null = null;
  let disk: number | null = null;
  try {
    const vmStat = Bun.spawnSync(["vm_stat"], { stdout: "pipe" });
    const pagesFree = /Pages free:\s+(\d+)/.exec(vmStat.stdout.toString());
    const pageSize = /page size of (\d+)/.exec(vmStat.stdout.toString());
    if (pagesFree && pageSize) mem = Math.round((Number(pagesFree[1]) * Number(pageSize[1])) / 1024 / 1024);
  } catch { /* vm_stat unavailable — nulls are fine */ }
  try {
    const df = Bun.spawnSync(["df", "-k", "/"], { stdout: "pipe" });
    disk = parseDf(df.stdout.toString());
  } catch { /* df unavailable */ }
  return { machine: "mac", memFreeMb: mem, diskFreeMb: disk };
}
function readIfExists(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}
async function collectNewa(rows: SessionRow[]): Promise<MachineInfo> {
  const root = "/home/agents/work";
  const nowMs = Date.now();
  try {
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      let turnMtimes: number[] = [];
      let taskText: string | null = null;
      try {
        const turns = join(dir, "turns");
        if (existsSync(turns)) {
          turnMtimes = readdirSync(turns).map(f => statSync(join(turns, f)).mtimeMs);
        }
      } catch { /* turns unreadable — empty activity */ }
      try {
        const taskFile = readdirSync(dir).find(f => /^TASK.*\.md$/i.test(f) && !f.startsWith("._"));
        if (taskFile) taskText = readIfExists(join(dir, taskFile));
      } catch { /* no task file */ }
      let hasMarker = false;
      try {
        hasMarker = existsSync(join(dir, "meta.json")) || existsSync(join(dir, "status.json")) || turnMtimes.length > 0;
      } catch { /* unreadable */ }
      if (!hasMarker) continue;
      rows.push(parseNewaDir({
        name,
        metaText: readIfExists(join(dir, "meta.json")),
        statusText: readIfExists(join(dir, "status.json")),
        toS0Text: readIfExists(join(dir, "TO-S0.md")),
        reportText: readIfExists(join(dir, "REPORT-S0.md")),
        taskText,
        turnMtimesMs: turnMtimes,
        nowMs,
      }));
    }
  } catch (error) {
    warn(`work root ${root} unavailable: ${(error as Error).message}`);
  }
  try {
    const proc = Bun.spawnSync(["tmux", "-S", "/run/apparat-agents/tmux.sock", "ls"], { stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode === 0) for (const row of parseTmuxSessions(proc.stdout.toString(), nowMs)) rows.push(row);
  } catch (error) {
    warn(`tmux unavailable: ${(error as Error).message}`);
  }
  let mem: number | null = null;
  let disk: number | null = null;
  try { mem = parseMeminfo(readFileSync("/proc/meminfo", "utf8")); } catch { /* no proc */ }
  try {
    const df = Bun.spawnSync(["df", "-k", "/"], { stdout: "pipe" });
    disk = parseDf(df.stdout.toString());
  } catch { /* df unavailable */ }
  return { machine: "newa", memFreeMb: mem, diskFreeMb: disk };
}
async function collect(opts: PsOptions): Promise<{ rows: SessionRow[]; machines: MachineInfo[]; nowMs: number }> {
  const rows: SessionRow[] = [];
  const machines: MachineInfo[] = [];
  const host = platform() === "darwin" ? "mac" : existsSync("/home/agents/work") ? "newa" : "unknown";
  if ((opts.sources === "mac" || opts.sources === "all") && (host === "mac" || opts.sources !== "all")) {
    machines.push(await collectMac(rows));
  }
  if ((opts.sources === "newa" || opts.sources === "all") && (host === "newa" || opts.sources !== "all")) {
    machines.push(await collectNewa(rows));
  }
  const nowMs = Date.now();
  const merged = applyDerivedStates(mergeRows(rows), nowMs, opts.stuckMinutes);
  return { rows: merged, machines, nowMs };
}
function print(out: string): void {
  process.stdout.write(out + "\n");
}
export async function psMain(argv: string[]): Promise<void> {
  const opts: PsOptions = { watchSeconds: null, json: false, stuckMinutes: undefined, sources: "all" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--watch") {
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) { opts.watchSeconds = Number(next); i++; }
      else opts.watchSeconds = 5;
    }
    else if (arg === "--stuck-minutes") {
      const next = argv[++i];
      const value = Number(next);
      if (!Number.isFinite(value) || value <= 0) { warn("--stuck-minutes expects a positive number"); process.exit(2); }
      opts.stuckMinutes = value;
    }
    else if (arg === "--sources") {
      const next = argv[++i];
      if (next !== "mac" && next !== "newa" && next !== "all") { warn("--sources expects mac|newa|all"); process.exit(2); }
      opts.sources = next;
    }
    else if (arg === "--help" || arg === "-h") {
      print("zinin ps — обзор всех сессий (только чтение)\n" +
        "  --watch [N]        обновлять раз в N секунд (по умолчанию 5)\n" +
        "  --json             машинный вывод\n" +
        "  --stuck-minutes N  порог stuck для всех движков (claude 20, kimi/codex 30)\n" +
        "  --sources mac|newa|all  источники (по умолчанию: машина, на которой запущен)");
      return;
    }
    else { warn(`unknown argument: ${arg}`); process.exit(2); }
  }
  const host = platform() === "darwin" ? "mac" : existsSync("/home/agents/work") ? "newa" : "unknown";
  if (opts.sources === "all") opts.sources = host === "unknown" ? "all" : host;
  const renderOnce = async () => {
    const { rows, machines, nowMs } = await collect(opts);
    if (opts.json) print(renderJson(rows, machines, nowMs));
    else print(renderTable(rows, machines, nowMs));
  };
  if (opts.watchSeconds === null) { await renderOnce(); return; }
  await renderOnce();
  const timer = setInterval(() => { console.clear(); void renderOnce(); }, opts.watchSeconds * 1000);
  await new Promise<void>(resolve => {
    process.on("SIGINT", () => { clearInterval(timer); resolve(); });
    process.on("SIGTERM", () => { clearInterval(timer); resolve(); });
  });
}
