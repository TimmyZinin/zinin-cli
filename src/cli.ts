#!/usr/bin/env bun
/** Local Zinin OS entrypoint. The legacy assistant remains at `zinin repl`. */
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
    const { psMain } = await import("./ps.ts");
    await psMain(rest);
    return 0;
  }
  process.stderr.write(`zinin: неизвестная команда ${command}. См. zinin --help\n`);
  return 2;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
