/** Close a chosen Terminal window after stopping only its Codex and caffeinate processes. */
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";

const APPARAT = process.env.APPARAT_HOME || join(homedir(), "apparat");
const ENGINES = new Set(["codex", "claude", "caffeinate"]);

function run(argv: string[]): string {
  const child = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr).trim() || `${argv[0]}: код ${child.exitCode}`);
  return new TextDecoder().decode(child.stdout).trim();
}

export interface TtyProcess { pid: number; tty: string; name: string; }

export function isTerminalClosed(exists: string, tabs: string): boolean {
  // Terminal can retain an AppleScript window id after its final tab and tty vanish.
  return exists === "false" || (exists === "true" && tabs === "0");
}

export function parseTtyProcesses(text: string, tty: string): TtyProcess[] {
  return text.split("\n").flatMap(line => {
    const match = /^\s*(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!match || match[2] !== tty) return [];
    const name = basename(match[3]);
    return ENGINES.has(name) ? [{ pid: Number(match[1]), tty, name }] : [];
  });
}

function currentProcess(pid: number, tty: string, name: string): boolean {
  try {
    const row = run(["ps", "-p", String(pid), "-o", "tty=,comm="]);
    const match = /^(\S+)\s+(.+)$/.exec(row);
    return !!match && match[1] === tty && basename(match[2]) === name;
  } catch { return false; }
}

function clearOwners(window: number): void {
  const stateDir = join(APPARAT, "state");
  for (const name of readdirSync(stateDir).filter(name => name.endsWith(".json"))) {
    const path = join(stateDir, name);
    let data: any;
    try { data = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
    if (Number(data.owner?.window) !== window) continue;
    data.owner.last_thread = data.owner.thread || "";
    data.owner.thread = "";
    data.owner.window = "";
    data.owner.tty = "";
    data.owner.closed_at = new Date().toISOString();
    data.updated_at = data.owner.closed_at;
    data.updated_by = "ZININ";
    const temp = `${path}.zinin-close-${process.pid}`;
    writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  }
}

export async function closeWindow(window: number): Promise<{ window: number; tty: string; stopped: number[]; ghost: boolean }> {
  if (!Number.isSafeInteger(window) || window < 1) throw new Error("нужен числовой id окна Terminal");
  const ttyPath = run(["osascript", "-e", `tell application "Terminal" to get tty of selected tab of window id ${window}`]);
  if (!ttyPath.startsWith("/dev/ttys")) throw new Error(`неизвестный tty окна ${window}: ${ttyPath}`);
  const tty = basename(ttyPath);
  const processes = parseTtyProcesses(run(["ps", "-t", tty, "-o", "pid=,tty=,comm="]), tty);
  const stopped: number[] = [];
  for (const item of processes) {
    if (!currentProcess(item.pid, tty, item.name)) continue;
    process.kill(item.pid, "SIGTERM");
    stopped.push(item.pid);
  }
  await Bun.sleep(400);
  for (const item of processes) {
    if (currentProcess(item.pid, tty, item.name)) process.kill(item.pid, "SIGKILL");
  }
  run(["osascript", "-e", `tell application "Terminal" to close window id ${window} saving no`]);
  const exists = run(["osascript", "-e", `tell application "Terminal" to get exists window id ${window}`]);
  const tabs = exists === "true" ? run(["osascript", "-e", `tell application "Terminal" to get count of tabs of window id ${window}`]) : "0";
  if (!isTerminalClosed(exists, tabs)) throw new Error(`Terminal сообщил close, но у окна ${window} осталось ${tabs} вкладок`);
  clearOwners(window);
  return { window, tty: ttyPath, stopped, ghost: exists === "true" };
}
