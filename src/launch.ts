/** Start one visible Terminal session and bind its first bus announcement to a board owner. */
import { randomBytes, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync, renameSync, chmodSync } from "node:fs";

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const APPARAT = process.env.APPARAT_HOME || join(homedir(), "apparat");
const LAUNCH_DIR = join(APPARAT, "runs/zinin-launch");
const STATE_DIR = join(APPARAT, "state");

export interface LaunchOptions { task: string; cwd?: string; engine?: "codex" | "claude"; }
export interface LaunchResult { window: number; thread: string | null; ref: string; statePath: string; commandPath: string; }

export function shellQuote(value: string): string { return `'${value.replaceAll("'", `'\\''`)}'`; }
export function taskRef(path: string): string {
  const ref = basename(path, ".md").replace(/^task-/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  if (!ref || ref.length > 60) throw new Error("имя task.md не даёт короткий ref");
  return ref;
}

function statePath(ref: string): string { return join(STATE_DIR, `${ref}.json`); }

function updateOwner(ref: string, owner: Record<string, unknown>): string {
  const path = statePath(ref);
  let data: Record<string, any> = {};
  try { data = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  data.direction ??= ref;
  data.owner = { ...(data.owner || {}), ...owner };
  data.updated_at = new Date().toISOString();
  data.updated_by = "ZININ";
  const temp = `${path}.zinin-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temp, path);
  return path;
}

function appleScript(script: string, args: string[]): string {
  const child = Bun.spawnSync(["osascript", "-e", script, ...args], { stdout: "pipe", stderr: "pipe" });
  if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr).trim() || `osascript: ${child.exitCode}`);
  return new TextDecoder().decode(child.stdout).trim();
}

const OPEN_SCRIPT = `on run argv
  set commandPath to item 1 of argv
  tell application "Terminal"
    launch
    set createdTab to do script (quoted form of commandPath)
    set createdTTY to tty of createdTab
    if createdTTY is "" then error "terminal_tty_unknown"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is createdTTY then
          return ((id of w as text) & tab & createdTTY)
        end if
      end repeat
    end repeat
    error "terminal_window_unknown"
  end tell
end run`;

const TRUST_SCRIPT = `on run argv
  set windowID to (item 1 of argv) as integer
  tell application "Terminal"
    set t to selected tab of window id windowID
    set screenText to contents of t
    if (screenText contains "trust" or screenText contains "Trust" or screenText contains "довер") and (screenText contains "1." or screenText contains "1 ") then
      do script "1" in t
      return "trust:1"
    end if
    return "no-trust-prompt"
  end tell
end run`;

export function parseLaunchAnnouncement(line: string, ref: string, token: string, afterMs: number): string | null {
  let event: any;
  try { event = JSON.parse(line); } catch { return null; }
  if (event.from !== "ZININ" || event.type !== "start" || event.ref !== `launch/${ref}` ||
      typeof event.text !== "string" || !event.text.includes(`launch=${token}`) || Date.parse(event.ts) < afterMs) return null;
  return event.text.match(UUID)?.[0] ?? null;
}

async function awaitAnnouncement(ref: string, token: string, afterMs: number): Promise<string | null> {
  const timeout = Number(process.env.ZININ_LAUNCH_TIMEOUT_MS || 90000);
  const until = Date.now() + (Number.isFinite(timeout) && timeout > 0 ? timeout : 90000);
  while (Date.now() < until) {
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tbilisi" });
    const path = join(APPARAT, "bus/events", `${date}.jsonl`);
    try {
      const lines = readFileSync(path, "utf8").split("\n");
      for (const line of lines) {
        const thread = parseLaunchAnnouncement(line, ref, token, afterMs);
        if (thread) return thread;
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await Bun.sleep(1000);
  }
  return null;
}

export async function launch(options: LaunchOptions): Promise<LaunchResult> {
  const task = realpathSync(options.task);
  if (!task.endsWith(".md") || !statSync(task).isFile()) throw new Error("нужен существующий task.md");
  const cwd = realpathSync(options.cwd || dirname(task));
  if (!statSync(cwd).isDirectory()) throw new Error("--cwd должен быть каталогом");
  const engine = options.engine || "codex";
  if (engine !== "codex" && engine !== "claude") throw new Error("--engine: codex или claude");
  const ref = taskRef(task);
  const path = statePath(ref);
  try {
    const old = JSON.parse(readFileSync(path, "utf8"));
    if (old.owner?.window) throw new Error(`ref ${ref} уже закреплён за окном ${old.owner.window}`);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const token = randomBytes(8).toString("hex");
  const launchId = `${ref}-${token}`;
  const dir = join(LAUNCH_DIR, launchId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const commandPath = join(dir, `${ref}.command`);
  const promptPath = join(dir, `${ref}.prompt.txt`);
  const preface = engine === "codex"
    ? `Первым действием запусти команду: ${join(APPARAT, "bin/say.sh")} ZININ start launch/${ref} "thread \${CODEX_THREAD_ID:?}; launch=${token}". Это первая строка для связи сессии с окном; затем выполняй задание. Если UUID недоступен, сообщи question в ту же шину и не выдумывай его.`
    : `Первым действием запусти команду: ${join(APPARAT, "bin/say.sh")} ZININ start launch/${ref} "thread \${ZININ_THREAD_ID:?}; launch=${token}". Это первая строка для связи сессии с окном; затем выполняй задание.`;
  writeFileSync(promptPath, `${preface}\n\n${readFileSync(task, "utf8")}`, { mode: 0o600, flag: "wx" });
  const claudeId = engine === "claude" ? randomUUID() : null;
  const command = engine === "codex"
    ? `exec caffeinate -i codex -C ${shellQuote(cwd)} --add-dir ${shellQuote(APPARAT)} --dangerously-bypass-approvals-and-sandbox "$(cat ${shellQuote(promptPath)})"`
    : `export ZININ_THREAD_ID=${shellQuote(claudeId!)}\nexec caffeinate -i claude --session-id ${shellQuote(claudeId!)} --dangerously-skip-permissions "$(cat ${shellQuote(promptPath)})"`;
  writeFileSync(commandPath, `#!/bin/zsh\ncd ${shellQuote(cwd)} || exit 1\n${command}\n`, { mode: 0o700, flag: "wx" });
  chmodSync(commandPath, 0o700);
  if (!isAbsolute(commandPath)) throw new Error("внутренняя ошибка: .command не абсолютный");
  const started = Date.now();
  const opened = appleScript(OPEN_SCRIPT, [commandPath]).split("\t");
  const window = Number(opened[0]);
  if (!Number.isInteger(window) || window < 1 || !/^\/dev\/tty/.test(opened[1] || "")) throw new Error("Terminal открыл окно без подтверждённого id/tty");
  updateOwner(ref, { session: ref.toUpperCase(), thread: "", window, tty: opened[1], engine, cwd, command: commandPath });
  for (let i = 0; i < 10; i++) {
    const trust = appleScript(TRUST_SCRIPT, [String(window)]);
    if (trust === "trust:1") break;
    await Bun.sleep(500);
  }
  const thread = await awaitAnnouncement(ref, token, started);
  if (thread) updateOwner(ref, { thread });
  return { window, thread, ref, statePath: path, commandPath };
}
