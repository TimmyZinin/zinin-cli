/** Read only an allowlist at the first level of each worker directory. */
import { openSync, closeSync, fstatSync, readSync, readdirSync, lstatSync, realpathSync, constants } from "node:fs";
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
  pathMode?: "descriptor" | "portable"; // injectable to exercise the macOS path on Linux
}
const bounded = (n: number | undefined, fallback: number) => n !== undefined && Number.isSafeInteger(n) && n > 0 ? Math.min(n, fallback) : fallback;

export function collectNewaSnapshot(options: NewaCollectorOptions = {}): SourceSnapshot {
  const nowMs = options.nowMs ?? Date.now();
  const requestedRoot = resolve(options.root ?? "/home/agents/work");
  // Resolve OS-owned ancestors such as /var -> /private/var, never an
  // explicitly supplied symlink root or worker/file entry.
  let root = requestedRoot;
  const maxBytes = bounded(options.maxBytes, MAX_INPUT_BYTES);
  const maxWorkers = bounded(options.maxWorkers, MAX_WORKERS);
  const deadline = Date.now() + bounded(options.timeoutMs, 6000);
  const warnings: string[] = [];
  const rows: SessionRow[] = [];
  const machine: MachineInfo = { machine: "newa", memFreeMb: null, diskFreeMb: null, available: true, warnings };
  const note = (text: string) => { if (warnings.length < 100) warnings.push(text); };
  const check = () => { if (options.signal?.aborted || Date.now() > deadline) throw new Error("collection deadline"); };
  const descriptorPaths = (options.pathMode ?? (process.platform === "linux" ? "descriptor" : "portable")) === "descriptor";
  const dirPath = (fd: number, path: string) => descriptorPaths ? `/proc/self/fd/${fd}` : path;
  const openDir = (path: string) => openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const same = (a: ReturnType<typeof fstatSync>, b: ReturnType<typeof lstatSync>) => a.dev === b.dev && a.ino === b.ino;
  const verifyDir = (fd: number, path: string) => {
    if (descriptorPaths) return;
    const held = fstatSync(fd), entry = lstatSync(path);
    if (!entry.isDirectory() || entry.isSymbolicLink() || !same(held, entry)) throw new Error("directory changed");
  };
  let rootFd: number;
  try {
    if (lstatSync(requestedRoot).isSymbolicLink()) throw new Error("symlink root");
    root = realpathSync(requestedRoot);
    rootFd = openDir(root);
  } catch { return { rows, machine: { ...machine, available: false, warnings: ["work root unavailable"] } }; }
  try {
    verifyDir(rootFd, root);
    const workers = readdirSync(dirPath(rootFd, root), { withFileTypes: true }).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    verifyDir(rootFd, root);
    if (workers.length > maxWorkers) note("worker limit reached; overview is partial");
    for (const worker of workers.slice(0, maxWorkers)) {
      check();
      const workerPath = join(root, worker.name);
      let dirFd: number;
      try { verifyDir(rootFd, root); dirFd = openDir(join(dirPath(rootFd, root), worker.name)); } catch { note(`${worker.name}: directory unavailable`); continue; }
      try {
        const verifyWorker = () => { verifyDir(rootFd, root); verifyDir(dirFd, workerPath); };
        verifyWorker();
        const names = readdirSync(dirPath(dirFd, workerPath), { withFileTypes: true });
        verifyWorker();
        const regular = new Set(names.filter(e => e.isFile()).map(e => e.name));
        if (!regular.has("status.json") && !regular.has("meta.json")) continue;
        const read = (name: string): { text: string; mtimeMs: number } | null => {
          check();
          if (!regular.has(name)) return null;
          verifyWorker();
          const filePath = join(dirPath(dirFd, workerPath), name);
          let fd: number;
          try { fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
          catch { note(`${worker.name}: ${name} unavailable`); return null; }
          try {
            const stat = fstatSync(fd);
            const verifyFile = () => {
              verifyWorker();
              const entry = lstatSync(filePath);
              if (!entry.isFile() || entry.nlink !== 1 || !same(stat, entry)) throw new Error("file changed");
            };
            if (!stat.isFile() || stat.nlink !== 1) { note(`${worker.name}: ${name} is not a single regular file`); return null; }
            verifyFile();
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
            verifyFile();
            if (count > maxBytes || after.nlink !== 1 || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || count !== stat.size) {
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
            statusText: null, toS0Text: null, reportText: null, nowMs }).taskSource;
          if (description !== "directory-name") { task = candidate; taskFile = name; break; }
        }
        const times = [status, to, report, task].flatMap(f => f && f.mtimeMs <= nowMs ? [f.mtimeMs] : []);
        const row = parseNewaDir({ name: worker.name, metaText: meta?.text ?? null, statusText: status?.text ?? null,
          toS0Text: to?.text ?? null, reportText: report?.text ?? null, taskText: task?.text ?? null, taskFile, readmeText: read("README.md")?.text ?? null,
          activityMs: times.length ? Math.max(...times) : null, lastSayMs: null, nowMs });
        verifyWorker();
        rows.push(addStatusEstimates({ ...row, liveness: "unknown", lastSayMs: null }, status?.text ?? null,
          status?.mtimeMs ?? null, to?.mtimeMs ?? null, nowMs, options));
      } catch { note(`${worker.name}: collection incomplete`); }
      finally { closeSync(dirFd); }
    }
  } catch { note("work root scan incomplete or timed out"); }
  finally { closeSync(rootFd); }
  return { rows, machine };
}
