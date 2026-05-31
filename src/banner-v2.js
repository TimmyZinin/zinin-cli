const figlet = require('figlet');
const gradient = require('gradient-string');

// Фирменная палитра сайта timzinin.com
const RED = '#e8262d', REDDARK = '#b21218', GOLD = '#fed002', CYAN = '#4cb8d3';
const redGrad = gradient([RED, REDDARK]);

// truecolor helpers
const c = (hex, s) => {
  const n = hex.replace('#',''); const r=parseInt(n.slice(0,2),16),g=parseInt(n.slice(2,4),16),b=parseInt(n.slice(4,6),16);
  return `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
};
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const MASCOT = c(RED, '[◉‿◉]');           // путешествующий знак бренда
const TIER = process.env.ZININ_TIER || 'FREE';

function splash() {
  const logo = figlet.textSync('ZININ', { font: 'ANSI Shadow' });
  console.log('');
  console.log(redGrad.multiline(logo));
  console.log('  ' + MASCOT + '  ' + c(GOLD,'AI-инженер в твоём терминале') + dim('  ·  zinin.ai'));
  console.log('  ' + dim('─'.repeat(58)));
  console.log('  движок: ' + c(CYAN,'мульти-LLM (free)') + dim('  ·  ') + c(GOLD,'/setup') + dim(' — поставлю Claude Code & Codex'));
  console.log('  ' + c(GOLD,'/call') + dim(' — 30 мин с Тимом') + dim('   ·   tier: ') + c(RED, TIER));
  console.log('');
  console.log('  ' + MASCOT + ' ' + c(RED,'›') + ' ' + dim('разбери мой бизнес / помоги поставить claude code / …'));
  console.log('');
}
if (require.main === module) splash();
module.exports = { splash, MASCOT, RED, REDDARK, GOLD, CYAN };
