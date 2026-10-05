/* Private notes a prílohy pri lište komentára (v0.17.0).
 *
 *   node extra/comment_extras_cdp_test.mjs <base> <login> <heslo> <issueId> <súbor> [port]
 *
 * Login musí smieť dávať súkromné poznámky (napr. admin na lokále).
 */
const [BASE, LOGIN, PASS, ISSUE, FILE, FILE2, PORT = '9401'] = process.argv.slice(2);
if (!FILE) {
  console.error('pouzitie: node comment_extras_cdp_test.mjs <base> <login> <heslo> <issueId> <subor> [port]');
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
const BOX = `document.querySelector('.re-comment-box')`;
const PM = `document.querySelector('.re-comment-box .ProseMirror')`;
const BTN = `document.querySelector('.re-comment-submit')`;
const COUNT = `document.querySelectorAll('#history .journal').length`;

console.log('='.repeat(86));
console.log('  rich_editor — private notes a prílohy pri komentári');
console.log('='.repeat(86));
await send('Page.enable');
await send('DOM.enable');
await nav(BASE + '/login?nosso=1');
if (await ev(`!!document.getElementById('username')`)) {
  await ev(`(function(){document.getElementById('username').value=${J(LOGIN)};document.getElementById('password').value=${J(PASS)};document.getElementById('login-form').querySelector('input[type=submit]').click();return 1;})()`);
  await waitFor(`!!document.querySelector('#loggedas')`, 'prihlasenie');
}
await nav(BASE + '/issues/' + ISSUE);

console.log('\n[1] Rozloženie');
check('private notes je pri komentári', await ev(`!!${BOX}.querySelector('#issue_private_notes')`), true);
check('private notes už nie je v editácii', await ev(`!document.querySelector('#issue-form #issue_private_notes')`), true);
check('private notes stále patrí formuláru', await ev(`document.getElementById('issue_private_notes').form && document.getElementById('issue_private_notes').form.id`), 'issue-form');
check('upload je pri komentári', await ev(`!!${BOX}.querySelector('#new-attachments input[type=file]')`), true);
// fieldset ostáva, len ak v ňom zostalo niečo užitočné (úprava/mazanie existujúcich príloh)
check('fieldset Files v editácii: skrytý, alebo má vlastný obsah', await ev(`(function(){var f=document.getElementById('add_attachments');return getComputedStyle(f).display==='none' || !!f.querySelector('input, a, img')})()`), true);
const after = (x, y) => `!!(${x}.compareDocumentPosition(${y}) & 4)`;
check('private notes je NAD tlačidlom', await ev(after(`${BOX}.querySelector('.re-comment-private')`, BTN)), true);
check('výber súborov je POD tlačidlom', await ev(after(BTN, `${BOX}.querySelector('.re-comment-files')`)), true);
check('zoznam súborov je POD tlačidlom na výber', await ev(after(`${BOX}.querySelector('.add_attachment')`, `${BOX}.querySelector('.attachments_fields')`)), true);
check('vlastné tlačidlo na súbory s textom', await ev(`(${BOX}.querySelector('.re-file-btn')||{}).textContent`), process.env.EXPECT_PICK || 'Choose files');
check('prázdna sekcia Poznámka v editácii je skrytá', await ev(`getComputedStyle(document.getElementById('add_notes')).display`), 'none');
check('natívny file input je skrytý', await ev(`${BOX}.querySelector('input[type=file]').getBoundingClientRect().width <= 1`), true);

console.log('\n[2] Súbor + súkromný komentár → jeden súkromný záznam s prílohou');
const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.re-comment-box #new-attachments input[type=file]' });
await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [FILE] });
await waitFor(`!!${BOX}.querySelector('.attachments_fields input[name$="[token]"]')`, 'upload súboru');
// Redmine po výbere input zmaže a vloží klon → druhý súbor musí ísť do NOVÉHO inputu
const doc2 = await send('DOM.getDocument', { depth: -1, pierce: true });
const q2 = await send('DOM.querySelector', { nodeId: doc2.root.nodeId, selector: '.re-comment-box #new-attachments input[type=file]' });
await send('DOM.setFileInputFiles', { nodeId: q2.nodeId, files: [FILE2] });
await waitFor(`${BOX}.querySelectorAll('.attachments_fields input[name$="[token]"]').length >= 2`, 'druhý upload').catch(() => {});
check('nahrané 2 súbory', await ev(`${BOX}.querySelectorAll('.attachments_fields input[name$="[token]"]').length`), 2);
check('tlačidlo klikne na AKTUÁLNY input (v stránke)', await ev(`(function(){var hit=null,orig=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){hit=this;};try{${BOX}.querySelector('.re-file-btn').click();}finally{HTMLInputElement.prototype.click=orig;}return !!hit && hit.isConnected && hit.type==='file';})()`), true);
check('skryté pole prílohy patrí formuláru', await ev(`${BOX}.querySelector('.attachments_fields input[name$="[token]"]').form.id`), 'issue-form');
await ev(`document.getElementById('issue_private_notes').click()`);
const n0 = await ev(COUNT);
const note = 'Sukromny test s prilohou ' + Date.now();
await ev(`(function(){var el=${PM}; el.focus(); return 1;})()`);
await send('Input.insertText', { text: note });
await sleep(400);
await ev(`${BTN}.click()`);
await waitFor(`${COUNT} > ${n0}`, 'záznam v histórii', 15000).catch(() => {});
await sleep(800);
// Redmine súkromnú poznámku so zmenami (tu príloha) zámerne rozdelí: súkromný komentár +
// verejný záznam so zmenou — aby zmena nebola ostatným skrytá. Natívny formulár rovnako.
check('pribudli 2 záznamy (súkromný komentár + verejná príloha)', (await ev(COUNT)) - n0, 2);
const NEW = `[].slice.call(document.querySelectorAll('#history .journal')).slice(${n0})`;
const last = `[].slice.call(document.querySelectorAll('#history .journal')).pop()`;
check('záznam má komentár', await ev(`${last}.textContent.indexOf(${J(note)}) >= 0`), true);
check('záznam je súkromný', await ev(`${last}.classList.contains('private-notes') || !!${last}.querySelector('.private, .badge-private')`), true);
const fname = FILE.split(/[\\/]/).pop();
const fname2 = FILE2.split(/[\\/]/).pop();
check('aj druhá príloha je uložená', await ev(`${NEW}.some(function(j){return j.textContent.indexOf(${J(fname2)}) >= 0})`), true);
check('príloha je v novom verejnom zázname', await ev(`${NEW}.some(function(j){return !j.classList.contains('private-notes') && j.textContent.indexOf(${J(fname)}) >= 0})`), true);
check('po uložení: private notes odškrtnuté', await ev(`document.getElementById('issue_private_notes').checked`), false);
check('po uložení: zoznam súborov prázdny', await ev(`${BOX}.querySelectorAll('.attachments_fields > span').length`), 0);
check('po uložení: upload stále k dispozícii', await ev(`!!${BOX}.querySelector('#new-attachments input[type=file]')`), true);
const FS = `document.getElementById('add_attachments')`;
const VISIBLE = `[].filter.call(${FS}.querySelectorAll('.existing-attachment'),function(e){return e.offsetParent!==null}).length`;
await ev(`document.querySelector('.contextual a.icon-edit') && document.querySelector('.contextual a.icon-edit').click()`);
await sleep(600);
check('Edit: sekcia Súbory je vidno', await ev(`getComputedStyle(${FS}).display !== 'none'`), true);
check('Edit: bez odkazu „Upraviť prílohy"', await ev(`!${FS}.querySelector('.contextual')`), true);
check('Edit: bez čiary', await ev(`!${FS}.querySelector('hr')`), true);
check('Edit: obe prílohy sú vidno hneď', await ev(VISIBLE), 2);

console.log('\n[3] Viac ako 5 súborov → prvých 5 a „zobraziť ďalšie"');
const MANY = (process.env.MANY_FILES || '').split('|').filter(Boolean);
if (MANY.length) {
  const d3 = await send('DOM.getDocument', { depth: -1, pierce: true });
  const q3 = await send('DOM.querySelector', { nodeId: d3.root.nodeId, selector: '.re-comment-box #new-attachments input[type=file]' });
  await send('DOM.setFileInputFiles', { nodeId: q3.nodeId, files: MANY });
  // ZÁMERNE bez čakania na dokončenie uploadu — klik hneď, ako to robí človek
  await waitFor(`${BOX}.querySelectorAll('.attachments_fields > span').length >= ${MANY.length}`, 'súbory v zozname');
  await ev(`window.__pred = 1; ${BTN}.click()`);
  await waitFor(`!window.__pred && document.readyState === 'complete' && !!document.getElementById('add_attachments')`, 'obnovenie po súboroch');
  await sleep(1200);
  await ev(`document.querySelector('.contextual a.icon-edit').click()`);
  await sleep(600);
  const total = 2 + MANY.length;
  check('súbor bez textu sa uložil (spolu ' + total + ')', await ev(`${FS}.querySelectorAll('.existing-attachment').length`), total);
  check('vidno prvých 5', await ev(VISIBLE), 5);
  check('odkaz „zobraziť ďalšie" s počtom', await ev(`(${FS}.querySelector('.re-att-more')||{}).textContent`), process.env.EXPECT_MORE || ('Show ' + (total - 5) + ' more'));
  await ev(`${FS}.querySelector('.re-att-more').click()`);
  check('po kliku vidno všetky', await ev(VISIBLE), total);
}

console.log('\n' + '='.repeat(86));
console.log(`  ${OK.length} OK, ${BAD.length} ZLE`);
ws.close();
process.exit(BAD.length ? 1 : 0);
