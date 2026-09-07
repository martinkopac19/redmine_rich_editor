/* Test zaškrtávania checkboxov v ULOŽENOM komentári cez CDP.
 *
 * PREČO PROTI ŽIVÉMU REDMINE: testuje sa presne to, že sa políčko zapíše na server bez
 * otvorenia editácie — na `file://` kópii stránky nie je čo zapisovať.
 *
 * PREČO SA TESTUJE POD ROLOU VIEWER: Viewer smie komentovať, ale NESMIE upravovať
 * komentáre (ani vlastné). Presne tento človek doteraz checkbox v komentári nezaklikol.
 * Test pod adminom by prešiel aj s nefunkčným endpointom, lebo admin má ceruzku.
 *
 * Príprava:
 *   1) bin/rails runner … extra/task_fixture.rb setup   (vytvorí usera, úlohu a komentár)
 *   2) msedge --headless=new --disable-gpu --remote-debugging-port=<port> \
 *        --user-data-dir=<profil> about:blank &
 *   3) node extra/task_toggle_cdp_test.mjs <base> <login> <heslo> <issueId> <journalId> <mode> <port>
 *      mode = toggle (plná sada) | readonly (len že políčka sú zamknuté)
 */
const [BASE, LOGIN, PASS, ISSUE, JOURNAL, MODE = 'toggle', PORT = '9337'] = process.argv.slice(2);
if (!JOURNAL) {
  console.error('pouzitie: node task_toggle_cdp_test.mjs <base> <login> <heslo> <issueId> <journalId> [mode] [port]');
  process.exit(2);
}

const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
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
  await sleep(500);
}

const OK = []; const BAD = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  (ok ? OK : BAD).push(label);
  console.log('  ' + label.padEnd(52) + (ok ? 'OK' : '!! ZLE (' + JSON.stringify(got) + ', cakalo sa ' + JSON.stringify(want) + ')'));
}

const BOX = '#journal-' + JOURNAL + '-notes';
const CBS = BOX + ' input.task-list-item-checkbox';
const J = s => JSON.stringify(s);

// Skutočný klik myšou na súradnice políčka. Programové `.click()` by tiež fungovalo
// (checkbox je obyčajný input), ale takto sa overí aj to, že políčko nie je ničím prekryté
// a že kurzor na ňom reálne je.
async function clickNth(n) {
  const rect = await evaluate(`(function(){
    var el = document.querySelectorAll(${J(CBS)})[${n}];
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!rect) throw new Error('policko ' + n + ' na stranke nie je');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(900); // request na server + odpoved
}

const states = () => evaluate(`Array.prototype.map.call(document.querySelectorAll(${J(CBS)}), function (c) { return c.checked; })`);

console.log('='.repeat(74));
console.log('  rich_editor — checkbox v ulozenom komentari (journal ' + JOURNAL + ', ' + LOGIN + ', ' + MODE + ')');
console.log('='.repeat(74));

await send('Page.enable');
await nav(BASE + '/login?nosso=1');
if (await evaluate('!!document.getElementById("username")')) {
  await evaluate(`(function(){
    document.getElementById('username').value = ${J(LOGIN)};
    document.getElementById('password').value = ${J(PASS)};
    document.getElementById('login-form').querySelector('input[type=submit]').click();
    return true;
  })()`);
}
await waitFor('!!document.querySelector("#loggedas, #account")', 'prihlasenie');
console.log('\n[1] Prihlasenie');
// POZOR: `querySelector("#loggedas, #account")` vrati prvy element v DOM, co je `#account`
// (menu, bez mena) — login je v `#loggedas` („Logged in as <login>").
check('prihlaseny je ocakavany pouzivatel',
  await evaluate(`((document.querySelector("#loggedas") || {}).textContent || '').indexOf(${J(LOGIN)}) >= 0`), true);

await nav(BASE + '/issues/' + ISSUE);
check('komentar je na stranke', await evaluate(`!!document.querySelector(${J(BOX)})`), true);
check('komentar ma tri policka', await evaluate(`document.querySelectorAll(${J(CBS)}).length`), 3);

if (MODE === 'readonly') {
  console.log('\n[2] Bez prava komentovat zostavaju policka zamknute');
  check('vsetky policka su disabled',
    await evaluate(`Array.prototype.every.call(document.querySelectorAll(${J(CBS)}), function (c) { return c.disabled; })`), true);
  check('ziadne policko nema triedu re-task-live',
    await evaluate(`document.querySelectorAll(${J(CBS + '.re-task-live')}).length`), 0);

  // Zamknute policka su len UI. Toto overuje, ze aj samotny endpoint odmietne cloveka,
  // ktory na ulohu komentovat nesmie — teda ze sa to neda obist rucnym requestom.
  const status = await evaluate(`fetch(${J(BASE + '/rich_editor/journals/' + JOURNAL + '/task')}, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-CSRF-Token': (document.querySelector('meta[name=csrf-token]') || {}).content || '',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: 'index=0&total=3&checked=1&from=0'
  }).then(function (r) { return r.status; })`);
  check('server odmietne aj rucny POST', status, 403);
} else {
  console.log('\n[2] Tento clovek komentar upravovat NESMIE');
  check('ceruzka pri komentari sa nezobrazuje',
    await evaluate(`!!document.querySelector(${J('#change-' + JOURNAL + ' a.icon-edit')})`), false);

  console.log('\n[3] Policka su odblokovane');
  await waitFor(`document.querySelectorAll(${J(CBS + '.re-task-live')}).length === 3`, 'odblokovanie policok');
  check('ziadne policko nie je disabled',
    await evaluate(`Array.prototype.some.call(document.querySelectorAll(${J(CBS)}), function (c) { return c.disabled; })`), false);
  check('policko ma kurzor pointer',
    await evaluate(`getComputedStyle(document.querySelectorAll(${J(CBS)})[0]).cursor`), 'pointer');
  check('vychodzi stav policok', await states(), [false, false, true]);

  console.log('\n[4] Zaskrtnutie a nacitanie stranky znova');
  await clickNth(0);
  check('policko je hned zaskrtnute', await states(), [true, false, true]);
  await nav(BASE + '/issues/' + ISSUE);
  check('po reloade zostava zaskrtnute (ulozilo sa)', await states(), [true, false, true]);
  check('komentar nehlasi "edited"',
    await evaluate(`!!document.querySelector(${J('#change-' + JOURNAL + ' .update-info')})`), false);

  console.log('\n[5] Odskrtnutie uz zaskrtnuteho');
  await clickNth(2);
  check('tretie policko je odskrtnute', await states(), [true, false, false]);
  await nav(BASE + '/issues/' + ISSUE);
  check('po reloade zostava odskrtnute', await states(), [true, false, false]);

  console.log('\n[6] Vratenie do vychodzieho stavu');
  await clickNth(0);
  await clickNth(2);
  await nav(BASE + '/issues/' + ISSUE);
  check('stav je opat vychodzi', await states(), [false, false, true]);
  check('ziadne policko nema chybovy obrys',
    await evaluate(`document.querySelectorAll(${J(CBS + '.re-task-failed')}).length`), 0);

  // `liveComments` po pridani komentara vymeni cele `#history` za nove HTML zo servera.
  // Nove policka prichadzaju znova ako `disabled` — bez opakovaneho odblokovania by po
  // pridani komentara prestali byt klikatelne az do reloadu stranky.
  console.log('\n[7] Po prekresleni historie zostavaju policka klikatelne');
  await evaluate(`(function () { var h = document.getElementById('history'); h.innerHTML = h.innerHTML; return true; })()`);
  await waitFor(`document.querySelectorAll(${J(CBS + '.re-task-live')}).length === 3`, 'opakovane odblokovanie');
  check('policka su znova odblokovane',
    await evaluate(`Array.prototype.some.call(document.querySelectorAll(${J(CBS)}), function (c) { return c.disabled; })`), false);
  await clickNth(1);
  await nav(BASE + '/issues/' + ISSUE);
  check('klik po prekresleni sa ulozil', await states(), [false, true, true]);
  await clickNth(1);
  await nav(BASE + '/issues/' + ISSUE);
  check('stav je opat vychodzi', await states(), [false, false, true]);
}

console.log('\n' + '='.repeat(74));
console.log('  ' + OK.length + ' OK, ' + BAD.length + ' ZLE');
if (BAD.length) { BAD.forEach(b => console.log('  !! ' + b)); }
console.log('='.repeat(74));
ws.close();
process.exit(BAD.length ? 1 : 0);
