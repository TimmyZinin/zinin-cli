# ZININ CLI

**AI-инженер в твоём терминале.** Пилотируемый AI, не автопилот — управляй и понимай.

Авторский AI-харнес Тима Зинина: собственный REPL, мульти-LLM, ведёт за руку через установку Claude Code и Codex, учит, как устроен AI, пока ты работаешь.

## Установка — одна команда

**macOS / Linux:**
```sh
curl -fsSL https://zinin.ai/install | sh
```

**Windows (PowerShell):**
```powershell
irm https://zinin.ai/install.ps1 | iex
```

Без Node, без Homebrew — ставится один бинарь в PATH. Потом просто:
```sh
zinin
```

## Команды

| Команда | Что делает |
|---------|-----------|
| _(просто пиши)_ | разбор бизнеса, контент, автоматизации — обычным языком |
| `/setup` | проверит и поставит Claude Code / Codex |
| `/call` | позвать Тима на разговор (живой инженер, помощь с настройкой) |
| `/model` | сменить LLM (бесплатные / платные) |
| `/help` | меню |
| `/exit` | выход |

## Движок

Мульти-LLM с бесплатными моделями по умолчанию — ничего настраивать не нужно. Свой ключ OpenRouter (опционально, для прямого доступа):
```sh
export OPENROUTER_API_KEY=...
```

## Приватность

Телеметрия собирает только метаданные событий (никогда — текст твоих запросов). Отключить:
```sh
export ZININ_NO_TELEMETRY=1
```

---

[zinin.ai](https://zinin.ai/harness/) · Telegram [@timzinin](https://t.me/timzinin) · 30 мин: [calendly.com/timzinin/30min](https://calendly.com/timzinin/30min)
