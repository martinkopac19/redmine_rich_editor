/* Test emotikonov a emoji palety cez CDP (Chrome DevTools Protocol).
 *
 * PREČO CEZ CDP: paletu nespustí ani programové `handleTextInput`, ani
 * `document.execCommand("insertText")` — v headless prehliadači sa suggestion
 * plugin neaktivuje a test potom tvrdí „popup sa nezobrazil" úplne vždy, aj pre
 * `#123`, ktorého sa žiadna zmena netýkala. Skutočné klávesové udalosti sú
 * jediný spôsob, ako paletu overiť.
 *
 * Spustenie:
 *   1) vygeneruj prihlásenú stránku issue do /tmp/issue_show.html (postup je
 *      v hlavičke extra/savetest_browser.js)
 *   2) msedge --headless=new --disable-gpu --remote-debugging-port=9333  *        --user-data-dir=/tmp/cdpprofile --allow-file-access-from-files  *        "file:///C:/Users/marti/AppData/Local/Temp/issue_show.html" &
 *   3) node extra/emoticon_cdp_test.mjs
 *
 * Očakávané: pri `:O` `:D` `:P` `:)` sa paleta NEZOBRAZÍ a po medzere vznikne
 * emoji; pri `:fire` a `:sm` sa paleta zobrazí; `12:30` zostane nedotknuté.
 */
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

await sleep(3500);  // pockat na mount editora
const mounted = await evaluate('!!(document.querySelector("#issue_description") && document.querySelector("#issue_description")._reEditor)');
console.log('editor namountovany:', mounted);

async function typeReal(text) {
  await evaluate('(function(){var ed=document.querySelector("#issue_description")._reEditor; ed.commands.clearContent(true); ed.view.dom.focus(); return true;})()');
  for (const ch of text) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await sleep(60);
  }
  await sleep(250);
  const txt = await evaluate('document.querySelector("#issue_description")._reEditor.getText()');
  const pop = await evaluate('(function(){var b=document.querySelector(".re-slash"); return b ? b.textContent.trim().slice(0,45) : null;})()');
  return { txt, pop };
}

const cases = [':fire', ':dog', ':sm', ':O', ':D', ':P', ':)', ':O ', ':D ', ':) ', '12:30 '];
let fails = 0;
for (const c of cases) {
  const r = await typeReal(c);
  const esc = s => s == null ? 'NIE' : JSON.stringify(s).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[☀-➿️]/g, m => '<' + m.codePointAt(0).toString(16) + '>');
  console.log(`  ${JSON.stringify(c).padEnd(10)} text=${esc(r.txt).padEnd(22)} popup=${esc(r.pop)}`);
}
ws.close();
