/** Read-only local view of Terminal, Codex app-server and the Apparatus bus. */
import { createConnection, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { parseTerminalWindows, parseLaunchDirs, RECORD_SEP } from "./adapters/sessions/terminal-mac.ts";
import { version } from "./cli.ts";

const APPARAT = process.env.APPARAT_HOME || join(homedir(), "apparat");
const SOCKET = process.env.ZININ_CODEX_SOCKET || join(homedir(), ".codex/app-server-control/app-server-control.sock");
const SIX_HOURS = 6 * 60 * 60 * 1000;

export interface TerminalSession {
  id: string; title: string; cwd: string | null; harness: string | null;
  state: "Working" | "Ready" | "idle" | null;
  minutesSilent: number | null; tty: string | null;
}
export interface CodexThread {
  uuid: string; cwd: string | null; status: string; minutesSilent: number | null;
}
export interface BusSession {
  session: string; lastType: string; lastAt: string; lastTick: string | null; ref: string;
}
export interface LiveSnapshot {
  generatedAt: string; version: string; terminal: TerminalSession[];
  threads: CodexThread[]; bus: BusSession[]; unavailable: string[];
}

async function run(argv: string[], timeoutMs = 5000): Promise<string> {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill(); }, timeoutMs);
  try {
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    if (timedOut) throw new Error(`таймаут ${timeoutMs / 1000} с`);
    if (code !== 0) throw new Error(err.trim().split("\n").pop() || `код ${code}`);
    return out;
  } finally { clearTimeout(timer); }
}

// An inaccessible phantom Terminal window must not discard the other windows.
const TERMINAL_SCRIPT = `set tabChar to (ASCII character 9)
set recSep to (ASCII character 30)
tell application "Terminal"
  set out to ""
  repeat with w in windows
    try
      set winId to id of w as text
      try
        set titleText to name of w
        try
          set customText to custom title of selected tab of w
          if customText is missing value then set customText to ""
        on error
          set customText to ""
        end try
        set screenText to contents of selected tab of w
        set busyText to (busy of selected tab of w) as text
        try
          set ttyText to tty of selected tab of w
        on error
          set ttyText to ""
        end try
        set out to out & winId & tabChar & titleText & tabChar & customText & tabChar & screenText & tabChar & busyText & tabChar & ttyText & recSep
      on error e
        set out to out & "@error:" & winId & ":" & e & recSep
      end try
    end try
  end repeat
  return out
end tell`;

function launchCwdFromTitle(title: string): string | null {
  const match = /\bcodex\s+-C\s+(\S+)/.exec(title);
  if (!match) return null;
  return match[1].startsWith("~/") ? join(homedir(), match[1].slice(2)) : match[1];
}

export function displayTitle(name: string, custom: string | null): string {
  const fallback = name.split(" — caffeinate")[0].replace(/^[^—]+ — /, "");
  return (custom?.trim() || fallback.trim()).replace(/\s*\|\s*(?:Working|Ready|Waiting|idle)\b.*$/i, "").trim();
}

export function observedState(harness: string | null, title: string, spinning: boolean, busy: boolean): TerminalSession["state"] {
  // Claude's ◐ title, Terminal busy flag and a visible spinner can persist
  // without a second sample proving movement.
  if (harness === "claude") return null;
  if (spinning) return "Working";
  if (harness === "codex" || harness === "kimi") {
    if (/\|\s*(?:Ready|Waiting)\b/i.test(title)) return "Ready";
    if (/\|\s*Working\b/i.test(title)) return "Working";
    if (/\|\s*idle\b/i.test(title)) return "idle";
    return null;
  }
  return busy ? null : "idle";
}

async function terminalSessions(): Promise<{ rows: TerminalSession[]; errors: string[] }> {
  const raw = await run(["osascript", "-e", TERMINAL_SCRIPT], 7000);
  const errors = raw.split(RECORD_SEP).filter(record => record.startsWith("@error:"))
    .map(record => `Terminal окно ${record.slice(7)}`);
  const customById = new Map<string, string>();
  const normalized = raw.split(RECORD_SEP).map(record => {
    const fields = record.split("\t");
    if (fields.length < 6) return record;
    customById.set(`mac-win-${fields[0].trim()}`, fields[2]);
    return [fields[0], fields[1], ...fields.slice(3)].join("\t");
  }).join(RECORD_SEP);
  const metadata = new Map<string, { tty: string | null; cwd: string | null; spinning: boolean; busy: boolean }>();
  const parsed = parseTerminalWindows(normalized, (id, data) => metadata.set(id, data));
  const titleById = new Map<string, string>();
  for (const record of normalized.split(RECORD_SEP)) {
    const [id, title] = record.split("\t", 3);
    if (id && title) titleById.set(`mac-win-${id.trim()}`, title);
  }
  let dirs = new Map<string, string>();
  try {
    const psText = await run(["ps", "-Ao", "pid,tty,args"], 5000);
    const pids = [...psText.matchAll(/^\s*(\d+)\s+ttys\d+\s+(?:\S*\/)?(?:codex|claude|kimi)(?:\s|$)/gm)].map(m => m[1]);
    if (pids.length) {
      const lsofText = await run(["lsof", "-a", "-d", "cwd", "-Fn", ...pids.flatMap(pid => ["-p", pid])], 5000);
      dirs = parseLaunchDirs(psText, lsofText);
    }
  } catch (error) { errors.push(`Terminal cwd: ${(error as Error).message}`); }
  const rows = parsed.map(row => {
    const title = titleById.get(row.id) ?? "";
    const meta = metadata.get(row.id);
    const cwd = (meta?.tty ? dirs.get(meta.tty) : null) ?? launchCwdFromTitle(title) ??
      (meta?.cwd ? "/" + meta.cwd.replace(/^\//, "") : null);
    const custom = customById.get(row.id) ?? null;
    const label = displayTitle(title, custom);
    const state = observedState(row.engine, custom || title, !!meta?.spinning, !!meta?.busy);
    return { id: row.id.replace(/^mac-win-/, ""), title: label,
      cwd, harness: row.engine, state, minutesSilent: null, tty: meta?.tty ?? null };
  });
  return { rows, errors };
}

class WebSocketReader {
  private buffer = Buffer.alloc(0);
  private error: Error | null = null;
  private wake: (() => void) | null = null;
  constructor(private socket: Socket) {
    socket.on("data", chunk => { this.buffer = Buffer.concat([this.buffer, chunk]); this.wake?.(); this.wake = null; });
    socket.on("error", error => { this.error = error; this.wake?.(); this.wake = null; });
    socket.on("close", () => { this.error ??= new Error("соединение закрыто"); this.wake?.(); this.wake = null; });
  }
  private async changed(): Promise<void> {
    if (this.error) throw this.error;
    await new Promise<void>(resolve => { this.wake = resolve; });
    if (this.error) throw this.error;
  }
  async until(delimiter: string): Promise<string> {
    let index: number;
    while ((index = this.buffer.indexOf(delimiter)) < 0) await this.changed();
    const value = this.buffer.subarray(0, index + delimiter.length).toString();
    this.buffer = this.buffer.subarray(index + delimiter.length);
    return value;
  }
  private async take(size: number): Promise<Buffer> {
    while (this.buffer.length < size) await this.changed();
    const value = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return value;
  }
  async frame(): Promise<Record<string, any> | null> {
    const header = await this.take(2);
    const opcode = header[0] & 15;
    let length = header[1] & 127;
    if (length === 126) length = (await this.take(2)).readUInt16BE(0);
    else if (length === 127) length = Number((await this.take(8)).readBigUInt64BE(0));
    if (!Number.isSafeInteger(length) || length > 8_000_000) throw new Error("слишком большой ответ app-server");
    const mask = header[1] & 128 ? await this.take(4) : null;
    const payload = await this.take(length);
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    if (opcode === 8) throw new Error("app-server закрыл WebSocket");
    return opcode === 1 ? JSON.parse(payload.toString()) : null;
  }
}

function sendFrame(socket: Socket, message: object): void {
  const payload = Buffer.from(JSON.stringify(message));
  const mask = randomBytes(4);
  const header = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length]) :
    payload.length < 65536 ? Buffer.from([0x81, 0xfe, payload.length >> 8, payload.length & 255]) :
    (() => { const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0xff; h.writeBigUInt64BE(BigInt(payload.length), 2); return h; })();
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  socket.write(Buffer.concat([header, mask, payload]));
}

async function codexThreads(nowMs: number): Promise<CodexThread[]> {
  const socket = createConnection(SOCKET);
  socket.setTimeout(7000, () => socket.destroy(new Error("таймаут 7 с")));
  const reader = new WebSocketReader(socket);
  try {
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    const key = randomBytes(16).toString("base64");
    socket.write(`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    const response = await reader.until("\r\n\r\n");
    if (!response.startsWith("HTTP/1.1 101 ")) throw new Error("WebSocket отклонён");
    const rpc = async (id: number, method: string, params: object): Promise<any> => {
      sendFrame(socket, { id, method, params });
      while (true) {
        const packet = await reader.frame();
        if (!packet || packet.id !== id) continue;
        if (packet.error) throw new Error(packet.error.message || "ошибка app-server");
        return packet.result;
      }
    };
    await rpc(1, "initialize", { clientInfo: { name: "zinin_os", version: "1.0" }, capabilities: { experimentalApi: true } });
    sendFrame(socket, { method: "initialized", params: {} });
    const result = await rpc(2, "thread/list", { limit: 100 });
    if (!Array.isArray(result?.data)) throw new Error("неверный ответ thread/list");
    return result.data.filter((row: any) => row?.status?.type === "active").map((row: any) => ({
      uuid: String(row.id), cwd: typeof row.cwd === "string" ? row.cwd : null,
      status: row.status.type, minutesSilent: typeof row.updatedAt === "number" ?
        Math.max(0, Math.floor((nowMs - row.updatedAt * 1000) / 60000)) : null,
    }));
  } finally { socket.destroy(); }
}

function busSessions(nowMs: number): BusSession[] {
  const dir = join(APPARAT, "bus/events");
  const files = readdirSync(dir).filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort().slice(-2);
  const events: any[] = [];
  for (const file of files) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let event: any;
      try { event = JSON.parse(line); } catch { continue; } // incomplete append
      const time = Date.parse(event.ts);
      if (Number.isFinite(time) && time >= nowMs - SIX_HOURS && time <= nowMs && typeof event.from === "string") events.push(event);
    }
  }
  events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const grouped = new Map<string, BusSession>();
  for (const event of events) {
    const prior = grouped.get(event.from);
    grouped.set(event.from, { session: event.from, lastType: String(event.type), lastAt: event.ts,
      lastTick: event.type === "tick" ? event.ts : prior?.lastTick ?? null, ref: String(event.ref ?? "") });
  }
  return [...grouped.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export async function collectLive(): Promise<LiveSnapshot> {
  const nowMs = Date.now();
  const snapshot: LiveSnapshot = { generatedAt: new Date(nowMs).toISOString(), version: version(),
    terminal: [], threads: [], bus: [], unavailable: [] };
  const [terminal, threads] = await Promise.allSettled([terminalSessions(), codexThreads(nowMs)]);
  if (terminal.status === "fulfilled") {
    snapshot.terminal = terminal.value.rows;
    snapshot.unavailable.push(...terminal.value.errors);
  }
  else snapshot.unavailable.push(`Terminal: ${(terminal.reason as Error).message}`);
  if (threads.status === "fulfilled") snapshot.threads = threads.value;
  else snapshot.unavailable.push(`Codex app-server: ${(threads.reason as Error).message}`);
  try { snapshot.bus = busSessions(nowMs); }
  catch (error) { snapshot.unavailable.push(`шина: ${(error as Error).message}`); }
  // An exact, unique cwd match is the only safe link between an app-server
  // thread and a Terminal window. Other window silence remains unknown.
  for (const row of snapshot.terminal) {
    if (row.harness !== "codex" || !row.cwd) continue;
    const matches = snapshot.threads.filter(thread => thread.cwd === row.cwd);
    const windows = snapshot.terminal.filter(window => window.harness === "codex" && window.cwd === row.cwd);
    if (matches.length === 1 && windows.length === 1) row.minutesSilent = matches[0].minutesSilent;
  }
  return snapshot;
}

function table(headers: string[], rows: (string | number | null)[][]): string {
  const values = rows.map(row => row.map(value => value === null || value === undefined ? "—" : String(value).replace(/[\r\n|]/g, " ")));
  const widths = headers.map((header, i) => Math.min(48, Math.max(header.length, ...values.map(row => row[i]?.length ?? 0))));
  const fit = (value: string, i: number) => value.length > widths[i] ? value.slice(0, widths[i] - 1) + "…" : value.padEnd(widths[i]);
  return [headers.map(fit).join("  "), widths.map(width => "─".repeat(width)).join("  "),
    ...values.map(row => row.map(fit).join("  "))].join("\n");
}

export function renderLive(snapshot: LiveSnapshot): string {
  const lines = [`Zinin OS ${snapshot.version} · ${snapshot.generatedAt}`, "", "Окна Terminal",
    table(["id", "заголовок", "cwd", "харнесс", "состояние", "тишина, мин"],
      snapshot.terminal.map(row => [row.id, row.title, row.cwd, row.harness, row.state, row.minutesSilent])),
    "", "Потоки Codex",
    table(["UUID", "cwd", "status", "тишина, мин"],
      snapshot.threads.map(row => [row.uuid, row.cwd, row.status, row.minutesSilent])),
    "", "Шина · последние 6 ч",
    table(["сессия", "тип", "последний тик", "последнее событие", "ref"],
      snapshot.bus.map(row => [row.session, row.lastType, row.lastTick, row.lastAt, row.ref]))];
  for (const error of snapshot.unavailable) lines.push(`источник ${error.startsWith("Terminal:") ? "Terminal" : error.startsWith("Codex") ? "Codex app-server" : "шина"} недоступен: ${error.split(": ").slice(1).join(": ")}`);
  return lines.join("\n") + "\n";
}
