/* Rozpisany text prezije refresh — hlaseny pripad z 9. 9. 2026.
 *
 * Popis existujucej ulohy sa uklada na server (autosave), ale KOMENTAR a NOVA
 * ULOHA server nemaju: ulozit komentar znamena rozposlat notifikacie, ulozit
 * novu ulohu znamena ju zalozit. Text sa preto drzi v sessionStorage a po
 * refreshi sa vrati do editora.
 *
 * Test ZAMERNE nic nezaklada ani neodosiela do realnych dat okrem jedneho
 * komentara na testovacej ulohe, ktory hned zmaze rails skript vo fixture.
 *
 *   node extra/draft_cdp_test.mjs <base> <login> <heslo> <issueId> <projectId> [port]
 */
const [BASE, LOGIN, PASS, ISSUE, PROJECT, PORT = '9371'] = process.argv.slice(2);
if (!PROJECT) {
  console.error('pouzitie: node draft_cdp_test.mjs <base> <login> <heslo> <issueId> <projectId> [port]');
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
  await sleep(1200);   // mount editora + obnovenie konceptu
}
/* Skutocne klavesy: editor je ProseMirror, programove nastavenie textu
 * neprejde jeho update cyklom a koncept by sa nikdy neulozil. */
const key = async (k, code) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code });
  await sleep(45);
};
const typeText = async s => { for (const c of s) await key(c, 'Key' + (/[a-z]/i.test(c) ? c.toUpperCase() : '')); };

const OK = []; const BAD = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  (ok ? OK : BAD).push(label);
  console.log('  ' + label.padEnd(58) + (ok ? 'OK' : '!! ZLE (' + JSON.stringify(got) + ', cakalo sa ' + JSON.stringify(want) + ')'));
}
const J = s => JSON.stringify(s);

const MARK = 'KONCEPT' + Date.now();
const NOTES_PM = `document.querySelector('.re-comment-box .ProseMirror')`;
const DESC_PM  = `document.querySelector('.re-editor .ProseMirror')`;
const focusIn = async sel => {
  await ev(`(function(){var el=${sel}; el.scrollIntoView({block:'center'}); el.focus(); return 1;})()`);
  await sleep(300);
};

console.log('='.repeat(82));
console.log('  rich_editor — rozpisany text prezije refresh (koncept)');
console.log('='.repeat(82));

await send('Page.enable');
await nav(BASE + '/login?nosso=1');
if (await ev(`!!document.getElementById('username')`)) {
  await ev(`(function(){document.getElementById('username').value=${J(LOGIN)};document.getElementById('password').value=${J(PASS)};document.getElementById('login-form').querySelector('input[type=submit]').click();return 1;})()`);
  await waitFor(`!!document.querySelector('#loggedas')`, 'prihlasenie');
}

console.log('\n[1] KOMENTAR: rozpisany text prezije refresh');
await nav(BASE + '/issues/' + ISSUE);
await ev(`sessionStorage.removeItem('re.draft.notes.${ISSUE}')`);
check('listka na komentar je na stranke', await ev(`!!${NOTES_PM}`), true);
await focusIn(NOTES_PM);
await typeText(MARK);
await sleep(1500);   // debounce zapisu konceptu je 800 ms
check('koncept sa ulozil do sessionStorage',
  await ev(`/${MARK}/.test(String(sessionStorage.getItem('re.draft.notes.${ISSUE}')))`), true);

await nav(BASE + '/issues/' + ISSUE);
check('PO REFRESHI je text v editore',
  await ev(`/${MARK}/.test((${NOTES_PM}||{}).textContent||'')`), true);
check('a je aj v skrytej textarei (Submit by ho poslal)',
  await ev(`/${MARK}/.test((document.getElementById('issue_notes')||{}).value||'')`), true);

console.log('\n[2] KOMENTAR: druhy refresh ho nezahodi');
await nav(BASE + '/issues/' + ISSUE);
check('text je stale tam', await ev(`/${MARK}/.test((${NOTES_PM}||{}).textContent||'')`), true);

console.log('\n[3] KOMENTAR: odoslanie koncept zmaze');
await ev(`document.querySelector('.re-comment-submit').click(); 1`);
await waitFor(`!sessionStorage.getItem('re.draft.notes.${ISSUE}')`, 'koncept zmazany po odoslani', 30000);
check('koncept je po odoslani zmazany',
  await ev(`sessionStorage.getItem('re.draft.notes.${ISSUE}')`), null);
await nav(BASE + '/issues/' + ISSUE);
check('po refreshi je listka prazdna (nezdvoji komentar)',
  await ev(`((${NOTES_PM}||{}).textContent||'').trim()`), '');

console.log('\n[4] NOVA ULOHA: rozpisany nazov aj popis prezije refresh');
const MARK2 = 'NOVY' + Date.now();
await nav(BASE + '/projects/' + PROJECT + '/issues/new');
await ev(`sessionStorage.removeItem('re.draft.newissue.${PROJECT}')`);
check('formular novej ulohy ma editor popisu', await ev(`!!${DESC_PM}`), true);
await ev(`(function(){var s=document.getElementById('issue_subject'); s.focus(); return 1;})()`);
await typeText(MARK2 + ' subj');
await focusIn(DESC_PM);
await typeText(MARK2 + ' popis');
await sleep(1500);
check('koncept novej ulohy sa ulozil',
  await ev(`/${MARK2}/.test(String(sessionStorage.getItem('re.draft.newissue.${PROJECT}')))`), true);

await nav(BASE + '/projects/' + PROJECT + '/issues/new');
await sleep(1200);   // koncept sa vracia s odkladom, aby ho neprepisala sablona trackera
check('PO REFRESHI je nazov vrateny',
  await ev(`/${MARK2}/.test((document.getElementById('issue_subject')||{}).value||'')`), true);
check('PO REFRESHI je popis vrateny',
  await ev(`/${MARK2}/.test((${DESC_PM}||{}).textContent||'')`), true);

console.log('\n[5] Koncept je viazany na miesto, nie globalny');
check('koncept novej ulohy nesiaha na ulohu ' + ISSUE,
  await ev(`/${MARK2}/.test((${DESC_PM}||{}).textContent||'') && !sessionStorage.getItem('re.draft.notes.${ISSUE}')`), true);
await ev(`sessionStorage.removeItem('re.draft.newissue.${PROJECT}')`);
await nav(BASE + '/projects/' + PROJECT + '/issues/new');
check('po zmazani konceptu je formular prazdny',
  await ev(`((document.getElementById('issue_subject')||{}).value||'').trim()`), '');

console.log('\n' + '='.repeat(82));
console.log('  ' + OK.length + ' OK, ' + BAD.length + ' chyb');
if (BAD.length) BAD.forEach(b => console.log('  !! ' + b));
console.log('='.repeat(82));
ws.close();
process.exit(BAD.length ? 1 : 0);
