// ZININ — мульти-LLM движок поверх OpenRouter (OpenAI-совместимый).
// Бесплатные модели по умолчанию, переключение на платные через /model.
// Ключ: process.env.OPENROUTER_API_KEY ИЛИ ~/.secrets/hermes-llm.env (локальный режим).
// PROD: бинарь НЕ содержит ключа — ходит на прокси zinin.ai/api (фаза 2).

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
// Прокси на Contabo: если у юзера нет своего ключа — ходим через него (серверный ключ, :free).
const PROXY_URL = process.env.ZININ_LLM_PROXY || "https://scope.timzinin.com/harness/llm";

// Каталог моделей: бесплатные (старт без копейки) + платные (переключение).
// Free-модели от РАЗНЫХ провайдеров → если один rate-limited, фоллбэк берёт следующего.
// Проверено против OpenRouter /models. Порядок = приоритет фоллбэка.
export const MODELS = {
  free: [
    { id: "openai/gpt-oss-120b:free",               label: "GPT-OSS 120B (free)" },
    { id: "z-ai/glm-4.5-air:free",                  label: "GLM 4.5 Air (free)" },
    { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)" },
    { id: "moonshotai/kimi-k2.6:free",              label: "Kimi K2.6 (free)" },
    { id: "google/gemma-4-31b-it:free",             label: "Gemma 4 31B (free)" },
    { id: "qwen/qwen3-coder:free",                  label: "Qwen3 Coder (free, для кода)" },
  ],
  paid: [
    { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5 (paid)" },
    { id: "openai/gpt-4o",               label: "GPT-4o (paid)" },
  ],
};

export function defaultModel(): string {
  return MODELS.free[0].id;
}

// --- загрузка ключа: env → config юзера → ~/.secrets (dev) → null(прокси) ---
export function loadKey(): string | null {
  if (process.env.ZININ_FORCE_PROXY) return null;     // форс прокси-режима (тест / приватность)
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const cfg = loadConfig();
  if (cfg.apiKey) return cfg.apiKey;                  // ключ, подключённый юзером через /key
  for (const f of ["hermes-llm.env", "superjob.env"]) {
    const p = join(homedir(), ".secrets", f);
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

// База для прямого режима: свой endpoint юзера или OpenRouter.
export function directURL(): string {
  return loadConfig().baseURL || OR_URL;
}

export type Msg = { role: "system" | "user" | "assistant"; content: string };

// Стриминговый чат. onToken вызывается на каждый кусок текста.
export async function streamChat(
  messages: Msg[],
  model: string,
  onToken: (t: string) => void,
): Promise<string> {
  const key = loadKey();
  // Есть свой ключ → прямой OpenRouter. Нет → прокси Contabo (серверный ключ, только :free).
  const direct = !!key;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "HTTP-Referer": "https://zinin.ai",
    "X-Title": "ZININ CLI",
  };
  if (direct) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(direct ? directURL() : PROXY_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP_${res.status}: ${txt.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const data = s.slice(5).trim();
      if (data === "[DONE]") return full;
      try {
        const j = JSON.parse(data);
        // через прокси ошибка модели приходит в теле с HTTP 200 → пробрасываем как retryable
        if (j.error && full === "") throw new Error(`HTTP_${j.error.code || 429}: ${j.error.message || "stream error"}`);
        const tok = j.choices?.[0]?.delta?.content;
        if (tok) { full += tok; onToken(tok); }
      } catch (e: any) {
        if (e?.message?.startsWith?.("HTTP_")) throw e;  // пробросить для фоллбэка
        /* иначе keep-alive / partial JSON — игнор */
      }
    }
  }
  return full;
}

// Перебирает модели при rate-limit/5xx (мульти-LLM фоллбэк). Возвращает {text, model}.
export async function streamChatFallback(
  messages: Msg[],
  preferred: string,
  onToken: (t: string) => void,
): Promise<{ text: string; model: string }> {
  const order = [preferred, ...MODELS.free.map((m) => m.id), ...MODELS.paid.map((m) => m.id)]
    .filter((v, i, a) => a.indexOf(v) === i);
  let lastErr: any;
  for (const m of order) {
    try {
      const text = await streamChat(messages, m, onToken);
      if (!text.trim()) { lastErr = new Error("EMPTY"); continue; } // пустой ответ → следующая модель
      return { text, model: m };
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg === "NO_KEY") throw e;            // ключа нет — фоллбэк не поможет
      if (/HTTP_(404|429|50\d)/.test(msg)) { lastErr = e; continue; } // занято/нет модели → следующая
      throw e;                                   // прочие ошибки — наверх
    }
  }
  throw lastErr || new Error("ALL_MODELS_FAILED");
}
