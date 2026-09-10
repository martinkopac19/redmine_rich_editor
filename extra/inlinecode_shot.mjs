/* Screenshot: ako vyzera inline code v editore (pomocka, nie test).
 *   node extra/inlinecode_shot.mjs <base> <login> <heslo> <issueId> <outPng> [port]
 */
const [BASE, LOGIN, PASS, ISSUE, OUT, PORT = '9381'] = process.argv.slice(2);
const fs = await import('node:fs');
const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => { ws.onopen = r; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
async function waitFor(x, l, ms = 25000) { const u = Date.now() + ms; for (;;) { try { if (await ev(x)) return true; } catch (e) {} if (Date.now() > u) throw new Error('timeout: ' + l); await sleep(250); } }
const key = async (k, code) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code });
  await sleep(45);
};
const typeText = async s => { for (const c of s) await key(c, 'Key' + (/[a-z]/i.test(c) ? c.toUpperCase() : '')); };
const J = s => JSON.stringify(s);
const PM = `document.querySelector('.re-comment-box .ProseMirror')`;

await send('Page.enable');
await send('Page.navigate', { url: BASE + '/login?nosso=1' });
await sleep(3000);
if (await ev(`!!document.getElementById('username')`)) {
  await ev(`(function(){document.getElementById('username').value=${J(LOGIN)};document.getElementById('password').value=${J(PASS)};document.getElementById('login-form').querySelector('input[type=submit]').click();return 1;})()`);
  await sleep(3500);
}
await send('Page.navigate', { url: BASE + '/issues/' + ISSUE });
await waitFor('document.readyState === "complete"', 'detail');
await sleep(1500);
await ev(`sessionStorage.removeItem('re.draft.notes.${ISSUE}')`);

/* Text sa vklada priamo do editora cez TipTap, aby screenshot vznikol na jeden
 * krok — o spravnost aplikovania sa stara inlinecode_cdp_test.mjs. */
await ev(`(function(){
  var pm = ${PM};
  var ed = pm.closest('.re-editor');
  var t = document.getElementById('issue_notes');
  t.value = 'Bezny text, potom \`inline code\` a za nim pokracovanie vety.';
  t.dispatchEvent(new Event('re:resync'));
  pm.scrollIntoView({block: 'center'});
  return 1;
})()`);
await sleep(1200);

const box = await ev(`(function(){
  var b = document.querySelector('.re-comment-box');
  var r = b.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.left + window.scrollX) - 8, y: Math.round(r.top + window.scrollY) - 8,
                          width: Math.round(r.width) + 16, height: Math.round(r.height) + 16 });
})()`);
const clip = JSON.parse(box);
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('ulozene: ' + OUT + '  ' + JSON.stringify(clip));
console.log('v editore je <code>: ' + await ev(`!!${PM}.querySelector('code')`));
ws.close();
