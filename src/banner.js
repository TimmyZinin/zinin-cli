#!/usr/bin/env node
// ZININ ASCII-сплэш: figlet + gradient (палитра из бренд-ресёрча: терракота→золото→изумруд).
// Зависимости: figlet, gradient-string. Установка: npm i figlet gradient-string
// Деградирует мягко: если пакетов нет — печатает простой текст, не падает.

const TERRACOTTA = '#e0533d';
const GOLD = '#c79a3a';
const EMERALD = '#2f6f5e';
const INDIGO = '#3b4a8c';

const tier = (process.env.ZININ_TIER || 'free').toUpperCase();

function plain() {
  console.log('\n  Z I N I N');
  console.log('  AI-инженер в твоём терминале\n');
}

try {
  const figlet = require('figlet');
  const gradient = require('gradient-string');

  const art = figlet.textSync('ZININ', { font: 'ANSI Shadow' });
  const brand = gradient([TERRACOTTA, GOLD, EMERALD]);
  console.log('\n' + brand.multiline(art));

  const tagline = gradient([EMERALD, INDIGO]);
  console.log(tagline('  AI-инженер, который заменяет SMM/Ops/CMO воркфлоу. Прямо в терминале.'));
  console.log(`  \x1b[2mtier: ${tier}  ·  /zinin call — записаться на 30 мин  ·  выход: /exit\x1b[0m\n`);
} catch (e) {
  // figlet/gradient не установлены — мягкий фолбэк
  plain();
}
