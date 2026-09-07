/* Meranie: co sa stane s upravou popisu, ked clovek hned po dopisani stlaci refresh.
 *
 * Napise do ziveho editora text SKUTOCNYMI klavesami, po `delay` ms spusti reload
 * a potom precita, co je v DOM po nacitani. Realny stav v DB si volajuci overi sam
 * (rails runner) — tento skript hlasi len to, co vidi prehliadac, plus ci pri odchode
 * odisla nejaka poziadavka na server a s akym vysledkom.
 *
 *   node extra/live_reload_probe.mjs <base> <login> <heslo> <issueId> <delayMs> <port>
 */
const [BASE, LOGIN, PASS, ISSUE, DELAY = '1000', PORT = '9345'] = process.argv.slice(2);

const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const net = [];
const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Network.requestWillBeSent' && m.params.request.method !== 'GET') {
    net.push({ t: Date.now(), kind: 'REQ ' + m.params.request.method + ' ' + m.params.request.url.replace(BASE, '') });
  }
  if (m.method === 'Network.responseReceived' && m.params.response.url.includes('/issues/')) {
    net.push({ t: Date.now(), kind: 'RESP ' + m.params.response.status + ' ' + m.params.response.url.replace(BASE, '') });
  }
  if (m.method === 'Network.loadingFailed') {
    net.push({ t: Date.now(), kind: 'FAILED ' + (m.params.errorText || '') + (m.params.canceled ? ' (canceled)' : '') });
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
  for (;;) {
    if (await evSafe(expr)) return true;
    if (Date.now() > until) throw new Error('timeout: ' + label);
    await sleep(200);
  }
}
async function evSafe(expr) { try { return await ev(expr); } catch (e) { return false; } }

async function typeReal(text) {
  for (const ch of text) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await sleep(30);
  }
}

await send('Page.enable');
await send('Network.enable');

await send('Page.navigate', { url: BASE + '/login?nosso=1' });
await sleep(2500);
if (await evSafe(`!!document.getElementById('username')`)) {
  await ev(`(function(){document.getElementById('username').value=${JSON.stringify(LOGIN)};document.getElementById('password').value=${JSON.stringify(PASS)};document.getElementById('login-form').querySelector('input[type=submit]').click();return 1;})()`);
  await sleep(3000);
}

await send('Page.navigate', { url: BASE + '/issues/' + ISSUE });
await waitFor(`!!document.querySelector('.re-editor .ProseMirror')`, 'zivy editor na popise');
await sleep(600);

const marker = 'ZMENA' + Date.now();
// kurzor do editora popisu a na konec textu
await ev(`(function(){
  var pm = document.querySelector('.re-editor .ProseMirror');
  pm.focus();
  var r = document.createRange();
  r.selectNodeContents(pm);
  r.collapse(false);
  var s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  return true;
})()`);
await typeReal(' ' + marker);

const typedAt = Date.now();
console.log('napisane:', marker, '| v textarei:', await ev(`(document.getElementById('issue_description')||{}).value`));
console.log('cakam ' + DELAY + ' ms a refreshujem (bez kliknutia mimo editor, teda bez blur)');
await sleep(Number(DELAY));

net.length = 0;
await ev(`location.reload()`);
await sleep(6000);
await waitFor(`document.readyState === "complete"`, 'reload');
await sleep(1500);

const shown = await ev(`(function(){
  var ta = document.getElementById('issue_description');
  var wiki = document.getElementById('issue_description_wiki');
  return JSON.stringify({
    textarea: ta ? ta.value : null,
    rendered: wiki ? wiki.textContent.trim().slice(0, 120) : null
  });
})()`);
const s = JSON.parse(shown);
console.log('\npo reloade textarea:', JSON.stringify(s.textarea));
console.log('obsahuje marker    :', String(s.textarea || '').includes(marker) ? 'ANO' : 'NIE');
console.log('\nsietova aktivita od refreshu (offset od dopisania):');
net.slice(0, 14).forEach(r => console.log('  +' + (r.t - typedAt) + 'ms ' + r.kind));
if (!net.length) { console.log('  (ziadna poziadavka okrem GET)'); }
console.log('\nMARKER=' + marker);
ws.close();
process.exit(0);
