/* Test úpravy EXISTUJÚCEHO komentára (ceruzka v histórii) cez CDP.
 *
 * PREČO PROTI ŽIVÉMU REDMINE a nie proti uloženej stránke: formulár úpravy komentára
 * doťahuje Redmine až AJAXom (`GET /journals/:id/edit` → `edit.js.erb`), takže na
 * `file://` kópii stránky vôbec nevznikne a nie je čo testovať.
 *
 * PREČO CEZ CDP a nie programovo: paletu ani suggestion pluginy nespustí
 * `execCommand('insertText')`; jediné, čo funguje, sú skutočné klávesové udalosti
 * (podrobne v hlavičke extra/emoticon_cdp_test.mjs).
 *
 * Príprava (viď README pluginu):
 *   1) v Redmine musí existovať používateľ s právom upraviť daný komentár
 *   2) msedge --headless=new --disable-gpu --remote-debugging-port=9336 \
 *        --user-data-dir=/tmp/cdpjournal about:blank &
 *   3) node extra/journal_edit_cdp_test.mjs <base-url> <login> <heslo> <issueId> <journalId>
 */
const [BASE, LOGIN, PASS, ISSUE, JOURNAL] = process.argv.slice(2);
if (!JOURNAL) {
  console.error('pouzitie: node journal_edit_cdp_test.mjs <base-url> <login> <heslo> <issueId> <journalId>');
  process.exit(2);
}

const list = await (await fetch('http://127.0.0.1:9336/json')).json();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => { ws.onopen = r; });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'JS error');
  return r?.result?.value;
};

async function waitFor(expr, label, ms = 15000) {
  const until = Date.now() + ms;
  for (;;) {
    if (await evaluate(expr)) return true;
    if (Date.now() > until) throw new Error('timeout: ' + label);
    await sleep(200);
  }
}

async function nav(url) {
  await send('Page.navigate', { url });
  await waitFor('document.readyState === "complete"', 'nacitanie ' + url);
  await sleep(400);
}

async function typeReal(text) {
  for (const ch of text) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await sleep(40);
  }
  await sleep(250);
}

async function pressCombo(key, code, keyCode, modifiers) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, modifiers, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await sleep(200);
}

async function pressKey(key, code, keyCode) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await sleep(200);
}

const OK = []; const BAD = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  (ok ? OK : BAD).push(label);
  console.log('  ' + label.padEnd(52) + (ok ? 'OK' : '!! ZLE (' + JSON.stringify(got) + ', cakalo sa ' + JSON.stringify(want) + ')'));
}

const FORM = '#journal-' + JOURNAL + '-form';
const TA = '#journal_' + JOURNAL + '_notes';
const NEW_TEXT = 'Upraveny cez rich editor';

console.log('='.repeat(74));
console.log('  rich_editor — uprava existujuceho komentara (journal ' + JOURNAL + ')');
console.log('='.repeat(74));

// --- prihlásenie -------------------------------------------------------------
await send('Page.enable');
await nav(BASE + '/login?nosso=1');
// Profil prehliadača si sedenie pamätá medzi behmi — druhýkrát nás Redmine z /login rovno
// presmeruje a prihlasovací formulár na stránke vôbec nie je.
if (await evaluate('!!document.getElementById("username")')) {
  await evaluate(`(function(){
    document.getElementById('username').value = ${JSON.stringify(LOGIN)};
    document.getElementById('password').value = ${JSON.stringify(PASS)};
    document.getElementById('login-form').querySelector('input[type=submit]').click();
    return true;
  })()`);
}
await waitFor('!!document.querySelector("#loggedas, #account")', 'prihlasenie');
console.log('\n[1] Prihlasenie');
check('prihlaseny pouzivatel', await evaluate('!!document.querySelector("#loggedas, #account")'), true);

// --- detail úlohy a kliknutie na ceruzku ------------------------------------
await nav(BASE + '/issues/' + ISSUE);
console.log('\n[2] Ceruzka pri komentari');
const pencil = '#change-' + JOURNAL + ' a.icon-edit';
check('ceruzka je v historii', await evaluate(`!!document.querySelector(${JSON.stringify(pencil)})`), true);
await evaluate(`document.querySelector(${JSON.stringify(pencil)}).click()`);
await waitFor(`!!document.querySelector(${JSON.stringify(FORM + ' ' + TA)})`, 'formular upravy');

// --- rich editor namiesto starej textarey ------------------------------------
console.log('\n[3] Rich editor namiesto povodnej textarey');
await waitFor(`!!document.querySelector(${JSON.stringify(FORM + ' .re-editor .ProseMirror')})`, 'mount rich editora');
check('rich editor je vo formulari', await evaluate(`!!document.querySelector(${JSON.stringify(FORM + ' .re-editor .ProseMirror')})`), true);
check('stary wysiwyg je skryty', await evaluate(`(function(){
  var b = document.querySelector(${JSON.stringify(FORM + ' .jstBlock')});
  return !!b && getComputedStyle(b).display === 'none';
})()`), true);
check('povodny text sa nacital', await evaluate(`document.querySelector(${JSON.stringify(FORM + ' .ProseMirror')}).textContent.indexOf('Povodny komentar s formatovanim') >= 0`), true);
check('tucne pismo zostalo tucne', await evaluate(`!!document.querySelector(${JSON.stringify(FORM + ' .ProseMirror strong')})`), true);
check('odrazky zostali odrazkami', await evaluate(`document.querySelectorAll(${JSON.stringify(FORM + ' .ProseMirror ul li')}).length`), 2);

// --- nové funkcie: paleta blokov po "/" --------------------------------------
console.log('\n[4] Nove funkcie v tomto formulari');
await evaluate(`(function(){ var ed = document.querySelector(${JSON.stringify(TA)})._reEditor; ed.commands.clearContent(true); ed.view.dom.focus(); return true; })()`);
await typeReal('/');
check('paleta blokov ("/") sa otvorila', await evaluate('!!document.querySelector(".re-slash")'), true);
await pressKey('Escape', 'Escape', 27);
await evaluate(`(function(){ var ed = document.querySelector(${JSON.stringify(TA)})._reEditor; ed.commands.clearContent(true); ed.view.dom.focus(); return true; })()`);

/* Prílohy sa sem pridať nedajú (PUT /journals/:id ich neprijíma) — musí to povedať nahlas.
   Skúša sa to skratkou Ctrl/Cmd+Shift+A, teda skutočnou klávesovou cestou k `openFilePicker`.
   POZOR: syntetickým `new DragEvent('drop')` sa to overiť NEDÁ — k ProseMirroru sa taký
   event vôbec nedostane, a to ani tam, kde upload povolený je (overené), takže test by
   „prešiel" úplne rovnako aj s vypnutou ochranou. */
await evaluate(`(function(){ document.querySelector(${JSON.stringify(FORM + ' .ProseMirror')}).focus(); return true; })()`);
await pressCombo('A', 'KeyA', 65, 10); // 10 = Ctrl(2) + Shift(8)
await sleep(600);
check('pokus o prilohu pouzivatelovi nieco povie', await evaluate(`!!document.querySelector(${JSON.stringify(FORM + ' .re-attach-note')})`), true);
// Počítať sa musí LEN vo vnútri journal formulára: `addFormFields` pridáva skryté polia
// práve tam. Na celej stránke jedno `attachments[…]` pole existuje aj bez nás — má ho
// natívny nahrávač príloh v issue formulári, takže globálny počet nikdy nie je nula.
check('a nic sa nenahralo', await evaluate(`document.querySelectorAll(${JSON.stringify(FORM + ' input[name^="attachments["]')}).length`), 0);
check('vyber suboru sa ani neotvoril', await evaluate(`!document.querySelector(${JSON.stringify(TA)})._reEditor.__reFileInput`), true);

// --- písanie sa premieta do textarey -----------------------------------------
console.log('\n[5] Ulozenie natívnym tlacidlom Save');
await evaluate(`(function(){ var ed = document.querySelector(${JSON.stringify(TA)})._reEditor; ed.commands.clearContent(true); ed.view.dom.focus(); return true; })()`);
await typeReal(NEW_TEXT);
check('text sa premietol do textarey', await evaluate(`document.querySelector(${JSON.stringify(TA)}).value.indexOf(${JSON.stringify(NEW_TEXT)}) >= 0`), true);

await evaluate(`document.querySelector(${JSON.stringify(FORM + ' input[type=submit]')}).click()`);
await waitFor(`!document.querySelector(${JSON.stringify(FORM)})`, 'zatvorenie formulara po ulozeni');
await sleep(600);
check('komentar sa ulozil', await evaluate(`(document.querySelector('#journal-${JOURNAL}-notes') || {}).textContent.indexOf(${JSON.stringify(NEW_TEXT)}) >= 0`), true);
check('editor sa po zatvoreni zahodil', await evaluate(`document.querySelectorAll('.re-editor').length <= 2`), true);

console.log('\n' + '='.repeat(74));
console.log('  OK: ' + OK.length + '   CHYBA: ' + BAD.length);
console.log('='.repeat(74));
ws.close();
process.exit(BAD.length ? 1 : 0);
