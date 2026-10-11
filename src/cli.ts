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
  process.stderr.write(`zinin: неизвестная команда ${command}. См. zinin --help\n`);
  return 2;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
