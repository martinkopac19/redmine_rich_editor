/* „Add comment" uloží aj zmenené polia editácie (v0.16.0).
 *
 * Prípad z praxe: New → In Progress + „pracujem na tom" jedným klikom. Predtým
 * tlačidlo poslalo len text komentára a zmena stavu sa ticho zahodila.
 *
 *   node extra/comment_with_attrs_cdp_test.mjs <base> <login> <heslo> <issueId> <cieľový stav> [port]
 */
const [BASE, LOGIN, PASS, ISSUE, TARGET, PORT = '9401'] = process.argv.slice(2);
if (!TARGET) {
  console.error('pouzitie: node comment_with_attrs_cdp_test.mjs <base> <login> <heslo> <issueId> <stav> [port]');
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

const OK = []; const BAD = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  (ok ? OK : BAD).push(label);
  console.log('  ' + label.padEnd(62) + (ok ? 'OK' : '!! ZLE (' + JSON.stringify(got) + ', cakalo sa ' + JSON.stringify(want) + ')'));
}
const J = s => JSON.stringify(s);

const PM = `document.querySelector('.re-comment-box .ProseMirror')`;
const BTN = `document.querySelector('.re-comment-submit')`;
const COUNT = `document.querySelectorAll('#history .journal').length`;
const STATUS_TOP = `(document.querySelector('.issue .attributes .status .value')||{}).textContent.trim()`;
async function writeComment(text) {
  await ev(`(function(){var el=${PM}; el.scrollIntoView({block:'center'}); el.focus(); return 1;})()`);
  await sleep(200);
  await send('Input.insertText', { text });
  await sleep(400);
}

console.log('='.repeat(86));
console.log('  rich_editor — Add comment uloží aj zmenené polia');
console.log('='.repeat(86));

await send('Page.enable');
await nav(BASE + '/login?nosso=1');
if (await ev(`!!document.getElementById('username')`)) {
  await ev(`(function(){document.getElementById('username').value=${J(LOGIN)};document.getElementById('password').value=${J(PASS)};document.getElementById('login-form').querySelector('input[type=submit]').click();return 1;})()`);
  await waitFor(`!!document.querySelector('#loggedas')`, 'prihlasenie');
}

console.log('\n[1] Bez zmien tlačidlo ostáva obyčajné');
await nav(BASE + '/issues/' + ISSUE);
await ev(`sessionStorage.removeItem('re.draft.notes.${ISSUE}')`);
const before = await ev(STATUS_TOP);
const label0 = await ev(`${BTN}.textContent`);
check('tlačidlo bez „+"', label0.includes('+'), false);

console.log('\n[2] Zmena stavu → tlačidlo povie, že ju uloží');
await ev(`(function(){var s=document.getElementById('issue_status_id');var o=[].find.call(s.options,function(o){return o.textContent.trim()===${J(TARGET)};});s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));return 1;})()`);
await waitFor(`${BTN}.textContent.indexOf(${J(TARGET)})>=0`, 'popis tlačidla so stavom', 10000).catch(() => {});
const label1 = await ev(`${BTN}.textContent`);
console.log('    tlačidlo: ' + label1);
check('tlačidlo obsahuje cieľový stav', label1.includes(TARGET), true);
check('tlačidlo obsahuje „+"', label1.includes('+'), true);

console.log('\n[3] Komentár + klik → jeden záznam so stavom aj komentárom');
const n0 = await ev(COUNT);
const note = 'Test komentar so zmenou stavu ' + Date.now();
await writeComment(note);
await ev(`${BTN}.click()`);
await sleep(1500);
await waitFor('document.readyState === "complete" && !!' + BTN, 'znovunačítanie po uložení');
await sleep(1200);
check('stav hore na stránke = cieľový', await ev(STATUS_TOP), TARGET);
check('pribudol práve 1 záznam v histórii', (await ev(COUNT)) - n0, 1);
const last = await ev(`(function(){var j=[].slice.call(document.querySelectorAll('#history .journal')).pop();return j?j.textContent.replace(/\\s+/g,' '):''})()`);
check('posledný záznam má komentár', last.includes(note), true);
check('posledný záznam má zmenu stavu na cieľový', last.includes(TARGET), true);
check('editor komentára je po uložení prázdny', (await ev(`${PM}.textContent.trim()`)), '');
check('tlačidlo je znova obyčajné', (await ev(`${BTN}.textContent`)).includes('+'), false);
check('koncept komentára je prázdny', await ev(`!((JSON.parse(sessionStorage.getItem('re.draft.notes.${ISSUE}')||'{}')).notes)`), true);

console.log('\n[4] Samotný komentár bez zmien ide postaru (bez načítania stránky)');
await ev(`window.__noReload = 1`);
const n1 = await ev(COUNT);
await writeComment('Len komentar ' + Date.now());
await ev(`${BTN}.click()`);
await waitFor(`${COUNT} > ${n1}`, 'komentár v histórii', 10000).catch(() => {});
check('pribudol 1 záznam', (await ev(COUNT)) - n1, 1);
check('stránka sa nenačítala znova', await ev(`window.__noReload === 1`), true);
check('stav hore sa nezmenil', await ev(STATUS_TOP), TARGET);

console.log('\n' + '='.repeat(86));
console.log(`  ${OK.length} OK, ${BAD.length} ZLE  (stav pred testom: ${before})`);
ws.close();
process.exit(BAD.length ? 1 : 0);
