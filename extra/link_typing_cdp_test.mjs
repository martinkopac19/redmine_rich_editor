/* Písanie za odkazom nepredlžuje odkaz (v0.18.4).
 *
 * Rozšírenie Link má `inclusive = autolink`, takže všetko napísané hneď za vloženou URL padalo do
 * odkazu. Popisok vložený cez Ctrl+K sa ale prepisuje písaním a celý musí ostať odkazom.
 * Test nič neukladá: píše sa do popisu na formulári novej úlohy a na konci sa pole vyprázdni.
 *
 *   node extra/link_typing_cdp_test.mjs <base> <login> <heslo> <projekt> [port]
 */
const [BASE, LOGIN, PASS, PROJECT, PORT = '9401'] = process.argv.slice(2);
if (!PROJECT) {
  console.error('pouzitie: node link_typing_cdp_test.mjs <base> <login> <heslo> <projekt> [port]');
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

const PM = `document.querySelector('.re-editor .ProseMirror')`;
async function type(text) {
  for (const ch of text) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
  }
  await sleep(200);
}
async function key(k, code, vk, modifiers = 0) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
  await sleep(200);
}
async function reset() {
  await ev(`(function(){document.getElementById('issue_description').value='';return 1})()`);
  await sleep(300);
  await ev(`(function(){${PM}.editor.commands.focus('end');return 1})()`);
  await sleep(200);
}
async function paste(text) {
  await ev(`(function(){var dt=new DataTransfer();dt.setData('text/plain',${J(text)});
    ${PM}.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));return 1})()`);
  await sleep(300);
}
const links = () => ev(`[].map.call(${PM}.querySelectorAll('a'), function(a){return a.textContent})`);
const text = () => ev(`${PM}.textContent`);

console.log('='.repeat(86));
console.log('  rich_editor — písanie za odkazom nepredlžuje odkaz');
console.log('='.repeat(86));
await send('Page.enable');
await nav(BASE + '/login?nosso=1');
if (await ev(`!!document.getElementById('username')`)) {
  await ev(`(function(){document.getElementById('username').value=${J(LOGIN)};document.getElementById('password').value=${J(PASS)};document.getElementById('login-form').querySelector('input[type=submit]').click();return 1;})()`);
  await waitFor(`!!document.querySelector('#loggedas')`, 'prihlasenie');
}
await nav(BASE + '/projects/' + PROJECT + '/issues/new');
await waitFor(`!!document.querySelector('#issue_description') && !!${PM} && !!${PM}.editor`, 'editor popisu');

const URL = 'https://redmine.previo.info/issues/57397';

// 1) Martinov prípad: vložená URL, za ňou medzera a text
await reset();
await paste(URL);
check('vložená URL je odkaz', await links(), [URL]);
await type(' a dalsi text');
check('text za medzerou nie je v odkaze', await links(), [URL]);
check('text je za odkazom', await text(), URL + ' a dalsi text');

// 2) písanie hneď za URL bez medzery
await reset();
await paste(URL);
await type('abc');
check('text hneď za URL (bez medzery) nie je v odkaze', await links(), [URL]);
await type(' x');
check('ani po medzere ho autolink nepribalí', await links(), [URL]);

// 3) URL napísaná ručne
await reset();
await type('Pozri https://example.com hned');
check('ručne napísaná URL je odkaz, text za ňou nie', await links(), ['https://example.com']);

// 4) dialóg odkazu bez výberu: popisok sa prepíše písaním a celý ostane odkazom.
// Skutočné Ctrl+K bez výberu zachytí paleta príkazov, preto sa volá priamo keymap editora.
await reset();
await type('Tu je ');
await ev(`(function(){var v=${PM}.editor.view;return v.someProp('handleKeyDown',function(f){return f(v,new KeyboardEvent('keydown',{key:'k',code:'KeyK',ctrlKey:true}))})})()`);
await waitFor(`!!document.querySelector('.re-link-dialog .re-link-input') && document.querySelector('.re-link-dialog').style.display !== 'none'`, 'dialog odkazu');
await ev(`(function(){var i=document.querySelector('.re-link-dialog .re-link-input');i.value=${J(URL)};
  i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));return 1})()`);
await sleep(400);
await type('navod');
check('prepísaný popisok je celý odkaz', await links(), ['navod']);
check('href popisku', await ev(`${PM}.querySelector('a').getAttribute('href')`), URL);

// 5) po posune kurzora sa za popiskom už píše obyčajný text
await key('ArrowLeft', 'ArrowLeft', 37);
await key('ArrowRight', 'ArrowRight', 39);
await type('X');
check('po posune kurzora písanie odkaz nepredlžuje', await links(), ['navod']);
check('text popisku a za ním', await text(), 'Tu je navodX');

await ev(`(function(){document.getElementById('issue_description').value='';try{localStorage.clear()}catch(e){}return 1})()`);

console.log('\n' + '='.repeat(86));
console.log(`  ${OK.length} OK, ${BAD.length} ZLE`);
ws.close();
process.exit(BAD.length ? 1 : 0);
