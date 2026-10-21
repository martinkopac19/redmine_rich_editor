/* Automatický preklad prehliadača nesmie uložiť preložený názov ani popis (#57890).
 * Chrome preklad simulujeme tak, ako ho robí: text v DOM nahradí <font> prvkami
 * a na <html> dá triedu `translated-ltr`. Potom sa odíde zo stránky (pagehide → beacon)
 * a natívne sa odošle formulár Upraviť. Na konci overí, že bežná úprava názvu sa stále uloží.
 * Výsledok v DB kontroluje volajúci — test vypíše, čo má platiť.
 *
 *   node extra/translate_guard_cdp_test.mjs <base> <login> <heslo> <issue_id> [port]
 */
const [BASE, LOGIN, PASS, ISSUE, PORT = '9401'] = process.argv.slice(2);
if (!ISSUE) { console.error('pouzitie: node translate_guard_cdp_test.mjs <base> <login> <heslo> <issue_id> [port]'); process.exit(2); }
const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map(); let posts = 0;
const send = (m, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Network.requestWillBeSent' && m.params.request.method === 'POST' && new RegExp('/issues/' + ISSUE + '($|\\?)').test(m.params.request.url)) posts++;
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
  for (;;) { try { if (await ev(expr)) return true; } catch (e) {} if (Date.now() > until) throw new Error('timeout: ' + label); await sleep(150); }
}
async function nav(url) { await send('Page.navigate', { url }); await waitFor('document.readyState === "complete"', 'nacitanie'); await sleep(1500); }
const OK = []; const BAD = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  (ok ? OK : BAD).push(label);
  console.log('  ' + label.padEnd(64) + (ok ? 'OK' : '!! ZLE (' + JSON.stringify(got) + ', cakalo sa ' + JSON.stringify(want) + ')'));
}

await send('Page.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await nav(BASE + '/login');
if (await ev('!!document.getElementById("username")')) {
  await ev(`document.getElementById('username').value=${JSON.stringify(LOGIN)};document.getElementById('password').value=${JSON.stringify(PASS)};document.querySelector('#login-form form').submit();true`);
  await sleep(2500);
}
const URL_ = BASE + '/issues/' + ISSUE;
const TITLE = `document.querySelector('.re-title-edit')`;
const DESC = `document.getElementById('issue_description')._reEditor`;
const state = () => ev(`({ note: !!document.querySelector('.re-translated-note'),
  titleEditable: ${TITLE}.getAttribute('contenteditable'), descEditable: ${DESC}.isEditable })`);
// preklad tak, ako ho robí Google Translate: text → <font><font>preklad</font></font>
const fontify = (sel, text) => `(function(){var el=${sel}; var t=document.createTreeWalker(el,NodeFilter.SHOW_TEXT).nextNode();
  if(!t) return false; var f=document.createElement('font'); f.style.verticalAlign='inherit'; var g=document.createElement('font');
  g.style.verticalAlign='inherit'; g.textContent=${JSON.stringify(text)}; f.appendChild(g); t.parentNode.replaceChild(f,t); return true;})()`;

await nav(URL_);
await waitFor(`!!${TITLE} && !!${DESC}`, 'editory');
const orig = await ev(`({ title: ${TITLE}.textContent.trim(), desc: document.getElementById('issue_description').value })`);
console.log('pôvodný názov: ' + orig.title);
check('na začiatku sa dá upravovať a nie je upozornenie', await state(), { note: false, titleEditable: 'true', descEditable: true });

console.log('1) preklad bez triedy na <html> (len <font> v názve a popise)');
await ev(fontify(TITLE, 'PRELOZENY NAZOV'));
await ev(fontify(`document.querySelector('.re-editor .ProseMirror')`, 'PRELOZENY POPIS '));
await sleep(600);
check('zobrazí sa upozornenie, názov ani popis sa nedajú upravovať', await state(), { note: true, titleEditable: 'false', descEditable: false });
posts = 0;
await ev(`${TITLE}.focus(), ${TITLE}.blur(), true`);
await sleep(11000); // dlhšie ako idle poistka autosave
check('po kliknutí do názvu a 11 s čakania nič neodišlo', posts, 0);
await nav(URL_); // odchod zo stránky → pagehide/beacon
check('ani pri odchode zo stránky', posts, 0);

console.log('2) preklad Chrome (trieda translated-ltr): prekladá sa len kópia, editory nie');
await waitFor(`!!${TITLE} && !!${DESC}`, 'editory');
const TVIEW = `document.querySelector('.re-title-view')`;
const DVIEW = `document.querySelector('.re-desc-view')`;
const shown = () => ev(`(function(){function vis(e){return !!e && e.style.display !== 'none';}
  return { titleView: vis(${TVIEW}), titleEdit: vis(${TITLE}), descView: vis(${DVIEW}), descEdit: vis(document.querySelector('.re-editor:not(.re-desc-view)')) };})()`);
check('editory majú translate="no"', await ev(`[${TITLE}.getAttribute('translate'), ${DESC}.options.element.getAttribute('translate')]`), ['no', 'no']);
check('bez prekladu sú vidieť editory', await shown(), { titleView: false, titleEdit: true, descView: false, descEdit: true });
posts = 0;
await ev(`document.documentElement.classList.add('translated-ltr'), true`);
await sleep(300);
check('po preklade sú vidieť kópie na čítanie', await shown(), { titleView: true, titleEdit: false, descView: true, descEdit: false });
check('kópie prehliadač prekladať smie', await ev(`[${TVIEW}.textContent.trim() === ${JSON.stringify(orig.title)}, !${DVIEW}.querySelector('[translate="no"]')]`), [true, true]);
await ev(fontify(TVIEW, 'PRELOZENY NAZOV 2'));
await ev(fontify(`${DVIEW}.firstElementChild`, 'PRELOZENY POPIS 2 '));
await sleep(600);
check('preklad kópie nezamkne úpravy (žiadne upozornenie)', (await state()).note, false);
check('editory ostali s pôvodným textom', await ev(`[${TITLE}.textContent.trim() === ${JSON.stringify(orig.title)}, ${DESC}.view.dom.textContent.indexOf('PRELOZENY') === -1]`), [true, true]);
const prio = await ev(`(function(){var s=document.getElementById('issue_priority_id'); var o=Array.from(s.options).find(function(x){return !x.selected && x.value;});
  var old=s.value; s.value=o.value; return {old:old, now:o.value};})()`);
await ev(`(function(){var f=document.getElementById('issue-form'); var b=f.querySelector('input[type=submit][name=commit]')||f.querySelector('input[type=submit]'); b.click(); return true;})()`);
await sleep(3500);
console.log('PRIORITY ' + JSON.stringify(prio) + ' (natívne Potvrdiť počas prekladu — popis a názov sa nesmú zmeniť)');

console.log('2b) kliknutie do preloženej kópie zapne úpravu s pôvodným textom');
await nav(URL_);
await waitFor(`!!${TITLE} && !!${DESC}`, 'editory');
await ev(`document.documentElement.classList.add('translated-ltr'), true`);
await sleep(300);
await ev(fontify(TVIEW, 'PRELOZENY NAZOV 3'));
await ev(`${TVIEW}.dispatchEvent(new MouseEvent('click',{bubbles:true})), true`);
check('klik do názvu: editovateľný názov s pôvodným textom', [(await shown()).titleEdit, await ev(`${TITLE}.textContent.trim()`)], [true, orig.title]);
await ev(`${TITLE}.blur(), true`);
await sleep(300);
check('po odchode z poľa sa vráti preložená kópia', (await shown()).titleView, true);
await ev(`(function(){var v=${DVIEW}.getBoundingClientRect(); ${DVIEW}.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:v.left+20,clientY:v.top+10})); return true;})()`);
await sleep(300);
check('klik do popisu: editor s pôvodným textom má fokus', [(await shown()).descEdit, await ev(`${DESC}.isFocused`)], [true, true]);
await ev(`document.documentElement.classList.remove('translated-ltr'), true`);
await sleep(300);
check('vypnutie prekladu vráti editory', await shown(), { titleView: false, titleEdit: true, descView: false, descEdit: true });
check('celý čas sa nič neuložilo (okrem natívneho Potvrdiť)', posts, 1);

console.log('3) bez prekladu sa názov ukladá ako doteraz');
await nav(URL_);
await waitFor(`!!${TITLE}`, 'nazov');
await ev(`(function(){var el=${TITLE}; el.focus(); document.getSelection().selectAllChildren(el); document.getSelection().collapseToEnd();
  document.execCommand('insertText', false, ' X'); el.blur(); return true;})()`);
// v headless okne bez fokusu nemusí prísť blur → uloží až idle poistka (10 s), preto čakáme dlhšie
const serverTitle = () => ev(`fetch(location.pathname,{cache:'no-store'}).then(function(r){return r.text();})
  .then(function(t){return new DOMParser().parseFromString(t,'text/html').querySelector('.subject h3').textContent.trim();})`);
async function untilServer(pred, ms = 16000) {
  const until = Date.now() + ms; let t;
  for (;;) { t = await serverTitle(); if (pred(t) || Date.now() > until) return t; await sleep(1000); }
}
check('úprava názvu sa uložila', / X$/.test(await untilServer(t => / X$/.test(t))), true);
// vrátenie pôvodného názvu
await nav(URL_);
await waitFor(`!!${TITLE}`, 'nazov');
await ev(`(function(){var el=${TITLE}; el.focus(); document.getSelection().selectAllChildren(el);
  document.execCommand('insertText', false, ${JSON.stringify(orig.title)}); el.blur(); return true;})()`);
check('pôvodný názov je späť', await untilServer(t => t === orig.title), orig.title);
await nav('about:blank');
console.log('ORIG ' + JSON.stringify(orig.title));
console.log(`\n${OK.length} OK, ${BAD.length} ZLE`);
process.exit(BAD.length ? 1 : 0);
