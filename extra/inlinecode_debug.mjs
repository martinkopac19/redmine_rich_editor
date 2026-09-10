/* Diagnostika: co naozaj robi tlacidlo `</>` (Inline code) v bublinovej liste.
 *
 *   node extra/inlinecode_debug.mjs <base> <login> <heslo> <issueId> [port]
 */
const [BASE, LOGIN, PASS, ISSUE, PORT = '9381'] = process.argv.slice(2);
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
const key = async (k, code, mod) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers: mod, text: k.length === 1 && !mod ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mod });
  await sleep(50);
};
const typeText = async s => { for (const c of s) await key(c, 'Key' + (/[a-z]/i.test(c) ? c.toUpperCase() : '')); };
const J = s => JSON.stringify(s);

const PM = `document.querySelector('.re-comment-box .ProseMirror')`;

await send('Page.enable');
await send('Page.navigate', { url: BASE + '/login?nosso=1' });
await sleep(3000);
if (await ev(`!!document.getElementById('username')`)) {
  await ev(`(function(){document.getElementById('username').value=${J(LOGIN)};document.getElementById('password').value=${J(PASS)};document.getElementById('login-form').querySelector('input[type=submit]').click();return 1;})()`);
  await sleep(3500);
}
await send('Page.navigate', { url: BASE + '/issues/' + ISSUE });
await waitFor('document.readyState === "complete"', 'detail ulohy');
await sleep(1500);
await ev(`sessionStorage.removeItem('re.draft.notes.${ISSUE}')`);

console.log('--- 1. napisem text a oznacim slovo ---');
await ev(`(function(){var el=${PM}; el.scrollIntoView({block:'center'}); el.focus(); return 1;})()`);
await typeText('pred KODOVANE za');
await sleep(700);
// oznac slovo KODOVANE (dvojklik na nom)
const pos = await ev(`(function(){
  var pm = ${PM};
  var w = Array.prototype.find.call(pm.querySelectorAll('p'), function(p){ return /KODOVANE/.test(p.textContent); }) || pm;
  var t = document.createTreeWalker(w, NodeFilter.SHOW_TEXT).nextNode();
  var i = t.textContent.indexOf('KODOVANE');
  var r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 8);
  var rect = r.getBoundingClientRect();
  var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  return JSON.stringify({x: Math.round(rect.left + rect.width/2), y: Math.round(rect.top + rect.height/2)});
})()`);
const p = JSON.parse(pos);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 2 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 2 });
await sleep(900);
console.log('oznacene: ' + JSON.stringify(await ev(`String(window.getSelection())`)));
console.log('bublinova lista viditelna: ' + await ev(`!!document.querySelector('.re-bubble:not([hidden])') || !!document.querySelector('.re-bubble')`));

console.log('\n--- 2. kliknem na tlacidlo </> (data-re-act) ---');
console.log('bublinovych list v DOM: ' + await ev(`document.querySelectorAll('.re-bubble').length`));
console.log('z toho viditelnych: ' + await ev(`Array.prototype.filter.call(document.querySelectorAll('.re-bubble'), function(b){var r=b.getBoundingClientRect(); return b.offsetParent!==null && r.width>0;}).length`));
/* POZOR: v DOM su DVE bublinove listy — kazdy editor (popis a komentar) ma
 * svoju. Klik na tlacidlo v cudzej liste nema co aplikovat, preto sa vybera
 * ta VIDITELNA. (Rovnaka pasca ako pri liste obrazka, v0.9.0.) */
const clicked = await ev(`(function(){
  var bars = Array.prototype.filter.call(document.querySelectorAll('.re-bubble'), function(b){
    var r = b.getBoundingClientRect();
    return b.offsetParent !== null && r.width > 0 && r.height > 0;
  });
  if (!bars.length) return 'ziadna VIDITELNA bublinova lista';
  var b = bars[0].querySelector('[data-re-act="code"]');
  if (!b) return 'tlacidlo code v nej NENAJDENE';
  b.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
  b.click();
  return 'kliknute (listy viditelne: ' + bars.length + ')';
})()`);
console.log('klik: ' + clicked);
await sleep(1000);

console.log('\n--- 3. co je v DOM editora a v textarei ---');
console.log('HTML editora: ' + JSON.stringify(await ev(`${PM}.innerHTML.slice(0,300)`)));
console.log('je tam <code>: ' + await ev(`!!${PM}.querySelector('code')`));
console.log('markdown v textarei: ' + JSON.stringify(await ev(`(document.getElementById('issue_notes')||{}).value||''`)));

console.log('\n--- 4. ako <code> v editore VYZERA (pocitane styly) ---');
console.log(await ev(`(function(){
  var c = ${PM}.querySelector('code');
  if (!c) return 'ziadny <code>';
  var s = getComputedStyle(c);
  var pm = getComputedStyle(${PM});
  return JSON.stringify({
    code_font: s.fontFamily.slice(0,40), code_bg: s.backgroundColor,
    code_padding: s.padding, code_radius: s.borderRadius,
    editor_font: pm.fontFamily.slice(0,40),
    rovnake_pozadie_ako_editor: s.backgroundColor === pm.backgroundColor
  }, null, 1);
})()`));

console.log('\n--- 5. ako to iste vyzera VYRENDEROVANE (existujuci text na stranke) ---');
console.log(await ev(`(function(){
  var c = document.querySelector('#issue_description_wiki code, .wiki code');
  if (!c) return 'na stranke nie je vyrenderovany <code> na porovnanie';
  var s = getComputedStyle(c);
  return JSON.stringify({ bg: s.backgroundColor, padding: s.padding, radius: s.borderRadius }, null, 1);
})()`));

ws.close();
