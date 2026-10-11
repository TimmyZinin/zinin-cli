/** Tim's compact briefing from today's plan, board and optional calendar. */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

const APPARAT = process.env.APPARAT_HOME || join(homedir(), "apparat");

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tbilisi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function short(value: unknown, max = 100): string {
  const clean = String(value ?? "—").replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim() || "—";
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

export function planTable(markdown: string, section: number): string[][] {
  const lines = markdown.split("\n");
  const start = lines.findIndex(line => line.startsWith(`## ${section}. `));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end)
    .filter(line => line.startsWith("|") && !/^\|[ -|]+\|$/.test(line))
    .map(line => line.slice(1, -1).split("|").map(cell => cell.trim()));
}

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return "данных нет\n";
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map(row => (row[i] || "").length)));
  return all.map((row, index) => row.map((cell, i) => (cell || "").padEnd(widths[i])).join("  ").trimEnd() +
    (index === 0 ? "\n" + widths.map(width => "─".repeat(width)).join("  ") : "")).join("\n") + "\n";
}

export function renderTim(apparat = APPARAT, date = today()): string {
  const report = join(apparat, "bin/report.py");
  try {
    const help = Bun.spawnSync(["python3", report, "--help"], { stdout: "pipe", stderr: "pipe" });
    if (help.exitCode === 0 && new TextDecoder().decode(help.stdout).includes("--tim")) {
      const child = Bun.spawnSync(["python3", report, "--tim"], { stdout: "pipe", stderr: "pipe" });
      if (child.exitCode === 0) return new TextDecoder().decode(child.stdout);
      throw new Error(new TextDecoder().decode(child.stderr).trim() || "report.py --tim завершился с ошибкой");
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

  const stateDir = process.env.ZININ_STATE_DIR || join(apparat, "state");
  const states: any[] = [];
  for (const file of readdirSync(stateDir).filter(file => /^[a-z0-9_-]+\.json$/.test(file))) {
    try {
      const row = JSON.parse(readFileSync(join(stateDir, file), "utf8"));
      if (typeof row.direction === "string") states.push(row);
    } catch { /* A bad board row is not a fact. */ }
  }
  states.sort((a, b) => a.direction.localeCompare(b.direction));
  const planPath = join(apparat, `docs/DAY-PLAN-${date}.md`);
  let plan = "";
  try { plan = readFileSync(planPath, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const asOf = plan.match(/^Срез: ([^.]+)\./m)?.[1] || "время среза не указано";
  let out = `Zinin OS · брифинг Тима · ${date}\nДоска: ${stateDir}; план: ${plan ? `${planPath} (срез ${asOf})` : "источник отсутствует"}\n\n`;
  out += "Направления сейчас\n" + table(["направление", "держатель / окно", "этап", "открыто"], states.map(row => [
    short(row.direction, 16), short(`${row.owner?.session || "—"} / ${row.owner?.window || "—"}`, 24), short(row.stage, 82),
    String(Array.isArray(row.commitments) ? row.commitments.filter((item: any) => item.status === "open" || item.status === "blocked").length : 0),
  ])) + "\n";
  const debts = planTable(plan, 2).slice(1);
  out += "Кому что должны (план дня; статусы требуют живой сверки)\n" + table(["кому", "что", "состояние"], debts.map(row => [short(row[0], 24), short(row[1], 88), short(row[4], 98)])) + "\n";
  const tasks = planTable(plan, 4).slice(1);
  out += "План дня (срез документа)\n" + table(["приоритет / задача", "кто", "когда"], tasks.map(row => [short(row[0], 82), short(row[2], 58), short(row[3], 65)])) + "\n";
  const hand = states.flatMap(row => Array.isArray(row.hand_of_tim) ? row.hand_of_tim.map((item: any) => [short(row.direction, 16), short(item.what, 86), short(item.why, 90)]) : []);
  out += "Рука Тима (доска)\n" + table(["направление", "решение", "почему"], hand) + "\n";
  const eventPath = join(apparat, `docs/calendar/EVENTS-${date}.json`);
  try {
    const raw = JSON.parse(readFileSync(eventPath, "utf8"));
    const events = Array.isArray(raw) ? raw : Array.isArray(raw.events) ? raw.events : [];
    out += "Календарь\n" + table(["время", "событие", "место"], events.map((event: any) => [
      short(event.start || event.when || event.time, 30), short(event.title || event.summary || event.name, 90),
      short(event.location || event.where, 45),
    ]));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    out += `Календарь: источник отсутствует (${eventPath})\n`;
  }
  return out;
}
