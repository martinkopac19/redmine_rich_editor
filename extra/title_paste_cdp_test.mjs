/* Vloženie zo schránky do inline názvu vloží len čistý text — bez formátovania zdroja
 * (sivá kurzíva z názvu rodičovskej úlohy zostávala v názve až do obnovenia stránky).
 * Na konci vráti pôvodný názov, takže sa nič neuloží.
 *
 *   node extra/title_paste_cdp_test.mjs <base> <login> <heslo> <issue_id> [port]
 */
const [BASE, LOGIN, PASS, ISSUE, PORT = '9401'] = process.argv.slice(2);
if (!ISSUE) { console.error('pouzitie: node title_paste_cdp_test.mjs <base> <login> <heslo> <issue_id> [port]'); process.exit(2); }
const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map(); let posts = 0;
const send = (m, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Network.requestWillBeSent' && m.params.request.method === 'POST' && new RegExp('/issues/' + ISSUE + '($|\\?)').test(m.params.request.url)) posts++;
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
const OK = []; const BAD = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  (ok ? OK : BAD).push(label);
  console.log('  ' + label.padEnd(60) + (ok ? 'OK' : '!! ZLE (' + JSON.stringify(got) + ', cakalo sa ' + JSON.stringify(want) + ')'));
}

await send('Page.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE + '/login' }); await sleep(2500);
if (await ev('!!document.getElementById("username")')) {
  await ev(`document.getElementById('username').value=${JSON.stringify(LOGIN)};document.getElementById('password').value=${JSON.stringify(PASS)};document.querySelector('#login-form form').submit();true`);
  await sleep(2500);
}
await send('Page.navigate', { url: BASE + '/issues/' + ISSUE }); await sleep(3000);
const T = `document.querySelector('.re-title-edit')`;
await waitFor(`!!${T}`, 'nazov');
const orig = await ev(`${T}.textContent.trim()`);
posts = 0;
const paste = (html, text) => ev(`(function(){var el=${T}; el.focus(); document.getSelection().selectAllChildren(el);
  var dt=new DataTransfer(); dt.setData('text/html', ${JSON.stringify(html)}); dt.setData('text/plain', ${JSON.stringify(text)});
  el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); return true;})()`);
await paste('<span style="color:#999;font-style:italic;font-weight:400">Service Mapping: <b>Show</b> info</span>', 'Service Mapping: Show\ninfo');
await sleep(200);
check('po vložení je v názve len text, žiadne značky', await ev(`${T}.children.length`), 0);
check('text je na jednom riadku', await ev(`${T}.textContent`), 'Service Mapping: Show info');
check('skryté pole formulára má rovnaký text', await ev(`document.querySelector('input[name="issue[subject]"]').value`), 'Service Mapping: Show info');
// späť na pôvodný názov → nič na uloženie
await paste(orig, orig);
await ev(`${T}.blur(), true`);
await sleep(11000);
check('vrátením pôvodného názvu sa nič neuložilo', posts, 0);
await send('Page.navigate', { url: 'about:blank' });
console.log(`\n${OK.length} OK, ${BAD.length} ZLE`);
process.exit(BAD.length ? 1 : 0);
