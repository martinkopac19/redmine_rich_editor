/* Vložený obrázok (Ctrl+V) sa v editore komentára ukáže HNEĎ, ešte kým sa nahráva.
 * Predtým sa ukázal až po dokončení uploadu — pri väčšom screenshote to trvalo sekundu-dve,
 * človek si myslel, že vloženie nezabralo, stlačil Ctrl+V znova a obrázok bol v komentári 3×.
 * Upload test podrží 3 s (CDP Fetch), potom ho pustí; druhé vloženie nechá zlyhať.
 * Komentár NEODOSIELA — na konci vyčistí editor aj koncept.
 *
 *   node extra/paste_image_feedback_cdp_test.mjs <base> <login> <heslo> <issue_id> [port]
 */
const [BASE, LOGIN, PASS, ISSUE, PORT = '9401'] = process.argv.slice(2);
if (!ISSUE) { console.error('pouzitie: node paste_image_feedback_cdp_test.mjs <base> <login> <heslo> <issue_id> [port]'); process.exit(2); }
const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map();
let uploadMode = 'hold'; let uploads = 0;
const send = (m, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Page.javascriptDialogOpening') ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
  if (m.method === 'Fetch.requestPaused') {
    uploads++;
    const rid = m.params.requestId;
    if (uploadMode === 'fail') ws.send(JSON.stringify({ id: ++id, method: 'Fetch.failRequest', params: { requestId: rid, errorReason: 'Failed' } }));
    else setTimeout(() => ws.send(JSON.stringify({ id: ++id, method: 'Fetch.continueRequest', params: { requestId: rid } })), 3000);
  }
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
async function nav(url) { await send('Page.navigate', { url }); await waitFor('document.readyState === "complete"', 'nacitanie'); await sleep(1300); }
const OK = []; const BAD = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  (ok ? OK : BAD).push(label);
  console.log('  ' + label.padEnd(66) + (ok ? 'OK' : '!! ZLE (' + JSON.stringify(got) + ', cakalo sa ' + JSON.stringify(want) + ')'));
}

await send('Page.enable');
await nav(BASE + '/login');
if (await ev('!!document.getElementById("username")')) {
  await ev(`document.getElementById('username').value=${JSON.stringify(LOGIN)};document.getElementById('password').value=${JSON.stringify(PASS)};document.querySelector('#login-form form').submit();true`);
  await sleep(2500);
}
// koncept komentára z predošlého behu by sa obnovil do editora a pokazil počty
await nav(BASE + '/issues/' + ISSUE);
const clearDraft = () => ev(`(function(){var ta=document.getElementById('issue_notes'); if (ta && ta._reEditor) ta._reEditor.commands.clearContent(true); if (ta) ta.value='';
  Object.keys(sessionStorage).forEach(function(k){ if(k.indexOf('re.draft.notes.')===0) sessionStorage.removeItem(k); }); return true;})()`);
await clearDraft(); await sleep(1500); await clearDraft();
await nav(BASE + '/issues/' + ISSUE);
await waitFor(`!!document.querySelector('.re-comment-box .ProseMirror')`, 'editor komentara');
check('editor komentára je na začiatku prázdny', await ev(`document.querySelectorAll('.re-comment-box .ProseMirror img[data-filename]').length`), 0);
await send('Fetch.enable', { patterns: [{ urlPattern: '*uploads.js*', requestStage: 'Request' }] });

const PM = `document.querySelector('.re-comment-box .ProseMirror')`;
const TA = `document.getElementById('issue_notes')`;
const state = () => ev(`(function(){var pm=${PM};var imgs=pm.querySelectorAll('img[data-filename]');return {
  imgs: imgs.length, uploading: pm.querySelectorAll('img[data-re-uploading]').length,
  md: new Set(${TA}.value.match(/clipboard-[0-9]{12}-[a-z0-9]{5}\.png/g) || []).size,
  tokens: document.querySelectorAll('input[name^="attachments[re"][name$="[token]"]').length,
  active: document.querySelectorAll('input[name^="attachments[re"][name$="[token]"]:not([disabled])').length }})()`);
const paste = () => ev(`(async function(){
  var c=document.createElement('canvas'); c.width=300; c.height=200; var g=c.getContext('2d');
  g.fillStyle='#c33'; g.fillRect(0,0,300,200); g.fillStyle='#fff'; g.fillText('paste '+Date.now(),20,100);
  var blob=await new Promise(function(r){c.toBlob(r,'image/png');});
  var dt=new DataTransfer(); dt.items.add(new File([blob],'image.png',{type:'image/png'}));
  var pm=${PM}; pm.focus();
  pm.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  return true; })()`);

console.log('1) vloženie, upload trvá 3 s');
const before = await state();
uploadMode = 'hold';
await paste();
await sleep(500);
const early = await state();
check('obrázok je v editore hneď (0,5 s), kým sa nahráva', early.imgs - before.imgs, 1);
check('je označený ako „nahráva sa"', early.uploading, 1);
await waitFor(`document.querySelectorAll('input[name^="attachments[re"][name$="[token]"]').length > ${before.tokens} && ${PM}.querySelectorAll('img[data-re-uploading]').length === 0`, 'koniec uploadu', 15000).catch(e => console.log('  ' + e.message));
await sleep(300);
const done = await state();
check('po nahratí stále práve jeden nový obrázok', done.imgs - before.imgs, 1);
check('označenie „nahráva sa" zmizlo', done.uploading, 0);
check('v texte komentára je odkaz na súbor', done.md - before.md, 1);
check('formulár má token prílohy', done.tokens - before.tokens, 1);
check('upload prebehol raz', uploads, 1);

console.log('2) vloženie, upload zlyhá');
uploadMode = 'fail';
await paste();
await sleep(1500);
const failed = await state();
check('po chybe obrázok z editora zmizne', failed.imgs, done.imgs);
check('po chybe nezostal odkaz v texte', failed.md, done.md);
check('po chybe nepribudol token', failed.tokens, done.tokens);

console.log('3) zmazaný obrázok sa pri odoslaní nepripojí (Richard: 3 vloženia, 1 obrázok v texte, 3 prílohy)');
const ED = `document.getElementById('issue_notes')._reEditor`;
await ev(`${ED}.commands.clearContent(true), true`);
await sleep(300);
const cleared = await state();
check('po zmazaní obrázka v editore nie je žiadny', cleared.imgs, 0);
check('jeho príloha sa pri odoslaní nepripojí', cleared.active, 0);
await ev(`${ED}.commands.undo(), true`);
await sleep(300);
const undone = await state();
check('Ctrl+Z vráti obrázok', undone.imgs, 1);
check('...aj jeho prílohu', undone.active, 1);
await ev(`${ED}.commands.clearContent(true), true`);
uploadMode = 'hold';
await paste();
await waitFor(`document.querySelectorAll('input[name^="attachments[re"][name$="[token]"]').length > ${undone.tokens}`, 'druhy upload', 15000);
await sleep(300);
const again = await state();
check('po opätovnom vložení je v editore jeden obrázok', again.imgs, 1);
check('pripojí sa len jedna príloha', again.active, 1);

// upratanie: prázdny editor, žiadny koncept
await send('Fetch.disable');
await clearDraft(); await sleep(1500); await clearDraft();
await nav('about:blank');
console.log(`\n${OK.length} OK, ${BAD.length} ZLE`);
process.exit(BAD.length ? 1 : 0);
