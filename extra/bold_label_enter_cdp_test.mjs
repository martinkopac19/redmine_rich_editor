/* Enter za tučným nadpisom sekcie (`**Actual result:**` zo šablóny) začne normálny text (v0.17.9).
 * Inde (tučné slovo v bežnom texte, zoznam, kurzíva) sa Enter správa ako doteraz.
 * Test nič neukladá: píše do popisu na formulári novej úlohy a na konci ho vyprázdni.
 *
 *   node extra/bold_label_enter_cdp_test.mjs <base> <login> <heslo> <projekt> [port]
 */
const [BASE, LOGIN, PASS, PROJECT, PORT = '9401'] = process.argv.slice(2);
if (!PROJECT) {
  console.error('pouzitie: node bold_label_enter_cdp_test.mjs <base> <login> <heslo> <projekt> [port]');
  process.exit(2);
}
const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => { ws.onopen = r; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'JS error');
  return r?.result?.value;
};
async function waitFor(expr, label, ms = 20000) {
  const until = Date.now() + ms;
  for (;;) { try { if (await ev(expr)) return true; } catch (e) {} if (Date.now() > until) throw new Error('timeout: ' + label); await sleep(200); }
}
async function nav(url) { await send('Page.navigate', { url }); await waitFor('document.readyState === "complete"', 'nacitanie'); await sleep(1300); }
const OK = []; const BAD = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  (ok ? OK : BAD).push(label);
  console.log('  ' + label.padEnd(62) + (ok ? 'OK' : '!! ZLE (' + JSON.stringify(got) + ', cakalo sa ' + JSON.stringify(want) + ')'));
}
const J = s => JSON.stringify(s);

console.log('='.repeat(86));
console.log('  rich_editor — Enter za tučným nadpisom sekcie píše normálne');
console.log('='.repeat(86));
await send('Page.enable');
await nav(BASE + '/login?nosso=1');
if (await ev(`!!document.getElementById('username')`)) {
  await ev(`(function(){document.getElementById('username').value=${J(LOGIN)};document.getElementById('password').value=${J(PASS)};document.getElementById('login-form').querySelector('input[type=submit]').click();return 1;})()`);
  await waitFor(`!!document.querySelector('#loggedas')`, 'prihlasenie');
}
await nav(BASE + '/projects/' + PROJECT + '/issues/new');
await waitFor(`!!document.querySelector('#issue_description') && !!document.querySelector('.re-editor .ProseMirror')`, 'editor popisu');

async function enter() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}
// kurzor na koniec odseku, ktorého text je presne `label`
const caretAt = label => ev(`(function(){
  var pm=document.querySelector('.re-editor .ProseMirror'); pm.focus();
  var p=[].find.call(pm.querySelectorAll('p'), function(p){ return p.textContent===${J(label)}; });
  var w=document.createTreeWalker(p, NodeFilter.SHOW_TEXT), t, last; while((t=w.nextNode())) last=t;
  var r=document.createRange(); r.setStart(last, last.length); r.collapse(true);
  var s=getSelection(); s.removeAllRanges(); s.addRange(r); return 1;
})()`);
async function scenario(start, label, text) {
  await ev(`(function(){document.getElementById('issue_description').value=${J(start)};return 1})()`);
  await sleep(300);
  await caretAt(label); await sleep(200);
  await enter(); await sleep(150);
  await send('Input.insertText', { text }); await sleep(400);
  return (await ev(`document.getElementById('issue_description').value`)).replace(/\r/g, '');
}

const BUG = '**Steps to reproduce:**\n1) \n\n**Actual result:**\n\n**Expected result:**\n\n**Additional info:**';
let out = await scenario(BUG, 'Actual result:', 'padne to');
check('za nadpisom šablóny sa píše normálne', out.includes('**Actual result:**\n\npadne to\n\n**Expected result:**'), true);
check('nový text nie je tučný', /\*\*padne to/.test(out), false);
out = await scenario('Text a **tucne**', 'Text a tucne', 'dalej');
check('tučné slovo v bežnom texte: tučné pokračuje ako doteraz', out, 'Text a **tucne**\n\n**dalej**');
out = await scenario('- **polozka**', 'polozka', 'druha');
const lines = out.split('\n').filter(Boolean);
check('v zozname vznikne druhá položka ako doteraz', lines.length === 2 && /^- /.test(lines[1]), true);
out = await scenario('*Kurziva:*', 'Kurziva:', 'x');
check('kurzíva sa správa ako doteraz', out, '*Kurziva:*\n\n*x*');

await ev(`(function(){document.getElementById('issue_description').value='';try{localStorage.clear()}catch(e){}return 1})()`);
console.log('\n' + '='.repeat(86));
console.log(`  ${OK.length} OK, ${BAD.length} ZLE`);
ws.close();
process.exit(BAD.length ? 1 : 0);
