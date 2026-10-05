/** E4 live collector — bounded, injectable, independent sources.
 * Newa reads only allowed top-level worker files; no tmux socket or turns.
 * Source failures become diagnostics and never discard another source. Mac specifics per S0 live test
 * (docs e3-live-findings 26.09): ASCII-9/30 separators, last 64 KiB of
 * transcripts, only files touched within the window, transcripts enrich
 * windows instead of spawning rows.
 */
import { collectWorkJournal } from "./sessions/work-journal";
import { defaultJournal } from "./work";
import { platform, homedir } from "node:os";
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import type { SessionRow, MachineInfo } from "./sessions/types";
import { TERMINAL_TABS_SCRIPT } from "./adapters/sessions/terminal-script";
import { parseTerminalWindows, parseTerminalWarnings, parseLaunchDirs } from "./adapters/sessions/terminal-mac";
import { parseTranscriptTail, cwdToProjectSlug } from "./adapters/sessions/claude-transcript";
import { collectNewaSnapshot, type SourceSnapshot, type NewaCollectorOptions } from "./sessions/newa-collector";
import { runCommand, type CommandRunner } from "./sessions/command";
import { parseRemoteSnapshot } from "./sessions/remote";
import {buildVersion,BUILD_INFO} from "./build-info";
import { parseDf, parseVmStat, parseMemoryPressure } from "./adapters/sessions/machine";
import { mergeRows } from "./sessions/merge";
import { applyDerivedStates } from "./sessions/state";
import { renderJson } from "./sessions/render";
import { filterRecent, parseSince } from "./sessions/freshness";
import { matchSessions, renderSessionDetails, type ShowResult } from "./sessions/details";
import { renderOverview } from "./sessions/overview";
import { enrichRowsWithTranscripts, windowProjectKey, type SlugFacts, type WindowScreen } from "./sessions/enrich";
import { parsePsConfig } from "./sessions/psconfig";

export interface PsOptions {
  show?: string;
  detailId?: string;
  all?: boolean;
  sinceMs?: number;
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
async function collectMac(rows: SessionRow[], nowMs: number, run: CommandRunner, signal: AbortSignal, details = false): Promise<MachineInfo> {
  let available = false;
  let windowsRaw = "";
  try {
    windowsRaw = await run(["osascript", "-e", TERMINAL_TABS_SCRIPT], { signal });
    available = true;
  } catch (error) {
    warn(`mac windows unavailable: ${(error as Error).message}`);
  }
  const screens = new Map<string, WindowScreen>();
  for (const row of parseTerminalWindows(windowsRaw, (id, screen) => screens.set(id, screen), { tabs: true, details })) {
    rows.push(row);
  }
  // К4-2: engine-process launch directories by tty (ps + lsof, reads-only).
  // The launch dir is the primary window↔transcript key; status-line cwd
  // (already on the screens) is only the fallback.
  try {
    const psText = await run(["ps", "-Ao", "pid,tty,args"], { signal });
    const enginePids = [...psText.matchAll(/^\s*(\d+)\s+(ttys\d+)\s+.*(?:claude|kimi|codex)/gm)].map(m => Number(m[1]));
    let launchDirs = new Map<string, string>();
    if (enginePids.length) {
      const args = ["-a", "-d", "cwd", "-Fn"];
      for (const pid of enginePids) args.push("-p", String(pid));
      const lsofText = await run(["lsof", ...args], { signal });
      launchDirs = parseLaunchDirs(psText, lsofText);
    }
    for (const [id, screen] of screens) {
      screen.key = windowProjectKey(screen, launchDirs, cwdToProjectSlug);
      const row = rows.find(row => row.id === id);
      if (row?.details?.terminal) row.details.terminal.cwd = (screen.tty ? launchDirs.get(screen.tty) : null) ?? screen.cwd;
    }
  } catch (error) {
    warn(`launch dirs unavailable: ${(error as Error).message}`);
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
    const mp = await run(["memory_pressure"], { signal });
    const pct = parseMemoryPressure(mp);
    if (pct !== null) {
      const total = await run(["sysctl", "-n", "hw.memsize"], { signal });
      const totalMb = Number(total.trim()) / 1024 / 1024;
      if (Number.isFinite(totalMb) && totalMb > 0) mem = Math.round((totalMb * pct) / 100);
    }
  } catch { /* memory_pressure unavailable — fall through */ }
  if (mem === null) try {
    const vmStat = await run(["vm_stat"], { signal });
    mem = parseVmStat(vmStat);
  } catch { /* vm_stat unavailable — nulls are fine */ }
  try {
    const df = await run(["df", "-k", "/"], { signal });
    disk = parseDf(df);
  } catch { /* df unavailable */ }
  return { machine: "mac", memFreeMb: mem, diskFreeMb: disk, version: codeVersion(), available, warnings: parseTerminalWarnings(windowsRaw) };
}
/** N-5: from the Mac, newa rows come over the same ssh lock as remote.py get.
 * Default reaches the pinned bun and the deployed checkout on newa by absolute
 * path (neither `zinin` nor `bun` is in a non-interactive ssh PATH there).
 * K3-3: this default is TEMPORARY — it lives in the worker's own checkout; pin
 * a stable install via ~/.zinin/ps.json {"newaCmd": [...]} or ZININ_PS_NEWA_CMD. */
const DEFAULT_NEWA_CMD = [
  "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "newa",
  "/home/agents/work/zinin-harness-e2/runtime/bun-1.3.0/bun",
  "/home/agents/work/zinin-harness-e3/zinin-cli/src/repl.ts", "ps", "--sources", "newa", "--json",
];
export function resolveNewaCmd(): string[] {
  const env = process.env.ZININ_PS_NEWA_CMD;
  if (env) return [...env.split(" ").filter(Boolean), "zinin", "ps", "--sources", "newa", "--json"];
  try {
    const config = parsePsConfig(readFileSync(join(homedir(), ".zinin", "ps.json"), "utf8"));
    if (config.newaCmd) return config.newaCmd;
  } catch { /* no config file — default below */ }
  return DEFAULT_NEWA_CMD;
}
export interface CollectorDependencies {
  host?: "mac" | "newa" | "unknown";
  now?: () => number;
  run?: CommandRunner;
  remoteCommand?: string[];
  newaOptions?: NewaCollectorOptions;
  workJournalPath?: string | null;
  timeoutMs?: number;
  mac?: (nowMs: number, signal: AbortSignal) => Promise<SourceSnapshot>;
  newa?: (nowMs: number, signal: AbortSignal) => Promise<SourceSnapshot>;
  remote?: (nowMs: number, signal: AbortSignal) => Promise<SourceSnapshot>;
}
async function boundedSource(machine: string, source: (signal: AbortSignal) => Promise<SourceSnapshot>, timeoutMs: number, parent?: AbortSignal): Promise<SourceSnapshot> {
  const controller = new AbortController();
  let rejectStop!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  const abort = () => { controller.abort(); rejectStop(new Error("source cancelled")); };
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try { return await Promise.race([Promise.resolve().then(() => { if (controller.signal.aborted) throw new Error("cancelled"); return source(controller.signal); }), stopped]); }
  catch { return { rows: [], machine: { machine, memFreeMb: null, diskFreeMb: null, available: false, warnings: ["source unavailable or timed out"] } }; }
  finally { clearTimeout(timer); parent?.removeEventListener("abort", abort); }
}
export async function collect(opts: PsOptions, deps: CollectorDependencies = {}, signal?: AbortSignal): Promise<{ rows: SessionRow[]; machines: MachineInfo[]; nowMs: number; hidden_count: number }> {
  const nowMs = (deps.now ?? Date.now)();
  const host = deps.host ?? (platform() === "darwin" ? "mac" : existsSync("/home/agents/work") ? "newa" : "unknown");
  const run = deps.run ?? runCommand;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("invalid source timeout");
  const mac = deps.mac ?? (async (now: number, abort: AbortSignal) => {
    const rows: SessionRow[] = [];
    const machine = await collectMac(rows, now, run, abort, opts.show !== undefined);
    return { rows, machine };
  });
  const newa = deps.newa ?? (async (now: number, abort: AbortSignal) => {
    const snapshot = collectNewaSnapshot({ ...deps.newaOptions, nowMs: now, signal: abort, detailId: opts.detailId });
    snapshot.machine.version = codeVersion();
    return snapshot;
  });
  const remote = deps.remote ?? (async (_now: number, abort: AbortSignal) =>
    parseRemoteSnapshot(await run([...(deps.remoteCommand ?? resolveNewaCmd()), "--all", ...(opts.detailId === undefined ? [] : ["--detail-id", Buffer.from(opts.detailId).toString("base64url")])], { signal: abort })));
  const sources: Promise<SourceSnapshot>[] = [];
  if ((opts.sources === "mac" || opts.sources === "all") && host !== "newa") sources.push(boundedSource("mac", abort => mac(nowMs, abort), timeoutMs, signal));
  if (opts.sources === "newa" || opts.sources === "all") sources.push(boundedSource("newa", abort => (host === "newa" ? newa : remote)(nowMs, abort), timeoutMs, signal));
  const snapshots = await Promise.all(sources);
  const localEnabled=(host==="newa"&&opts.sources!=="mac")||(host==="mac"&&opts.sources!=="newa");
  const managed=localEnabled&&deps.workJournalPath!==null ? collectWorkJournal(deps.workJournalPath??defaultJournal(),host as "mac"|"newa") : {rows:[],warnings:[]};
  if(managed.warnings.length){const info=snapshots.find(s=>s.machine.machine===host);if(info)info.machine.warnings=[...(info.machine.warnings??[]),...managed.warnings];}
  return { ...filterRecent(applyDerivedStates(mergeRows([...snapshots.flatMap(s => s.rows),...managed.rows]), nowMs, opts.stuckMinutes), nowMs, opts.all, opts.sinceMs), machines: snapshots.map(s => s.machine), nowMs };
}
/** Resolve against an unfiltered overview, then request details only for the exact worker. */
export async function showSession(query: string, opts: PsOptions, deps: CollectorDependencies = {}, signal?: AbortSignal): Promise<ShowResult> {
  if (!query.trim() || query.length > 256 || /[\x00-\x1f]/.test(query)) throw new Error("show expects a session name or id");
  const snapshot = await collect({...opts, all:true, show:query, detailId:undefined},deps,signal);
  const matches = matchSessions(snapshot.rows,query);
  const result: ShowResult = {query, status: matches.length > 1 ? "ambiguous" : matches.length ? "found" : snapshot.machines.some(m=>m.available===false) ? "unavailable" : "not-found",
    sessions:matches, machines:snapshot.machines, generatedAt:new Date(snapshot.nowMs).toISOString()};
  if(matches.length!==1) return result;
  if(matches[0].machine==="newa") {
    const details=await collect({...opts,sources:"newa",all:true,detailId:matches[0].id},deps,signal);
    const found=details.rows.find(row=>row.machine==="newa" && row.id===matches[0].id && row.details);
    result.machines=[...result.machines.filter(m=>m.machine!=="newa"),...details.machines];
    if(found) result.sessions=[found]; else { result.status="unavailable"; result.sessions=[]; }
  }
  return result;
}
function print(out: string): void {
  process.stdout.write(out + "\n");
}
/** Installed binaries use embedded metadata and never inspect the caller's .git. */
export function codeVersion(_dir?:string):string {return buildVersion();}
export async function psMain(argv: string[], deps: CollectorDependencies = {}): Promise<void> {
  const opts: PsOptions = { watchSeconds: null, json: false, stuckMinutes: undefined, sources: "all" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "show") {
      const query=argv[++i];
      if (!query || query.startsWith("--")) throw new Error("show expects a session name or id");
      opts.show=query;
    }
    else if (arg === "--detail-id") {
      const encoded=argv[++i];
      if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length>1400) throw new Error("invalid detail id");
      opts.detailId=Buffer.from(encoded,"base64url").toString("utf8");
      opts.all=true;
    }
    else if(arg==="--newa-root"){
      const root=argv[++i];if(!root||root.startsWith("--"))throw new Error("--newa-root expects a local directory");
      deps={...deps,host:"newa",newaOptions:{...deps.newaOptions,root}};
    }
    else if (arg === "--all") opts.all = true;
    else if (arg === "--since") opts.sinceMs = parseSince(argv[++i]);
    else if (arg === "--watch") {
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) { opts.watchSeconds = Number(next); i++; if (!Number.isSafeInteger(opts.watchSeconds) || opts.watchSeconds < 1 || opts.watchSeconds > 86400) throw new Error("--watch expects 1..86400 seconds"); }
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
        "  show <имя|id>     подробности; неоднозначное имя показывает совпадения\n" +
        "  --watch [N]        обновлять раз в N секунд (по умолчанию 5)\n" +
        "  --json             машинный вывод\n" +
        "  --since 24h        период свежести (m/h/d), всегда включает running\n" +
        "  --all              включить старые сессии\n" +
        "  --newa-root DIR     читать локальный каталог newa (для offline-проверки)\n" +
        "  --stuck-minutes N  порог stuck для всех движков (claude 20, kimi/codex 30)\n" +
        "  --sources mac|newa|all  источники (с Мака newa читается по ssh: ZININ_PS_NEWA_CMD)");
      return;
    }
    else { warn(`unknown argument: ${arg}`); process.exit(2); }
  }
  if (opts.show !== undefined && opts.watchSeconds !== null) throw new Error("show does not support --watch");
  const controller = new AbortController();
  const terminalWatch=opts.watchSeconds!==null&&!opts.json&&!!process.stdout.isTTY;
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    if(terminalWatch)process.stdout.write("\x1b[?1049h\x1b[?25l");
    if (opts.show !== undefined) {
      const result=await showSession(opts.show,opts,deps,controller.signal);
      print(opts.json ? JSON.stringify({...result,build:BUILD_INFO},null,2) : renderSessionDetails(result));
      return;
    }
    do {
      const { rows, machines, nowMs, hidden_count } = await collect(opts, deps, controller.signal);
      if (controller.signal.aborted) break;
      const frame=opts.json ? renderJson(rows, machines, nowMs, codeVersion(), hidden_count) : renderOverview(rows, machines, nowMs, hidden_count);
      if(terminalWatch)process.stdout.write("\x1b[H"+frame+"\x1b[J");else print(frame);
      if (opts.watchSeconds === null) break;
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, opts.watchSeconds! * 1000);
        controller.signal.addEventListener("abort", finish, { once: true });
        if (controller.signal.aborted) finish();
      });
    } while (!controller.signal.aborted);
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);if(terminalWatch)process.stdout.write("\x1b[?25h\x1b[?1049l"); }
}
