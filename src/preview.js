const figlet = require('figlet');
const gradient = require('gradient-string');

// фирменная палитра сайта Тима
const RED = '#e8262d', REDDARK = '#b21218', GOLD = '#fed002', CYAN = '#4cb8d3';
const redGrad = gradient([RED, REDDARK]);
const popGrad = gradient([GOLD, RED, REDDARK]);

function logo(font){ return figlet.textSync('ZININ', { font }); }

console.log('\n══════════ ВАРИАНТ A · ANSI Shadow (жирный, крупный) ══════════\n');
console.log(redGrad.multiline(logo('ANSI Shadow')));

console.log('\n══════════ ВАРИАНТ B · Bloody (кровавый, тематичный) ══════════\n');
try { console.log(redGrad.multiline(logo('Bloody'))); } catch(e){ console.log('(шрифт Bloody недоступен)'); }

console.log('\n══════════ ВАРИАНТ C · Colossal (огромный, чистый) ══════════\n');
try { console.log(redGrad.multiline(logo('Colossal'))); } catch(e){ console.log('(нет)'); }

console.log('\n══════════ ВАРИАНТ D · Univers (мега-крупный) ══════════\n');
try { console.log(popGrad.multiline(logo('Univers'))); } catch(e){ console.log('(нет)'); }

// МАСКОТЫ — "путешествующий" знак бренда
const r = (s) => `\x1b[38;2;232;38;45m${s}\x1b[0m`;
const g = (s) => `\x1b[38;2;254;208;2m${s}\x1b[0m`;
console.log('\n\n═══════════════ МАСКОТЫ (путешествующий знак) ═══════════════\n');
console.log('  1) очки-ботаник :  ' + r('[◉‿◉]') + '   ' + r('◖◉_◉◗') + '   ' + r('⌐◉-◉'));
console.log('  2) Z-монограмма :  ' + r('⟦Z⟧') + '     ' + r('◤Z◢') + '     ' + r('▛Z▜'));
console.log('  3) искра-движок :  ' + r('✦') + 'Z' + r('✦') + '    ' + g('✳') + ' zinin   ' + r('◢◤') + 'Z' + r('◥◣'));
console.log('  4) робот-инженер:  ' + r('[¬‿¬]') + '   ' + r('(•‿•)⌐') + '  ' + r('╾◉╼'));
console.log('');
