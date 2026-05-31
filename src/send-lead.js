#!/usr/bin/env node
// Отправка лида Тиму в Telegram + локальный append в leads/leads.jsonl (фолбэк).
// Использование:
//   node src/send-lead.js --name "Аня" --biz "кофейня" --task "автопостинг" --contact "@anya"
// Конфиг TG (опционально, для прод-доставки):
//   ZININ_TG_BOT_TOKEN  — токен бота
//   ZININ_TG_CHAT_ID    — chat_id Тима (HITL по памяти: 64242118)
// Если токена нет — лид просто пишется в файл, скрипт не падает.

const fs = require('fs');
const path = require('path');

function arg(name, def = '') {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const type = arg('type', 'lead'); // 'lead' | 'call'
const lead = {
  ts: new Date().toISOString(),
  type,
  name: arg('name', '—'),
  biz: arg('biz', '—'),
  task: arg('task', '—'),
  contact: arg('contact', '—'),
  os: arg('os', '—'),
  topics: arg('topics', '—'),
  source: 'zinin-cli',
};

// 1) Локальный лог (всегда)
const home = process.env.ZININ_HOME || path.resolve(__dirname, '..');
const leadsDir = path.join(home, 'leads');
fs.mkdirSync(leadsDir, { recursive: true });
fs.appendFileSync(path.join(leadsDir, 'leads.jsonl'), JSON.stringify(lead) + '\n');

// 2) Telegram (если настроен токен)
const token = process.env.ZININ_TG_BOT_TOKEN;
const chatId = process.env.ZININ_TG_CHAT_ID || '64242118';

const text = type === 'call'
  ? `🔔 ЗОВ НА РАЗГОВОР · ZININ CLI\n` +
    `Кто-то жмёт /call — хочет поговорить и помощь с настройкой.\n` +
    `Контакт: ${lead.contact}\n` +
    `ОС: ${lead.os}\n` +
    `Чем занимался: ${lead.topics}\n` +
    `→ напиши ему или пришли слот: https://calendly.com/timzinin/30min`
  : `🔥 Новый лид из ZININ CLI\n` +
    `Имя: ${lead.name}\n` +
    `Бизнес: ${lead.biz}\n` +
    `Задача: ${lead.task}\n` +
    `Контакт: ${lead.contact}\n` +
    `Calendly: https://calendly.com/timzinin/30min`;

if (!token) {
  console.log('[zinin] лид сохранён локально (leads/leads.jsonl). TG-токен не задан — пропускаю отправку.');
  process.exit(0);
}

const url = `https://api.telegram.org/bot${token}/sendMessage`;
fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, text }),
})
  .then((r) => r.json())
  .then((j) => {
    if (j.ok) console.log('[zinin] лид отправлен Тиму в Telegram ✅');
    else console.log('[zinin] TG вернул ошибку, лид сохранён локально:', j.description || j);
  })
  .catch((e) => console.log('[zinin] сеть недоступна, лид сохранён локально:', e.message));
