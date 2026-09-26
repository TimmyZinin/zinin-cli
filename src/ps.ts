/** E3 live collector — the thin wrapper around the pure adapters.
 * Reads-only: osascript/tmux/ssh/ps/file mtimes. One failing source warns on
 * stderr and never aborts the overview. Mac specifics per S0 live test
 * (docs e3-live-findings 26.09): ASCII-9/30 separators, last 64 KiB of
 * transcripts, only files touched within the window, transcripts enrich
 * windows instead of spawning rows.
 */
import { platform } from "node:os";
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import type { SessionRow, MachineInfo } from "./sessions/types";
import { parseTerminalWindows } from "./adapters/sessions/terminal-mac";
import { parseTranscriptTail, cwdToProjectSlug } from "./adapters/sessions/claude-transcript";
import { parseNewaDir } from "./adapters/sessions/newa-workdir";
import { parseTmuxSessions } from "./adapters/sessions/tmux";
import { parseMeminfo, parseDf, parseVmStat, parseMemoryPressure } from "./adapters/sessions/machine";
import { mergeRows } from "./sessions/merge";
import { applyDerivedStates } from "./sessions/state";
import { renderTable, renderJson } from "./sessions/render";
import { enrichRowsWithTranscripts, type SlugFacts, type WindowScreen } from "./sessions/enrich";

export interface PsOptions {
  watchSeconds: number | null;
  json: boolean;
  stuckMinutes: number | undefined;
  sources: "mac" | "newa" | "all";
}
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;
const transcriptWindowMs = () => {
  const minutes = Number(process.env.ZININ_PS_TRANSCRIPT_MINUTES ?? 1440);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 1440) * 60_000;
};
function warn(message: string): void {
  console.error(`zinin ps: ${message}`);
}
/** Last maxBytes of a file without throwing on missing/truncated files. */
function readTail(path: string, maxBytes = TRANSCRIPT_TAIL_BYTES): string {
  let size: number;
  try { size = statSync(path).size; } catch { return ""; }
  const length = Math.min(maxBytes, size);
  if (length <= 0) return "";
  let fd: number;
  try { fd = openSync(path, "r"); } catch { return ""; }
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    let text = buffer.toString("utf8");
    if (size > maxBytes) text = text.slice(text.indexOf("\n") + 1); // drop a partial first line
    return text;
  } catch { return ""; }
  finally { try { closeSync(fd); } catch { /* already closed */ } }
}
/** K3-1: the freshest .jsonl of a project inside the window is an activity
 * fact by itself — no content precondition. Only that one file gets its tail
 * parsed (≤1 read per project), and a quiet tail still yields lastActivityMs,
 * otherwise `stuck` stays unreachable on the Mac. */
export function collectTranscriptFacts(root: string, nowMs: number): Map<string, SlugFacts> {
  const facts = new Map<string, SlugFacts>();
  if (!existsSync(root)) return facts;
  const windowMs = transcriptWindowMs();
  for (const slug of readdirSync(root)) {
    const dir = join(root, slug);
    let stat;
    try { stat = statSync(dir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    let files: string[];
    try { files = readdirSync(dir).filter(f => f.endsWith(".jsonl")); } catch { continue; }
    let latestPath: string | null = null;
    let latestMtime = 0;
    for (const file of files) {
      const path = join(dir, file);
      let mtimeMs: number;
      try { mtimeMs = statSync(path).mtimeMs; } catch { continue; }
      if (nowMs - mtimeMs > windowMs) continue; // P0-3: only recently moved files
      if (mtimeMs <= latestMtime) continue;
      latestMtime = mtimeMs;
      latestPath = path;
    }
    if (!latestPath) continue;
    const parsed = parseTranscriptTail(readTail(latestPath));
    facts.set(slug, { lastActivityMs: latestMtime, stuckOn: parsed.stuckOn });
  }
  return facts;
}
async function collectMac(rows: SessionRow[], nowMs: number): Promise<MachineInfo> {
  let windowsRaw = "";
  try {
    // Verified on Mac (S0, 26.09): `tab` inside tell is the Terminal class, so
    // separators are built from ASCII codes before the tell block.
    const script = [
      "set tabChar to (ASCII character 9)",
      "set recSep to (ASCII character 30)",
      'tell application "Terminal"',
      '  set out to ""',
      "  repeat with w in windows",
      "    if (count of tabs of w) is 0 then", // phantom window after close
      "      set out to out & recSep",
      "    else",
      '      set out to out & (id of w as text) & tabChar & (name of w) & tabChar',
      "      try",
      "        set out to out & (contents of selected tab of w)",
      "      end try",
      "      set out to out & tabChar & ((busy of selected tab of w) as text)",
      "      set out to out & recSep",
      "    end if",
      "  end repeat",
      "  return out",
      "end tell",
    ].join("\n");
    const proc = Bun.spawn(["osascript", "-e", script], { stdout: "pipe", stderr: "pipe" });
    windowsRaw = await new Response(proc.stdout).text();
  } catch (error) {
    warn(`mac windows unavailable: ${(error as Error).message}`);
  }
  const screens = new Map<string, WindowScreen>();
  for (const row of parseTerminalWindows(windowsRaw, (id, screen) => screens.set(id, screen))) {
    rows.push(row);
  }
  // P1-4/N-4: transcripts do not create rows — they enrich the one window that
  // owns the session (last movement + hard errors, full-slug key from N-3).
  try {
    const root = join(process.env.HOME ?? "~", ".claude", "projects");
    enrichRowsWithTranscripts(rows, screens, collectTranscriptFacts(root, nowMs), cwdToProjectSlug);
  } catch (error) {
    warn(`claude transcripts unavailable: ${(error as Error).message}`);
  }
  // N-6: footer memory = memory_pressure system-wide free % × total RAM;
  // vm_stat's "Pages free" alone reads as ~0 and misleads. vm_stat sum is
  // only a fallback when memory_pressure is missing.
  let mem: number | null = null;
  let disk: number | null = null;
  try {
    const mp = Bun.spawnSync(["memory_pressure"], { stdout: "pipe" });
    const pct = parseMemoryPressure(mp.stdout.toString());
    if (pct !== null) {
      const total = Bun.spawnSync(["sysctl", "-n", "hw.memsize"], { stdout: "pipe" });
      const totalMb = Number(total.stdout.toString().trim()) / 1024 / 1024;
      if (Number.isFinite(totalMb) && totalMb > 0) mem = Math.round((totalMb * pct) / 100);
    }
  } catch { /* memory_pressure unavailable — fall through */ }
  if (mem === null) try {
    const vmStat = Bun.spawnSync(["vm_stat"], { stdout: "pipe" });
    mem = parseVmStat(vmStat.stdout.toString());
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
async function collectNewa(rows: SessionRow[], nowMs: number): Promise<MachineInfo | null> {
  const root = "/home/agents/work";
  if (!existsSync(root)) return null; // honest absence — no mislabeled footer
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
/** N-5: from the Mac, newa rows come over the same ssh lock as remote.py get.
 * Default reaches the pinned bun and the deployed checkout on newa by absolute
 * path (neither `zinin` nor `bun` is in a non-interactive ssh PATH there). */
const DEFAULT_NEWA_CMD = [
  "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "newa",
  "/home/agents/work/zinin-harness-e2/runtime/bun-1.3.0/bun",
  "/home/agents/work/zinin-harness-e3/zinin-cli/src/repl.ts", "ps", "--sources", "newa", "--json",
];
async function collectRemoteNewa(rows: SessionRow[], machines: MachineInfo[]): Promise<void> {
  const override = process.env.ZININ_PS_NEWA_CMD;
  try {
    let parsed: { sessions?: SessionRow[]; machines?: MachineInfo[] };
    if (override) {
      const proc = Bun.spawn([...override.split(" ").filter(Boolean), "zinin", "ps", "--sources", "newa", "--json"], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = [await new Response(proc.stdout).text(), await new Response(proc.stderr).text(), await proc.exited];
      if (code !== 0) throw new Error(stderr.trim().split("\n").pop() ?? `exit ${code}`);
      parsed = JSON.parse(stdout);
    } else {
      const proc = Bun.spawn(DEFAULT_NEWA_CMD, { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = [await new Response(proc.stdout).text(), await new Response(proc.stderr).text(), await proc.exited];
      if (code !== 0) throw new Error(stderr.trim().split("\n").pop() ?? `exit ${code}`);
      parsed = JSON.parse(stdout);
    }
    for (const row of parsed.sessions ?? []) rows.push(row);
    for (const machine of parsed.machines ?? []) machines.push(machine);
  } catch (error) {
    warn(`newa через ssh недоступна: ${(error as Error).message}`);
    machines.push({ machine: "newa", memFreeMb: null, diskFreeMb: null });
  }
}
async function collect(opts: PsOptions): Promise<{ rows: SessionRow[]; machines: MachineInfo[]; nowMs: number }> {
  const rows: SessionRow[] = [];
  const machines: MachineInfo[] = [];
  const host = platform() === "darwin" ? "mac" : existsSync("/home/agents/work") ? "newa" : "unknown";
  const nowMs = Date.now();
  // N-5: on the Mac "all" means both tables in one run; on newa the Mac half
  // is unreachable, so "all" stays local there.
  const wantMac = (opts.sources === "mac" || opts.sources === "all") && host !== "newa";
  const wantNewa = opts.sources === "newa" || opts.sources === "all";
  if (wantMac) machines.push(await collectMac(rows, nowMs));
  if (wantNewa) {
    if (host === "newa") {
      const machine = await collectNewa(rows, nowMs);
      if (machine) machines.push(machine);
      else machines.push({ machine: "newa", memFreeMb: null, diskFreeMb: null });
    } else {
      await collectRemoteNewa(rows, machines);
    }
  }
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
        "  --sources mac|newa|all  источники (с Мака newa читается по ssh: ZININ_PS_NEWA_CMD)");
      return;
    }
    else { warn(`unknown argument: ${arg}`); process.exit(2); }
  }
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
