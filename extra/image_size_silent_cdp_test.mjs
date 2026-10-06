/* Obrázok v popise na detaile issue (v0.18.0):
 *   - zmena veľkosti z lišty sa uloží POTICHU — bez záznamu v histórii (a teda bez notifikácie),
 *     a v texte popisu sa zmení len zápis obrázka,
 *   - tlačidlo „Otevřít" v lište, dvojklik a Ctrl+klik otvoria obrázok v novom okne.
 * Test na konci vráti veľkosť späť (to je tiež tichá zmena), takže popis ostane ako bol.
 *
 *   node extra/image_size_silent_cdp_test.mjs <base> <login> <heslo> <issue_id> [port]
 */
const [BASE, LOGIN, PASS, ISSUE, PORT = '9401'] = process.argv.slice(2);
if (!ISSUE) {
  console.error('pouzitie: node image_size_silent_cdp_test.mjs <base> <login> <heslo> <issue_id> [port]');
  process.exit(2);
}
const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  // „Opustiť stránku?" (rozpísaný koncept z iného testu) by navigáciu zablokoval navždy
  if (m.method === 'Page.javascriptDialogOpening') ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
};
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
// záznamy histórie + surový popis priamo zo servera: z čerstvo načítanej HTML stránky úlohy
// (REST API session cookie neberie — vráti 401 a prehliadač čaká na prihlasovacie okno)
const server = () => ev(`fetch('/issues/${ISSUE}',{credentials:'same-origin'}).then(r=>r.text()).then(function(h){
  var d=new DOMParser().parseFromString(h,'text/html');
  return {n:d.querySelectorAll('#history [id^="change-"]').length,d:(d.getElementById('issue_description')||{}).value};
})`);
const IMG = /\{\{\s*thumbnail\([^)]*\)\s*\}\}|!\[[^\]]*\]\([^)]*\)/g;
const strip = s => String(s).replace(/\r\n/g, '\n').replace(IMG, 'IMG');

async function click(sel, opts = {}) {
  const r = await ev(`(function(){var e=document.querySelector(${J(sel)});e.scrollIntoView({block:'center'});var b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()`);
  const mod = opts.ctrl ? 2 : 0;
  for (let c = 1; c <= (opts.count || 1); c++) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: c, modifiers: mod });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: c, modifiers: mod });
  }
  await sleep(300);
}
// čaká, kým server vráti popis, ktorý spĺňa podmienku (autosave beží s oneskorením po blur)
async function waitServer(ok, label) {
  const until = Date.now() + 15000;
  for (;;) { const r = await server(); if (ok(r)) return r; if (Date.now() > until) throw new Error('timeout: ' + label); await sleep(500); }
}

console.log('='.repeat(86));
console.log('  rich_editor — obrázok v popise: tichá zmena veľkosti, otvorenie v novom okne');
console.log('='.repeat(86));
await send('Page.enable');
await nav(BASE + '/login?nosso=1');
if (await ev(`!!document.getElementById('username')`)) {
  await ev(`(function(){document.getElementById('username').value=${J(LOGIN)};document.getElementById('password').value=${J(PASS)};document.getElementById('login-form').querySelector('input[type=submit]').click();return 1;})()`);
  await waitFor(`!!document.querySelector('#loggedas')`, 'prihlasenie');
}
await nav(BASE + '/issues/' + ISSUE);
const IMGSEL = '.re-live-desc .re-editor .ProseMirror img, .re-editor .ProseMirror img';
await waitFor(`!!document.querySelector(${J(IMGSEL)})`, 'obrazok v popise');
// window.open len zaznamenáme, nič sa reálne neotvára
await ev(`(function(){window.__opened=[];window.open=function(u){window.__opened.push(String(u));return null;};return 1})()`);

const s0 = await server();
console.log(`\n  uloha #${ISSUE}: ${s0.n} zaznamov historie`);

console.log('\n[1] otvorenie obrazka');
await click(IMGSEL);
check('klik ukáže lištu obrázka s „Otevřít"', await ev(`(function(){var b=document.querySelector('[data-re-act=img-open]');return !!b && b.offsetParent!==null})()`), true);
await ev(`document.querySelector('[data-re-act=img-open]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
const opened = await ev(`window.__opened[0] || ''`);
check('„Otevřít" otvorí stránku prílohy', /\/attachments\/\d+$/.test(opened), true);
await click(IMGSEL, { count: 2 });
check('dvojklik otvorí obrázok', await ev(`window.__opened.length`), 2);
await click(IMGSEL, { ctrl: true });
check('Ctrl+klik otvorí obrázok', await ev(`window.__opened.length`), 3);
await sleep(2500);
const s1 = await server();
check('otváranie nič neuložilo', [s1.n, s1.d], [s0.n, s0.d]);

console.log('\n[2] zmena z lišty (malý náhľad ↔ plná šírka)');
await click(IMGSEL);
// prepnutie režimu tam a späť vráti text presne (veľkosť náhľadu sa pri plnej šírke pamätá)
const dir = await ev(`document.querySelector(${J(IMGSEL)}).getAttribute('data-re-display') === 'thumb' ? 'img-full' : 'img-thumb'`);
const back = dir === 'img-full' ? 'img-thumb' : 'img-full';
await ev(`document.querySelector('[data-re-act=${dir}]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
await ev(`document.querySelector('.re-editor .ProseMirror').blur()`);
const s2 = await waitServer(r => r.d !== s0.d, 'ulozenie zmeny');
await sleep(1500);
const s2n = (await server()).n;
check('zmenil sa len zápis obrázka', strip(s2.d), strip(s0.d));
check('žiadny nový záznam v histórii', s2n, s0.n);

console.log('\n[3] návrat veľkosti');
await nav(BASE + '/issues/' + ISSUE);
await waitFor(`!!document.querySelector(${J(IMGSEL)})`, 'obrazok v popise');
await click(IMGSEL);
await ev(`document.querySelector('[data-re-act=${back}]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
await ev(`document.querySelector('.re-editor .ProseMirror').blur()`);
await waitServer(r => r.d === s0.d, 'navrat popisu');
await sleep(1500);
const s3 = await server();
check('popis je presne ako na začiatku', s3.d, s0.d);
check('stále žiadny nový záznam v histórii', s3.n, s0.n);

console.log('\n' + '='.repeat(86));
console.log(`  OK: ${OK.length}   ZLE: ${BAD.length}`);
process.exit(BAD.length ? 1 : 0);
