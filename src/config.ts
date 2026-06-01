// ZININ — пользовательский конфиг в ~/.zinin/config.json
// Хранит подключённый API-ключ/endpoint юзера и флаг пройденного онбординга.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DIR = join(homedir(), ".zinin");
const FILE = join(DIR, "config.json");

export type Config = {
  apiKey?: string;    // свой ключ юзера (OpenRouter / OpenAI-совместимый)
  baseURL?: string;   // свой endpoint (если не OpenRouter)
  onboarded?: boolean;
};

export function loadConfig(): Config {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

export function saveConfig(patch: Config): void {
  try {
    mkdirSync(DIR, { recursive: true });
    const cur = loadConfig();
    writeFileSync(FILE, JSON.stringify({ ...cur, ...patch }, null, 2));
  } catch { /* read-only fs — не критично */ }
}
