// ZININ — CLI-телеметрия в Umami (stats.timzinin.com). Best-effort, никогда не блокирует.
// Собираем ТОЛЬКО метаданные событий — НИКОГДА содержимое промптов/ответов.
// Opt-out: ZININ_NO_TELEMETRY=1
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, release } from "node:os";
import { randomUUID } from "node:crypto";

const UMAMI = "https://stats.timzinin.com";
const WEBSITE = "3c0744af-dfdb-4476-8a4a-b0fc21ec1af0"; // zinin.ai website (тот же, что на сайте)
const VERSION = "0.2.1";

function enabled(): boolean {
  return !process.env.ZININ_NO_TELEMETRY;
}

// Стабильный анонимный id машины (без PII): UUID, созданный один раз в ~/.zinin/id.
function anonId(): string {
  try {
    const dir = join(homedir(), ".zinin");
    const f = join(dir, "id");
    if (existsSync(f)) return readFileSync(f, "utf8").trim();
    mkdirSync(dir, { recursive: true });
    const id = randomUUID();
    writeFileSync(f, id);
    return id;
  } catch {
    return "anon";
  }
}

// Umami парсит os/device из User-Agent → отдаём осмысленный UA.
function ua(): string {
  const os = platform() === "darwin" ? "Macintosh; macOS" : platform() === "win32" ? "Windows NT" : "X11; Linux";
  return `ZININ-CLI/${VERSION} (${os} ${release()})`;
}

/**
 * Трекнуть событие. name — имя события (cli_start, cli_command, cli_model, cli_call…).
 * data — произвольные метаданные (никогда — контент пользователя).
 */
export async function track(name: string, data: Record<string, any> = {}): Promise<void> {
  if (!enabled()) return;
  try {
    await fetch(`${UMAMI}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": ua() },
      body: JSON.stringify({
        type: "event",
        payload: {
          website: WEBSITE,
          hostname: "cli.zinin.ai",
          url: `/cli/${name}`,
          name,
          data: { ...data, v: VERSION, aid: anonId().slice(0, 8) },
        },
      }),
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    /* офлайн / таймаут — молча, телеметрия никогда не мешает работе */
  }
}

export { anonId, VERSION };
