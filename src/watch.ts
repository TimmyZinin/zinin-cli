import { stdin, stdout } from "node:process";
import { homedir } from "node:os";
import { join } from "node:path";
import { collectLive, renderLive } from "./live.ts";

type View = "ps" | "report" | "board";
const APPARAT = process.env.APPARAT_HOME || join(homedir(), "apparat");

function existingScript(relative: string, args: string[]): string {
  const script = join(APPARAT, relative);
  try {
    const child = Bun.spawnSync(["python3", script, ...args], { stdout: "pipe", stderr: "pipe" });
    if (child.exitCode !== 0) throw new Error(child.stderr.toString().trim() || `код ${child.exitCode}`);
    return child.stdout.toString().trimEnd();
  } catch (error) {
    return `источник ${relative} недоступен: ${(error as Error).message}`;
  }
}

async function refresh(): Promise<Record<View, string>> {
  let ps: string;
  try { ps = renderLive(await collectLive()).trimEnd(); }
  catch (error) { ps = `источник ps недоступен: ${(error as Error).message}`; }
  return {
    ps,
    report: existingScript("bin/report.py", ["--full"]),
    board: existingScript("state/board.py", ["tim"]),
  };
}

export async function watchMain(): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("zinin watch нужен интерактивный терминал");
  let view: View = "ps";
  let stopped = false;
  let stopWait: () => void = () => {};
  const stopPromise = new Promise<void>(resolve => { stopWait = resolve; });
  let frame: Record<View, string> = { ps: "Загрузка…", report: "Загрузка…", board: "Загрузка…" };
  const draw = () => {
    stdout.write("\x1b[2J\x1b[H" +
      `Zinin OS · 1 окна и потоки · 2 отчёт · 3 доска · q выход\n\n${frame[view]}\n`);
  };
  const stop = () => { stopped = true; stopWait(); };
  const onKey = (data: Buffer) => {
    const key = data.toString("utf8");
    if (key.includes("q") || key.includes("\x03")) stop();
    else if (key.includes("1")) { view = "ps"; draw(); }
    else if (key.includes("2")) { view = "report"; draw(); }
    else if (key.includes("3")) { view = "board"; draw(); }
  };
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("data", onKey);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  stdout.write("\x1b[?25l");
  try {
    while (!stopped) {
      const began = Date.now();
      frame = await refresh();
      if (stopped) break;
      draw();
      await Promise.race([Bun.sleep(Math.max(0, 10_000 - (Date.now() - began))), stopPromise]);
    }
  } finally {
    stdin.off("data", onKey);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write("\x1b[?25h\n");
  }
}
