/* Prvý komentár v úlohe je po „Add comment" hneď vidieť (v0.18.4).
 *
 * Pri predvolenom tabe histórie „Poznámky" Redmine pošle `#tab-content-history` s display:none
 * a odkryje ho až inline skript. swapHistory ho po výmene histórie odkrýval klikom na predtým
 * otvorený tab — úloha bez komentárov však žiadne taby nemá, takže komentár ostal skrytý až do
 * refreshu (#58157).
 *
 * Test PÍŠE: pridá komentár do zadanej úlohy. Úloha musí byť bez komentárov a používateľ musí mať
 * v Mojom účte „Výchozí záložka historie" = Poznámky (pref `history_default_tab: notes`).
 *
 *   node extra/first_comment_cdp_test.mjs <base> <login> <heslo> <issue_bez_komentarov> [port]
 */
const [BASE, LOGIN, PASS, ISSUE, PORT = '9401'] = process.argv.slice(2);
if (!ISSUE) {
  console.error('pouzitie: node first_comment_cdp_test.mjs <base> <login> <heslo> <issue_bez_komentarov> [port]');
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
const VISIBLE = `[].filter.call(document.querySelectorAll('#history .journal'), function (j) { return j.offsetParent !== null; }).length`;

console.log('='.repeat(86));
console.log('  rich_editor — prvý komentár v úlohe je hneď vidieť');
console.log('='.repeat(86));
await send('Page.enable');
await nav(BASE + '/login?nosso=1');
if (await ev(`!!document.getElementById('username')`)) {
  await ev(`(function(){document.getElementById('username').value=${J(LOGIN)};document.getElementById('password').value=${J(PASS)};document.getElementById('login-form').querySelector('input[type=submit]').click();return 1;})()`);
  await waitFor(`!!document.querySelector('#loggedas')`, 'prihlasenie');
}
await nav(BASE + '/issues/' + ISSUE);
await waitFor(`!!document.querySelector('.re-comment-box .ProseMirror')`, 'lista komentara');
check('úloha je bez komentárov (predpoklad testu)', await ev(`document.querySelectorAll('#history .journal').length`), 0);

const NOTE = 'Prvy komentar ' + Date.now();
await ev(`(function(){document.querySelector('.re-comment-box .ProseMirror').editor.commands.setContent(${J(NOTE)}, true);return 1})()`);
await sleep(300);
await ev(`document.querySelector('.re-comment-submit').click(),1`);
await waitFor(`document.querySelectorAll('#history .journal').length > 0`, 'komentar v historii');
await sleep(500);
check('predvolený tab je Poznámky (predpoklad testu)', await ev(`(document.querySelector('#history .tabs a.selected')||{}).id`), 'tab-notes');
check('komentár je v histórii viditeľný bez refreshu', await ev(VISIBLE), 1);
check('je to náš text', await ev(`(document.querySelector('#history .journal .wiki')||{}).textContent.trim()`), NOTE);
check('editor komentára je prázdny', await ev(`document.querySelector('.re-comment-box .ProseMirror').textContent`), '');

console.log('\n' + '='.repeat(86));
console.log(`  ${OK.length} OK, ${BAD.length} ZLE`);
ws.close();
process.exit(BAD.length ? 1 : 0);
