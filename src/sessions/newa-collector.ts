/** Read only an allowlist at the first level of each worker directory. */
import { openSync, closeSync, fstatSync, readSync, readdirSync, constants } from "node:fs";
import { join, resolve } from "node:path";
import { parseNewaDir } from "../adapters/sessions/newa-workdir";
import { addStatusEstimates, type EstimateOptions } from "./estimates";
import type { SessionRow, MachineInfo } from "./types";

export interface SourceSnapshot { rows: SessionRow[]; machine: MachineInfo }
export const MAX_INPUT_BYTES = 128 * 1024;
export const MAX_WORKERS = 1024;
export interface NewaCollectorOptions extends EstimateOptions {
  root?: string; nowMs?: number; maxBytes?: number; maxWorkers?: number;
  timeoutMs?: number; signal?: AbortSignal;
}
const bounded = (n: number | undefined, fallback: number) => n !== undefined && Number.isSafeInteger(n) && n > 0 ? Math.min(n, fallback) : fallback;

export function collectNewaSnapshot(options: NewaCollectorOptions = {}): SourceSnapshot {
  const nowMs = options.nowMs ?? Date.now();
  const root = resolve(options.root ?? "/home/agents/work");
  const maxBytes = bounded(options.maxBytes, MAX_INPUT_BYTES);
  const maxWorkers = bounded(options.maxWorkers, MAX_WORKERS);
  const deadline = Date.now() + bounded(options.timeoutMs, 6000);
  const warnings: string[] = [];
  const rows: SessionRow[] = [];
  const machine: MachineInfo = { machine: "newa", memFreeMb: null, diskFreeMb: null, available: true, warnings };
  const note = (text: string) => { if (warnings.length < 100) warnings.push(text); };
  const check = () => { if (options.signal?.aborted || Date.now() > deadline) throw new Error("collection deadline"); };
  // Pin directories before opening allowed children: a rename/symlink swap of
  // a worker path cannot redirect a later read. These are our own open fds,
  // never a symlink supplied by the work directory.
  const fdPath = (fd: number) => `${process.platform === "linux" ? "/proc/self/fd" : "/dev/fd"}/${fd}`;
  const openDir = (path: string) => openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let rootFd: number;
  try { rootFd = openDir(root); } catch { return { rows, machine: { ...machine, available: false, warnings: ["work root unavailable"] } }; }
  try {
    const workers = readdirSync(fdPath(rootFd), { withFileTypes: true }).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    if (workers.length > maxWorkers) note("worker limit reached; overview is partial");
    for (const worker of workers.slice(0, maxWorkers)) {
      check();
      let dirFd: number;
      try { dirFd = openDir(join(fdPath(rootFd), worker.name)); } catch { note(`${worker.name}: directory unavailable`); continue; }
      try {
        const names = readdirSync(fdPath(dirFd), { withFileTypes: true });
        const regular = new Set(names.filter(e => e.isFile()).map(e => e.name));
        if (!regular.has("status.json") && !regular.has("meta.json")) continue;
        const read = (name: string): { text: string; mtimeMs: number } | null => {
          check();
          if (!regular.has(name)) return null;
          let fd: number;
          try { fd = openSync(join(fdPath(dirFd), name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
          catch { note(`${worker.name}: ${name} unavailable`); return null; }
          try {
            const stat = fstatSync(fd);
            if (!stat.isFile() || stat.nlink !== 1) { note(`${worker.name}: ${name} is not a single regular file`); return null; }
            if (stat.size > maxBytes) { note(`${worker.name}: ${name} exceeds input limit`); return null; }
            const buffer = Buffer.alloc(Math.min(stat.size + 1, maxBytes + 1));
            let count = 0;
            while (count < buffer.length) {
              check();
              const n = readSync(fd, buffer, count, buffer.length - count, count);
              if (!n) break;
              count += n;
            }
            // A concurrent writer must not turn a partial JSON/report into evidence.
            const after = fstatSync(fd);
            if (count > maxBytes || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || count !== stat.size) {
              note(`${worker.name}: ${name} changed during read`); return null;
            }
            return { text: buffer.subarray(0, count).toString("utf8"), mtimeMs: stat.mtimeMs };
          } finally { closeSync(fd); }
        };
        const status = read("status.json"), meta = read("meta.json");
        const to = read("TO-S0.md"), report = read("REPORT-S0.md");
        const taskNames = [...regular].filter(n => /^TASK.*\.md$/i.test(n)).sort();
        let task: ReturnType<typeof read> = null;
        let taskFile: string | undefined;
        if (taskNames.length > 16) note(`${worker.name}: task file limit reached`);
        for (const name of taskNames.slice(0, 16)) {
          const candidate = read(name);
          if (!candidate) continue;
          const description = parseNewaDir({ name: worker.name, taskText: candidate.text, metaText: null,
            statusText: null, toS0Text: null, reportText: null, nowMs }).task;
          if (description) { task = candidate; taskFile = name; break; }
        }
        const times = [status, to, report, task].flatMap(f => f && f.mtimeMs <= nowMs ? [f.mtimeMs] : []);
        const row = parseNewaDir({ name: worker.name, metaText: meta?.text ?? null, statusText: status?.text ?? null,
          toS0Text: to?.text ?? null, reportText: report?.text ?? null, taskText: task?.text ?? null, taskFile, readmeText: read("README.md")?.text ?? null,
          activityMs: times.length ? Math.max(...times) : null, lastSayMs: null, nowMs });
        rows.push(addStatusEstimates({ ...row, liveness: "unknown", lastSayMs: null }, status?.text ?? null,
          status?.mtimeMs ?? null, to?.mtimeMs ?? null, nowMs, options));
      } catch { note(`${worker.name}: collection incomplete`); }
      finally { closeSync(dirFd); }
    }
  } catch { note("work root scan incomplete or timed out"); }
  finally { closeSync(rootFd); }
  return { rows, machine };
}
