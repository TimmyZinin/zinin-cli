/** Resolve a named owner, then queue one word to its Codex thread. */
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { closeSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPARAT = process.env.APPARAT_HOME || join(homedir(), "apparat");

function firstJsonLine(path: string): any {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(65536);
    const count = readSync(fd, buffer, 0, buffer.length, 0);
    const end = buffer.subarray(0, count).indexOf(10);
    if (end < 0) return null;
    return JSON.parse(buffer.subarray(0, end).toString());
  } catch { return null; }
  finally { closeSync(fd); }
}

export function resolveWordTarget(target: string, stateDir = process.env.ZININ_STATE_DIR || join(APPARAT, "state"),
  sessionsDir = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions"), day = new Date()): string {
  if (UUID.test(target)) return target.toLowerCase();
  const matches = new Set<string>();
  try {
    for (const name of readdirSync(stateDir).filter(name => name.endsWith(".json"))) {
      let data: any;
      try { data = JSON.parse(readFileSync(join(stateDir, name), "utf8")); } catch { continue; }
      const owner = data.owner;
      if (!owner || typeof owner.thread !== "string" || !UUID.test(owner.thread)) continue;
      if ([name.slice(0, -5), data.direction, owner.session].some(value =>
        typeof value === "string" && value.toLowerCase() === target.toLowerCase())) matches.add(owner.thread.toLowerCase());
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (matches.size === 1) return [...matches][0];
  if (matches.size > 1) throw new Error(`имя ${target} соответствует нескольким владельцам; укажите UUID`);

  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tbilisi", year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
  const [year, month, date] = localDate.split("-");
  const dir = join(sessionsDir, year, month, date);
  try {
    for (const name of readdirSync(dir).filter(name => name.endsWith(".jsonl"))) {
      const meta = firstJsonLine(join(dir, name));
      const payload = meta?.type === "session_meta" ? meta.payload : null;
      if (!payload || typeof payload.cwd !== "string") continue;
      if (payload.cwd !== target && basename(payload.cwd) !== target) continue;
      const id = payload.id || payload.session_id;
      if (typeof id === "string" && UUID.test(id)) matches.add(id.toLowerCase());
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (matches.size === 1) return [...matches][0];
  if (matches.size > 1) throw new Error(`cwd ${target} найден у ${matches.size} потоков сегодня; укажите UUID`);
  throw new Error(`не найден owner или поток сегодня для ${target}`);
}

export function queueWord(target: string, message: string): string {
  if (!message.trim()) throw new Error("пустое слово");
  const thread = resolveWordTarget(target);
  const child = Bun.spawnSync(["codex", "queue", "--thread", thread, "--message", message],
    { stdout: "pipe", stderr: "pipe" });
  if (child.exitCode !== 0) {
    const detail = new TextDecoder().decode(child.stderr).trim();
    throw new Error(`codex queue: ${detail || `код ${child.exitCode}`}; результат неопределён, повторно не отправляйте без проверки`);
  }
  return thread;
}
