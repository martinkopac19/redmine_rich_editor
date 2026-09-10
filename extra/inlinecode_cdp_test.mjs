/* Inline code (`</>`) je v editore VIDNO — hlaseny pripad z 10. 9. 2026.
 *
 * Funkcne to fungovalo aj predtym: `<code>` sa aplikoval a markdown mal
 * backticky. Nebolo to ale vidno — jadro dava pozadie len VYRENDEROVANEMU
 * `code` (`div.wiki *:not(pre)>code`), do editora to nesiaha, takze jediny
 * rozdiel bol monospace font a klik posobil, ze tlacidlo nic nerobi.
 * Test preto kontroluje OBOJE: ze sa marka aplikuje aj ze je vizualne odlisena.
 *
 * POZOR: v DOM je bublinovych list viac (kazdy editor ma svoju) — klikat sa
 * musi v tej VIDITELNEJ, inak sa prikaz nema na co aplikovat.
 *
 *   node extra/inlinecode_cdp_test.mjs <base> <login> <heslo> <issueId> [port]
 */
const [BASE, LOGIN, PASS, ISSUE, PORT = '9381'] = process.argv.slice(2);
if (!ISSUE) {
  console.error('pouzitie: node inlinecode_cdp_test.mjs <base> <login> <heslo> <issueId> [port]');
  process.exit(2);
}

const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => { ws.onopen = r; });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'JS err');
  return r?.result?.value;
};
async function waitFor(x, label, ms = 25000) {
  const until = Date.now() + ms;
  for (;;) { try { if (await ev(x)) return true; } catch (e) {} if (Date.now() > until) throw new Error('timeout: ' + label); await sleep(250); }
}
async function nav(url) {
  await send('Page.navigate', { url });
  await waitFor('document.readyState === "complete"', 'nacitanie ' + url);
  await sleep(1400);
}
const key = async (k, code, mod) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers: mod, text: k.length === 1 && !mod ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mod });
  await sleep(50);
};
const typeText = async s => { for (const c of s) await key(c, 'Key' + (/[a-z]/i.test(c) ? c.toUpperCase() : '')); };

const OK = []; const BAD = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  (ok ? OK : BAD).push(label);
  console.log('  ' + label.padEnd(58) + (ok ? 'OK' : '!! ZLE (' + JSON.stringify(got) + ', cakalo sa ' + JSON.stringify(want) + ')'));
}
const J = s => JSON.stringify(s);
const PM = `document.querySelector('.re-comment-box .ProseMirror')`;

/* Klikne na tlacidlo v tej bublinovej liste, ktora je naozaj VIDITELNA.
 * V DOM ich je viac (kazdy editor ma svoju) a klik do cudzej nema co
 * aplikovat — presne na tom stroskotal prvy pokus o diagnostiku. */
const clickAct = async (act) => ev(`(function(){
  var bars = Array.prototype.filter.call(document.querySelectorAll('.re-bubble'), function(b){
    var r = b.getBoundingClientRect();
    return b.offsetParent !== null && r.width > 0 && r.height > 0;
  });
  if (!bars.length) return 'ziadna viditelna lista';
  var b = bars[0].querySelector('[data-re-act=' + ${J(JSON.stringify(act))} + ']');
  if (!b) return 'tlacidlo nenajdene';
  b.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
  b.click();
  return 'ok';
})()`);

/* Oznaci slovo v editore skutocnym dvojklikom — bublinova lista sa inak
 * nezobrazi a ProseMirror by prikaz nemal kam aplikovat. */
async function selectWord(word) {
  const pos = await ev(`(function(){
    var pm = ${PM};
    var t = null, w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    while ((t = w.nextNode())) { if (t.textContent.indexOf(${J(word)}) >= 0) break; }
    if (!t) return null;
    var i = t.textContent.indexOf(${J(word)});
    var r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + ${word.length});
    var rect = r.getBoundingClientRect();
    return JSON.stringify({x: Math.round(rect.left + rect.width/2), y: Math.round(rect.top + rect.height/2)});
  })()`);
  if (!pos) throw new Error('slovo ' + word + ' nie je v editore');
  const p = JSON.parse(pos);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 2 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 2 });
  await sleep(800);
}

console.log('='.repeat(84));
console.log('  rich_editor — inline code sa aplikuje A JE VIDNO');
console.log('='.repeat(84));

await send('Page.enable');
await nav(BASE + '/login?nosso=1');
if (await ev(`!!document.getElementById('username')`)) {
  await ev(`(function(){document.getElementById('username').value=${J(LOGIN)};document.getElementById('password').value=${J(PASS)};document.getElementById('login-form').querySelector('input[type=submit]').click();return 1;})()`);
  await waitFor(`!!document.querySelector('#loggedas')`, 'prihlasenie');
}

console.log('\n[1] Aplikovanie marky');
await nav(BASE + '/issues/' + ISSUE);
/* Koncept z predchadzajuceho behu sa do editora obnovi JESKOR, nez ho zmazeme
 * (od v0.14.0), takze nestaci vymazat ulozisko — treba vyprazdnit aj editor.
 * Bez toho by test pracoval s textom z minula a hladal slovo na zlom miesta. */
await ev(`(function(){
  sessionStorage.removeItem('re.draft.notes.${ISSUE}');
  var t = document.getElementById('issue_notes');
  t.value = '';
  t.dispatchEvent(new Event('re:resync'));
  return 1;
})()`);
await sleep(600);
check('editor je na zaciatku prazdny', await ev(`(${PM}.textContent||'').trim()`), '');
await ev(`(function(){var el=${PM}; el.scrollIntoView({block:'center'}); el.focus(); return 1;})()`);
await typeText('pred KODOVANE za');
await sleep(700);
await selectWord('KODOVANE');
// Dvojklik berie v prehliadaci aj medzeru za slovom — preto `trim()`.
check('oznacene je spravne slovo', await ev(`String(window.getSelection()).trim()`), 'KODOVANE');
check('klik na `</>` prebehol', await clickAct('code'), 'ok');
await sleep(900);
check('v editore je <code>', await ev(`!!${PM}.querySelector('code')`), true);
/* Serializacia do textarey ide cez update cyklus editora, takze sa na nu ceka.
 * Bez toho test cital textareu skor, nez do nej editor stihol zapisat. */
let backticks = false;
try {
  await waitFor(`/\`KODOVANE ?\`/.test((document.getElementById('issue_notes')||{}).value||'')`,
    'backticky v textarei', 12000);
  backticks = true;
} catch (e) { /* nechame na check nizsie, aby test vypisal skutocnu hodnotu */ }
check('markdown ma backticky', backticks, true);
if (!backticks) {
  console.log('    textarea obsahuje: ' + JSON.stringify(await ev(`(document.getElementById('issue_notes')||{}).value||''`)));
}

console.log('\n[2] JADRO OPRAVY: je to aj VIDNO');
const style = JSON.parse(await ev(`(function(){
  var c = ${PM}.querySelector('code');
  var s = getComputedStyle(c), pm = getComputedStyle(${PM});
  return JSON.stringify({ bg: s.backgroundColor, editorBg: pm.backgroundColor,
                          padding: parseFloat(s.paddingLeft), radius: parseFloat(s.borderTopLeftRadius) });
})()`));
console.log('  ' + JSON.stringify(style));
check('pozadie nie je priehladne', style.bg !== 'rgba(0, 0, 0, 0)', true);
check('pozadie sa lisi od editora', style.bg !== style.editorBg, true);
check('ma vodorovny padding', style.padding > 0, true);
check('ma zaoblene rohy', style.radius > 0, true);
/* Zhoda s jadrom je zmysel opravy: editor ma ukazovat to, co uvidi citatel. */
check('pozadie je to iste, ake dava jadro vyrenderovanemu textu',
  style.bg, 'rgba(62, 91, 118, 0.08)');

console.log('\n[3] Blok kodu `{ }` nedostane pozadie dvakrat');
await ev(`(function(){${PM}.focus(); return 1;})()`);
await ev(`(function(){
  var pm = ${PM};
  var r = document.createRange(); r.selectNodeContents(pm.lastElementChild || pm);
  var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); return 1;
})()`);
await sleep(400);
await clickAct('codeBlock');
await sleep(900);
const inPre = await ev(`(function(){
  var c = ${PM}.querySelector('pre code');
  if (!c) return null;
  var s = getComputedStyle(c);
  return JSON.stringify({ bg: s.backgroundColor, padding: parseFloat(s.paddingLeft) });
})()`);
if (inPre) {
  const pre = JSON.parse(inPre);
  console.log('  code v <pre>: ' + JSON.stringify(pre));
  check('code v bloku kodu nema vlastne pozadie', pre.bg, 'rgba(0, 0, 0, 0)');
  check('ani vlastny padding', pre.padding, 0);
} else {
  check('blok kodu sa vytvoril', false, true);
}

console.log('\n' + '='.repeat(84));
console.log('  ' + OK.length + ' OK, ' + BAD.length + ' chyb');
if (BAD.length) BAD.forEach(b => console.log('  !! ' + b));
console.log('='.repeat(84));
ws.close();
process.exit(BAD.length ? 1 : 0);
