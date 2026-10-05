/* Zmena stavu v editácii nesmie posunúť stránku (v0.17.6).
 *
 * Redmine po zmene stavu prekreslí `#all_attributes` a s ním príde nová textarea popisu.
 * Predtým sa na ňu pripojil druhý editor a na chvíľu sa ukázal riadok „Popis ✎ Upraviť"
 * → stránka narástla a obsah poskočil (video od zadávateľa 5. 10. 2026).
 *
 *   node extra/status_change_scroll_cdp_test.mjs <base> <login> <heslo> <issueId> <stav> [port]
 */
const [BASE, LOGIN, PASS, ISSUE, TARGET, PORT = '9401'] = process.argv.slice(2);
if (!TARGET) {
  console.error('pouzitie: node status_change_scroll_cdp_test.mjs <base> <login> <heslo> <issueId> <stav> [port]');
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
console.log('  rich_editor — zmena stavu v editácii neposunie stránku');
console.log('='.repeat(86));
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1350, height: 760, deviceScaleFactor: 1, mobile: false });
await nav(BASE + '/login?nosso=1');
if (await ev(`!!document.getElementById('username')`)) {
  await ev(`(function(){document.getElementById('username').value=${J(LOGIN)};document.getElementById('password').value=${J(PASS)};document.getElementById('login-form').querySelector('input[type=submit]').click();return 1;})()`);
  await waitFor(`!!document.querySelector('#loggedas')`, 'prihlasenie');
}
await nav(BASE + '/issues/' + ISSUE);
await ev(`document.querySelector('.contextual a.icon-edit').click()`);
await sleep(800);
await ev(`(function(){var s=document.getElementById('issue_status_id');window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 300);return 1})()`);
await sleep(500);
const EDITORS = `document.querySelectorAll('.re-editor').length`;
const before = await ev(`({top: Math.round(document.getElementById('issue_status_id').getBoundingClientRect().top), editors: ${EDITORS}})`);
check('riadok „Popis" v editácii je skrytý (pred zmenou)', await ev(`(function(){var t=document.querySelector('#all_attributes textarea#issue_description');var p=t&&t.closest('p');return !p || getComputedStyle(p).display==='none'})()`), true);

// sleduj polohu poľa Stav aj počas prekreslenia, nie len na konci
await ev(`(function(){window.__tops=[];var t0=Date.now();(function tick(){var s=document.getElementById('issue_status_id');if(s)window.__tops.push(Math.round(s.getBoundingClientRect().top));if(Date.now()-t0<2500)requestAnimationFrame(tick)})();return 1})()`);
await ev(`(function(){var s=document.getElementById('issue_status_id');var o=[].find.call(s.options,function(o){return o.textContent.trim()===${J(TARGET)}});s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
await sleep(2800);
const tops = await ev(`window.__tops`);
const moved = Math.max(...tops.map(t => Math.abs(t - before.top)));
console.log('    poloha poľa Stav pred: ' + before.top + ' px, najväčší posun počas prekreslenia: ' + moved + ' px');
check('pole Stav sa nepohlo (najviac 2 px)', moved <= 2, true);
check('formulár sa naozaj prekreslil (nový stav vybraný)', await ev(`document.getElementById('issue_status_id').selectedOptions[0].textContent.trim()`), TARGET);
check('nepribudol druhý editor popisu', await ev(EDITORS), before.editors);
check('riadok „Popis" v editácii je skrytý (po zmene)', await ev(`(function(){var t=document.querySelector('#all_attributes textarea#issue_description');var p=t&&t.closest('p');return !p || getComputedStyle(p).display==='none'})()`), true);
check('nová textarea popisu nesie aktuálny popis', await ev(`(function(){var t=document.querySelector('#all_attributes textarea#issue_description');return !!t && t.dataset.reMounted==='adopted'})()`), true);

console.log('\n' + '='.repeat(86));
console.log(`  ${OK.length} OK, ${BAD.length} ZLE`);
ws.close();
process.exit(BAD.length ? 1 : 0);
