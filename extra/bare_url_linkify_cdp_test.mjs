/* Holé URL zo starého textu sú v editore klikateľné odkazy (v0.17.8).
 *
 * Popisy z pôvodného Redmine majú URL ako obyčajný text (`http://…` bez `<>`). Redmine ich pri
 * zobrazení prelinkuje sám, editor ich nechával ako text → v živom popise sa nedali otvoriť.
 * Test nič neukladá: text sa vloží do popisu na formulári novej úlohy (rovnaká cesta ako šablóna)
 * a na konci sa pole vyprázdni.
 *
 *   node extra/bare_url_linkify_cdp_test.mjs <base> <login> <heslo> <projekt> [port]
 */
const [BASE, LOGIN, PASS, PROJECT, PORT = '9401'] = process.argv.slice(2);
if (!PROJECT) {
  console.error('pouzitie: node bare_url_linkify_cdp_test.mjs <base> <login> <heslo> <projekt> [port]');
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

console.log('='.repeat(86));
console.log('  rich_editor — holé URL zo starého textu sú odkazy');
console.log('='.repeat(86));
await send('Page.enable');
await nav(BASE + '/login?nosso=1');
if (await ev(`!!document.getElementById('username')`)) {
  await ev(`(function(){document.getElementById('username').value=${J(LOGIN)};document.getElementById('password').value=${J(PASS)};document.getElementById('login-form').querySelector('input[type=submit]').click();return 1;})()`);
  await waitFor(`!!document.querySelector('#loggedas')`, 'prihlasenie');
}
await nav(BASE + '/projects/' + PROJECT + '/issues/new');
await waitFor(`!!document.querySelector('#issue_description') && !!document.querySelector('.re-editor .ProseMirror')`, 'editor popisu');

const MD = 'Endpoint http://scr.previo.cz/mk/shot.png a https://example.com/a?b=1, ' +
  'domena booking.com, mail jan@previo.cz, mailto:jan@previo.cz, ftp://x.cz, //x.cz, ' +
  '<https://autolink.cz>, [text](https://md.cz) a `http://kod.cz`';
await ev(`(function(){document.getElementById('issue_description').value=${J(MD)};return 1})()`);
await sleep(400);
const hrefs = await ev(`[].map.call(document.querySelectorAll('.re-editor .ProseMirror a'), function(a){return a.getAttribute('href')})`);
check('holé http:// a https:// URL sú odkazy', hrefs.filter(h => /scr\.previo|example\.com/.test(h)), ['http://scr.previo.cz/mk/shot.png', 'https://example.com/a?b=1']);
check('čiarka za URL nie je súčasť odkazu', hrefs.includes('https://example.com/a?b=1'), true);
check('booking.com bez http nie je odkaz', hrefs.some(h => /booking/.test(h)), false);
check('e-mail ani mailto: nie je odkaz', hrefs.some(h => /mailto|jan@/.test(h)), false);
check('ftp:// ani //x.cz nie je odkaz', hrefs.some(h => /x\.cz/.test(h)), false);
check('URL v kóde nie je odkaz', hrefs.some(h => /kod\.cz/.test(h)), false);
check('<autolink> a [text](url) ostávajú odkazmi', hrefs.filter(h => /autolink|md\.cz/.test(h)), ['https://autolink.cz', 'https://md.cz']);
check('spolu presne 4 odkazy', hrefs.length, 4);

// klik na holú URL ju otvorí do nového panela
await ev(`window.__opened=[];window.open=function(u,t){window.__opened.push([u,t]);return null};1`);
const r = await ev(`(function(){var a=[].find.call(document.querySelectorAll('.re-editor .ProseMirror a'),function(a){return /scr\\.previo/.test(a.href)});a.scrollIntoView({block:'center'});var b=a.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
await sleep(300);
for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
await sleep(500);
check('klik na holú URL ju otvorí do nového panela', await ev(`window.__opened`), [['http://scr.previo.cz/mk/shot.png', '_blank']]);

await ev(`(function(){document.getElementById('issue_description').value='';try{localStorage.clear()}catch(e){}return 1})()`);

console.log('\n' + '='.repeat(86));
console.log(`  ${OK.length} OK, ${BAD.length} ZLE`);
ws.close();
process.exit(BAD.length ? 1 : 0);
