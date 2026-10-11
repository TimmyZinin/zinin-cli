#!/usr/bin/env bun
/** Local Zinin OS entrypoint. The legacy assistant remains at `zinin repl`. */
import { homedir } from "node:os";
import { join } from "node:path";
import { codeVersion } from "./ps.ts";

export function version(): string {
  return codeVersion().replace(/^git-/, "");
}

export function help(): string {
  return `Zinin OS ${version()}

Команды:
  zinin ps [--json]       Живые окна, потоки и события
  zinin report [--tick]   Отчёт аппарата
  zinin board [направление]  Доска аппарата
  zinin say TYPE REF TEXT  Сообщить S0 через шину
  zinin watch             Живой экран (выход: q)
  zinin launch task.md [--cwd DIR] [--engine codex|claude]  Новое окно
  zinin repl              Старый AI-харнес
  zinin --version         Версия текущего checkout
`;
}

export async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(help());
    return 0;
  }
  if (command === "--version" || command === "-V" || command === "version") {
    process.stdout.write(version() + "\n");
    return 0;
  }
  if (command === "repl") {
    if (rest.length) {
      process.stderr.write("zinin repl: лишние аргументы\n");
      return 2;
    }
    await import("./repl.ts");
    return 0;
  }
  if (command === "launch") {
    const task = rest[0];
    let cwd: string | undefined;
    let engine: "codex" | "claude" | undefined;
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === "--cwd" && rest[i + 1]) cwd = rest[++i];
      else if (rest[i] === "--engine" && ["codex", "claude"].includes(rest[i + 1])) engine = rest[++i] as typeof engine;
      else { process.stderr.write("usage: zinin launch task.md [--cwd DIR] [--engine codex|claude]\n"); return 2; }
    }
    if (!task || task.startsWith("-")) { process.stderr.write("usage: zinin launch task.md [--cwd DIR] [--engine codex|claude]\n"); return 2; }
    try {
      const result = await (await import("./launch.ts")).launch({ task, cwd, engine });
      process.stdout.write(`окно ${result.window}, thread ${result.thread || "ожидается"}\n`);
      if (!result.thread) { process.stderr.write(`первая строка с UUID не пришла; владелец окна записан в ${result.statePath}. Повторно окно не открывайте.\n`); return 1; }
      return 0;
    } catch (error) { process.stderr.write(`zinin launch: ${(error as Error).message}\n`); return 1; }
  }
  if (command === "ps") {
    if (rest.some(arg => arg !== "--json")) {
      process.stderr.write("zinin ps: допустим только --json\n");
      return 2;
    }
    const { collectLive, renderLive } = await import("./live.ts");
    const snapshot = await collectLive();
    process.stdout.write(rest.includes("--json") ? JSON.stringify(snapshot) + "\n" : renderLive(snapshot));
    return 0;
  }
  if (command === "report") {
    if (rest.length > 1 || (rest.length === 1 && rest[0] !== "--tick")) {
      process.stderr.write("zinin report: допустим только --tick\n");
      return 2;
    }
    const script = join(process.env.APPARAT_HOME || join(homedir(), "apparat"), "bin/report.py");
    try {
      const child = Bun.spawnSync(["python3", script, rest[0] || "--full"], { stdout: "pipe", stderr: "pipe" });
      process.stdout.write(child.stdout);
      process.stderr.write(child.stderr);
      return child.exitCode ?? 1;
    } catch (error) {
      process.stderr.write(`источник report.py недоступен: ${(error as Error).message}\n`);
      return 1;
    }
  }
  if (command === "board") {
    if (rest.length > 1 || rest[0]?.startsWith("-")) {
      process.stderr.write("zinin board: укажите одно направление или запустите без аргументов\n");
      return 2;
    }
    const script = join(process.env.APPARAT_HOME || join(homedir(), "apparat"), "state/board.py");
    const args = rest.length ? ["show", rest[0]] : ["tim"];
    try {
      const child = Bun.spawnSync(["python3", script, ...args], { stdout: "pipe", stderr: "pipe" });
      process.stdout.write(child.stdout);
      process.stderr.write(child.stderr);
      return child.exitCode ?? 1;
    } catch (error) {
      process.stderr.write(`источник board.py недоступен: ${(error as Error).message}\n`);
      return 1;
    }
  }
  if (command === "say") {
    let sender = process.env.ZININ_SESSION || process.env.APPARAT_SESSION || "";
    const positional: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--from") sender = rest[++i] || "";
      else positional.push(rest[i]);
    }
    const [type, ref, message] = positional;
    if (!/^[A-Z][A-Z0-9_-]*$/.test(sender) || !["start", "tick", "question", "ready", "done"].includes(type) ||
        !ref || !message || positional.length !== 3) {
      process.stderr.write('usage: ZININ_SESSION=ZOS zinin say TYPE REF "текст" (или --from ZOS)\n');
      return 2;
    }
    const script = join(process.env.APPARAT_HOME || join(homedir(), "apparat"), "bin/say.sh");
    try {
      const child = Bun.spawnSync([script, sender, type, ref, message], { stdout: "pipe", stderr: "pipe" });
      process.stdout.write(child.stdout);
      process.stderr.write(child.stderr);
      return child.exitCode ?? 1;
    } catch (error) {
      process.stderr.write(`источник say.sh недоступен: ${(error as Error).message}\n`);
      return 1;
    }
  }
  if (command === "watch") {
    if (rest.length) {
      process.stderr.write("zinin watch: лишние аргументы\n");
      return 2;
    }
    try { await (await import("./watch.ts")).watchMain(); return 0; }
    catch (error) { process.stderr.write(`${(error as Error).message}\n`); return 1; }
  }
  process.stderr.write(`zinin: неизвестная команда ${command}. См. zinin --help\n`);
  return 2;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
