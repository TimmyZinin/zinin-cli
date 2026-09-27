// ZININ REPL — собственный интерфейс (НЕ обёртка claude). Bun + мульти-LLM.
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
// @ts-ignore — CJS-модуль баннера; грузится лениво, чтобы `zinin ps` не зависел от него
let banner: any = null;
const loadBanner = async () => {
  if (!banner) banner = (await import("./banner-v2.js").catch(() => null))?.default ?? { MASCOT: "◆", splash: () => {} };
  return banner;
};
import { streamChatFallback, defaultModel, MODELS, loadKey, type Msg } from "./llm.ts";
import { track, anonId, VERSION } from "./telemetry.ts";
import { loadConfig, saveConfig } from "./config.ts";

// Relay для сигнала /call → Тиму в Telegram (токен живёт на сервере, не в клиенте).
const RELAY_URL = process.env.ZININ_RELAY_URL || "https://scope.timzinin.com/harness/call";
// MOTD — Тим вещает сообщение в харнесы (показывается при старте).
const MOTD_URL = process.env.ZININ_MOTD_URL || "https://scope.timzinin.com/harness/motd";

async function showMotd(): Promise<void> {
  try {
    const res = await fetch(MOTD_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const data: any = await res.json();
    const msg = (data?.msg || "").trim();
    if (!msg) return;
    const tone = data.level === "warn" ? "#e8262d" : data.level === "ok" ? "#4cb8d3" : "#fed002";
    console.log("  " + `\x1b[38;2;${parseInt(tone.slice(1,3),16)};${parseInt(tone.slice(3,5),16)};${parseInt(tone.slice(5,7),16)}m` + "📣 " + msg + "\x1b[0m\n");
  } catch { /* офлайн — без motd */ }
}

const RED = "#e8262d", GOLD = "#fed002", CYAN = "#4cb8d3";
const col = (hex: string, s: string) => {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
};
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
let MASCOT = "◆";
const HOME = join(import.meta.dir, "..");

function persona(): string {
  const p = join(HOME, "zinin-persona.md");
  return existsSync(p) ? readFileSync(p, "utf8") : "Ты — ZININ, AI-инженер Тима Зинина в терминале. Отвечай по-русски, бодро, конкретно.";
}

let model = defaultModel();
const history: Msg[] = [{ role: "system", content: persona() }];

// --- /setup — bootstrap: ставит Claude Code / Codex ---
async function setup(rl: any) {
  console.log("\n  " + MASCOT + " " + col(GOLD, "Проверяю, что у тебя стоит…\n"));
  const tools = [
    { name: "Claude Code", bin: "claude", install: 'curl -fsSL https://claude.ai/install.sh | bash' },
    { name: "Codex",       bin: "codex",  install: 'npm install -g @openai/codex' },
  ];
  for (const t of tools) {
    const have = Bun.which(t.bin);
    if (have) { console.log("  " + col(CYAN, "✓") + ` ${t.name} — уже стоит (${have})`); continue; }
    console.log("  " + col(RED, "✗") + ` ${t.name} — нет.`);
    const ans = (await rl.question("    Поставить сейчас? " + dim("(y/n) "))).trim().toLowerCase();
    if (ans === "y" || ans === "да") {
      console.log("    " + dim(`$ ${t.install}`));
      const proc = Bun.spawn(["bash", "-c", t.install], { stdout: "inherit", stderr: "inherit" });
      await proc.exited;
      console.log("    " + (Bun.which(t.bin) ? col(CYAN, "✓ готово") : col(RED, "не удалось — поставим вместе на /call")));
    } else {
      console.log("    " + dim(`пропустил. команда: ${t.install}`));
    }
  }
  console.log("");
}

// --- /call — зов Тима на разговор (не опрос) ---
async function call(rl: any) {
  console.log("\n  " + MASCOT + " " + col(GOLD, "Зову Тима.") + " Он лично поможет с настройкой и разберёт твой кейс.");
  console.log("  " + dim("Это не бот — на той стороне живой инженер.\n"));
  const contact = (await rl.question("  Куда тебе ответить? " + dim("(Telegram/почта — или Enter, дам ссылку на слот) "))).trim();
  // контекст для Тима: чем юзер занимался в сессии (последние запросы, обрезанные)
  const topics = history.filter((m) => m.role === "user").slice(-3).map((m) => m.content.slice(0, 60)).join(" | ") || "—";
  track("cli_call", { contact: contact ? "given" : "none" });

  // сигнал летит на relay → Тиму в Telegram (клиент НЕ несёт секретов)
  let delivered = false;
  try {
    const res = await fetch(RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact, os: platform(), topics, version: VERSION, anon_id: anonId().slice(0, 8) }),
      signal: AbortSignal.timeout(8000),
    });
    delivered = res.ok;
  } catch { /* офлайн — покажем прямой контакт ниже */ }

  if (delivered) {
    console.log("\n  " + col(GOLD, "Готово — Тим получил сигнал.") + (contact ? " Он напишет тебе." : ""));
  } else {
    console.log("\n  " + col(RED, "Не достучался до сервера.") + " Напиши Тиму напрямую: " + col(CYAN, "https://t.me/timzinin"));
  }
  console.log("  " + dim("Выбрать время сразу: ") + col(CYAN, "https://calendly.com/timzinin/30min") + "\n");
}

// --- /key — подключить свой LLM (OpenRouter / OpenAI-совместимый endpoint) ---
async function connectKey(rl: any) {
  console.log("\n  " + MASCOT + " " + col(GOLD, "Подключи свой LLM."));
  console.log("  " + dim("OpenRouter — самый простой: один ключ → все модели. Получить: ") + col(CYAN, "https://openrouter.ai/keys"));
  const key = (await rl.question("  Ключ API " + dim("(или Enter — остаёшься на бесплатном движке): "))).trim();
  if (!key) { console.log("  " + dim("Ок, остаёшься на бесплатном движке.\n")); return; }
  const url = (await rl.question("  Свой endpoint URL? " + dim("(Enter = OpenRouter): "))).trim();
  saveConfig({ apiKey: key, ...(url ? { baseURL: url } : {}) });
  track("cli_key_connected", { custom_endpoint: !!url });
  console.log("  " + col(CYAN, "✓") + " Подключено. Теперь работаешь на своём ключе" + (url ? " и endpoint." : ".") + "\n");
}

// --- онбординг новичка при первом запуске: живой разговор + цель = /setup ---
async function onboard() {
  const intro: Msg = {
    role: "user",
    content:
      "[СИСТЕМА: первый запуск. Перед тобой новичок, который вообще ничего не знает про AI, терминалы и код. " +
      "Поздоровайся тепло и очень просто, без жаргона. В 3-4 коротких предложениях объясни, что ты — AI-инженер прямо в терминале и чем реально поможешь его бизнесу. " +
      "Затем скажи САМОЕ ГЛАВНОЕ: первым делом стоит набрать команду /setup — ты сам поставишь ему два мощных инструмента, Claude Code и Codex, и проведёшь за руку. " +
      "В конце спроси, чем он занимается. Дружелюбно, как живой человек, короткими абзацами.]",
  };
  history.push(intro);
  stdout.write("\n  " + col(GOLD, "zinin") + dim(" › "));
  try {
    const { text } = await streamChatFallback(history, model, (t) => stdout.write(t));
    history.push({ role: "assistant", content: text });
  } catch {
    stdout.write(dim("(движок недоступен — набери /setup, чтобы поставить Claude Code и Codex)"));
  }
  stdout.write("\n\n");
  saveConfig({ onboarded: true });
}

function help() {
  console.log(`
  ${MASCOT} ${col(GOLD, "команды:")}
    ${col(CYAN, "/setup")}  ${col(RED, "★ ГЛАВНОЕ")} — поставлю тебе Claude Code и Codex (проведу за руку)
    ${col(CYAN, "/key")}    — подключить свой LLM (свой ключ / endpoint)
    ${col(CYAN, "/call")}   — позвать Тима на разговор (живой инженер, помощь с настройкой)
    ${col(CYAN, "/model")}  — сменить LLM (бесплатные / платные)
    ${col(CYAN, "/help")}   — это меню
    ${col(CYAN, "/exit")}   — выход
  ${dim("или просто пиши запрос — я отвечу.")}
`);
}

async function pickModel(rl: any) {
  console.log("\n  " + col(GOLD, "Бесплатные:"));
  MODELS.free.forEach((m, i) => console.log(`    ${col(CYAN, String(i + 1))}. ${m.label}`));
  console.log("  " + col(GOLD, "Платные:"));
  MODELS.paid.forEach((m, i) => console.log(`    ${col(CYAN, String(MODELS.free.length + i + 1))}. ${m.label}`));
  const all = [...MODELS.free, ...MODELS.paid];
  const ans = (await rl.question("  Номер: ")).trim();
  const idx = parseInt(ans) - 1;
  if (all[idx]) { model = all[idx].id; console.log("  " + col(CYAN, "✓") + ` теперь: ${all[idx].label}\n`); }
  else console.log("  " + dim("без изменений\n"));
}

async function psMainDispatch(): Promise<void> {
  const { psMain } = await import("./ps.ts");
  await psMain(process.argv.slice(3));
}
async function main() {
  if (process.argv[2] === "ps") { await psMainDispatch(); return; }
  MASCOT = (await loadBanner()).MASCOT;
  banner.splash();
  const hasKey = !!loadKey();
  track("cli_start", { key: hasKey, mode: hasKey ? "direct" : "proxy" });
  // без своего ключа харнес работает через прокси Тима (бесплатные модели) — это норма, не ошибка
  await showMotd();
  // первый запуск новичка → живой онбординг, ведущий к /setup
  if (!loadConfig().onboarded) { await onboard(); }
  const rl = createInterface({ input: stdin, output: stdout });
  while (true) {
    let input: string;
    try {
      input = (await rl.question("  " + MASCOT + " " + col(RED, "› "))).trim();
    } catch { break; } // stdin закрылся (EOF / Ctrl-D) — выходим без traceback
    if (!input) continue;
    const cmd = input.toLowerCase();
    if (cmd === "/exit" || cmd === "/quit") break;
    if (cmd === "/help") { help(); continue; }
    if (cmd === "/setup") { track("cli_setup"); await setup(rl); continue; }
    if (cmd === "/call") { await call(rl); continue; }
    if (cmd === "/model") { track("cli_model"); await pickModel(rl); continue; }
    if (cmd === "/key") { await connectKey(rl); continue; }

    history.push({ role: "user", content: input });
    track("cli_query", { model });           // факт запроса — БЕЗ текста промпта
    stdout.write("\n  " + col(GOLD, "zinin") + dim(" › "));
    try {
      const { text, model: used } = await streamChatFallback(history, model, (t) => stdout.write(t));
      history.push({ role: "assistant", content: text });
      if (used !== model) stdout.write("\n  " + dim(`(переключился на ${used} — основная модель была занята)`));
      stdout.write("\n\n");
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg === "NO_KEY") stdout.write("\n  " + col(RED, "нет ключа OpenRouter.") + "\n\n");
      else if (msg === "ALL_MODELS_FAILED") stdout.write("\n  " + col(RED, "все бесплатные модели заняты — попробуй /model и выбери платную.") + "\n\n");
      else stdout.write("\n  " + col(RED, "сбой LLM: ") + dim(msg) + "\n\n");
    }
  }
  rl.close();
  console.log("\n  " + MASCOT + " " + dim("до встречи. /call когда созреешь.\n"));
}

main();
