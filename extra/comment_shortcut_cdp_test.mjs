/* Cmd/Ctrl+Enter odosle komentar (v0.15.0).
 *
 * ZAMERNE nie Cmd/Ctrl+K: ta klavesa v editore otvara dialog odkazu
 * (editor.js `Mod-k`) a mimo editora paletu. Test to aj overuje — Ctrl+K
 * v komentari NESMIE komentar odoslat.
 *
 * Skutocne klavesy cez CDP: ProseMirror programove eventy nespracuje.
 *
 *   node extra/comment_shortcut_cdp_test.mjs <base> <login> <heslo> <issueId> [port]
 */
const [BASE, LOGIN, PASS, ISSUE, PORT = '9375'] = process.argv.slice(2);
if (!ISSUE) {
  console.error('pouzitie: node comment_shortcut_cdp_test.mjs <base> <login> <heslo> <issueId> [port]');
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
async function waitFor(expr, label, ms = 25000) {
  const until = Date.now() + ms;
  for (;;) {
    try { if (await ev(expr)) return true; } catch (e) {}
    if (Date.now() > until) throw new Error('timeout: ' + label);
    await sleep(250);
  }
}
async function nav(url) {
  await send('Page.navigate', { url });
  await waitFor('document.readyState === "complete"', 'nacitanie ' + url);
  await sleep(1300);
}
const key = async (k, code, modifiers) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers, text: k.length === 1 && !modifiers ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers });
  await sleep(60);
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
const COUNT = `document.querySelectorAll('#history .journal').length`;
const focusPM = async () => {
  await ev(`(function(){var el=${PM}; el.scrollIntoView({block:'center'}); el.focus(); return 1;})()`);
  await sleep(300);
};

console.log('='.repeat(82));
console.log('  rich_editor — Cmd/Ctrl+Enter odosle komentar');
console.log('='.repeat(82));

await send('Page.enable');
await nav(BASE + '/login?nosso=1');
if (await ev(`!!document.getElementById('username')`)) {
  await ev(`(function(){document.getElementById('username').value=${J(LOGIN)};document.getElementById('password').value=${J(PASS)};document.getElementById('login-form').querySelector('input[type=submit]').click();return 1;})()`);
  await waitFor(`!!document.querySelector('#loggedas')`, 'prihlasenie');
}

console.log('\n[1] Tlacidlo nesie skratku v tooltipe');
await nav(BASE + '/issues/' + ISSUE);
await ev(`sessionStorage.removeItem('re.draft.notes.${ISSUE}')`);
check('lista na komentar je na stranke', await ev(`!!${PM}`), true);
check('tooltip tlacidla spomina Enter',
  await ev(`/(Ctrl|\\u2318)\\+Enter/.test((document.querySelector('.re-comment-submit')||{}).title||'')`), true);

console.log('\n[2] Ctrl+K komentar NEODOSLE (ostava dialog odkazu)');
const before = await ev(COUNT);
await focusPM();
const M1 = 'SKRATKA' + Date.now();
await typeText(M1);
await sleep(900);
await key('k', 'KeyK', 2);        // Ctrl+K
await sleep(1500);
check('pocet komentarov sa nezmenil', await ev(COUNT), before);
check('text zostal v editore', await ev(`/${M1}/.test((${PM}||{}).textContent||'')`), true);
// dialog odkazu sa mohol otvorit — zavri ho, aby neprekazal
await key('Escape', 'Escape');
await sleep(400);

console.log('\n[3] Ctrl+Enter komentar ODOSLE');
await focusPM();
await key('Enter', 'Enter', 2);   // Ctrl+Enter
await waitFor(`${COUNT} > ${before}`, 'komentar sa objavil v historii', 30000);
await sleep(600);
check('v historii je o jeden komentar viac', await ev(COUNT), before + 1);
check('a je to ten nas', await ev(`/${M1}/.test((document.getElementById('history')||{}).textContent||'')`), true);
check('editor je po odoslani prazdny', await ev(`((${PM}||{}).textContent||'').trim()`), '');
check('koncept je zmazany', await ev(`sessionStorage.getItem('re.draft.notes.${ISSUE}')`), null);

console.log('\n[4] Prazdny komentar sa skratkou neodosle');
const after = await ev(COUNT);
await focusPM();
await key('Enter', 'Enter', 2);
await sleep(2000);
check('pocet komentarov sa nezmenil', await ev(COUNT), after);

console.log('\n[5] Shift+Enter a samotny Enter robia novy riadok, neodosielaju');
await focusPM();
const M2 = 'RIADOK' + Date.now();
await typeText(M2);
await key('Enter', 'Enter');              // samotny Enter
await typeText('druhy');
await key('Enter', 'Enter', 8);           // Shift+Enter
await sleep(1200);
check('komentar sa neodoslal', await ev(COUNT), after);
check('v editore su oba riadky',
  await ev(`/${M2}/.test((${PM}||{}).textContent||'') && /druhy/.test((${PM}||{}).textContent||'')`), true);

console.log('\n' + '='.repeat(82));
console.log('  ' + OK.length + ' OK, ' + BAD.length + ' chyb');
if (BAD.length) BAD.forEach(b => console.log('  !! ' + b));
console.log('='.repeat(82));
ws.close();
process.exit(BAD.length ? 1 : 0);
