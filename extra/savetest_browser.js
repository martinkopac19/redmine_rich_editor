/* Test auto-save v prehliadaci: JEDNA suvisla uprava = JEDNO ulozenie.
 *
 * Preco takto a nie ako bezny unit test: casovace, fokus a blur sa daju overit len v realnom
 * DOM s namountovanym editorom. POSTy sa zachytavaju stubom `fetch`, takze na server NIC
 * neodchadza a ziadny zaznam v historii nevznikne.
 *
 * Spustenie (Windows, Git Bash) — vygeneruj prihlasenu stranku detailu issue, vloz tento
 * skript a nechaj ju prejst v headless prehliadaci:
 *
 *   # 1) prihlasena stranka do /tmp/issue_show.html (runner obide login)
 *   cat > /tmp/dump.rb <<'RUBY'
 *   admin = User.active.where(admin: true).first
 *   ApplicationController.prepend(Module.new { define_method(:user_setup) { User.current = admin } })
 *   sess = ActionDispatch::Integration::Session.new(Rails.application)
 *   i = Issue.order(id: :desc).first
 *   sess.get "/issues/#{i.id}"
 *   b = sess.response.body.dup
 *   b.gsub!('href="/', 'href="http://localhost:3080/'); b.gsub!('src="/', 'src="http://localhost:3080/')
 *   b.gsub!('action="/', 'action="http://localhost:3080/')
 *   File.write('/tmp/issue_show.html', b)
 *   RUBY
 *   docker compose exec -T --user redmine -e SECRET_KEY_BASE=... redmine \
 *     bin/rails runner -e production - < /tmp/dump.rb
 *   docker compose exec -T --user redmine redmine cat /tmp/issue_show.html > /tmp/issue_show.html
 *
 *   # 2) vloz tento subor ako <script src> a spusti Edge headless
 *   EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
 *   "$EDGE" --headless --disable-gpu --window-size=1600,1000 --virtual-time-budget=45000 \
 *     --allow-file-access-from-files --dump-dom "file:///.../savetest.html" | grep -o "<title>MERANIE[^<]*"
 *
 * Vysledok ide do `document.title`, lebo Edge headless navratovu hodnotu JS inak nevyda.
 */
   Fokus sa prestavuje priamo na DOM (`view.dom.focus/blur`) — `commands.focus()` v headless
   prehliadači DOM fokus nemusí naozaj presunúť a editor potom neemitne blur. */
(function () {
  var R = [];
  var posts = [];
  function ok(name, actual, expected) {
    var pass = actual === expected;
    R.push((pass ? 'OK ' : 'FAIL ') + name + (pass ? '' : '[bolo=' + actual + ' cakal=' + expected + ']'));
  }
  function done() { document.title = 'MERANIE ' + R.join(' | '); }

  // odpoveď musí obsahovať lock_version input, inak si autosave vypýta ďalší request
  var FAKE = '<input autocomplete="off" type="hidden" value="99" name="issue[lock_version]" />';

  var realFetch = window.fetch;
  window.fetch = function (url, opt) {
    var body = opt && opt.body ? String(opt.body) : '';
    if (opt && opt.method === 'POST' && body.indexOf('_method=patch') >= 0) {
      posts.push(body);
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(FAKE); } });
    }
    return realFetch.apply(this, arguments);
  };
  navigator.sendBeacon = function () { posts.push('BEACON'); return true; };

  var ed, ta;
  function count() { return posts.length; }
  function reset() { posts = []; }
  function after(ms, fn) { setTimeout(fn, ms); }

  window.addEventListener('load', function () {
    setTimeout(function () {
      try { start(); } catch (e) { document.title = 'MERANIE VYNIMKA ' + e.message + ' | ' + R.join(' | '); }
    }, 3000);
  });

  function start() {
    ta = document.querySelector('#issue_description');
    ed = ta && ta._reEditor;
    ok('editor namountovany', !!ed, true);
    if (!ed) return done();

    // A) fokus a blur BEZ zmeny → nesmie sa uložiť nič
    reset();
    ed.view.dom.focus();
    ed.view.dom.blur();
    after(1200, caseB);
  }

  function caseB() {
    ok('A: fokus+blur bez zmeny neuklada', count(), 0);

    // B) zmena + odchod z poľa → práve jedno uloženie
    reset();
    ed.view.dom.focus();
    ed.commands.setContent('Prvy text ' + Date.now(), true);
    ed.view.dom.blur();
    after(1500, caseC);
  }

  function caseC() {
    ok('B: zmena + blur = jedno ulozenie', count(), 1);
    ok('B: POST nesie re_live=1', !!(posts[0] && posts[0].indexOf('re_live=1') >= 0), true);

    // C) dve rýchle zmeny za sebou (obrázok → prepnutie na odkaz) → stále jedno uloženie
    reset();
    ed.view.dom.focus();
    ed.commands.setContent('Krok jeden ' + Date.now(), true);
    setTimeout(function () {
      ed.commands.setContent('Krok dva ' + Date.now(), true);
      ed.view.dom.blur();
      after(1500, caseD);
    }, 300);
  }

  function caseD() {
    ok('C: obrazok + preklik na odkaz = jedno ulozenie', count(), 1);

    // D) písanie bez odchodu z poľa → poistka po 10 s uloží raz
    reset();
    ed.view.dom.focus();
    ed.commands.setContent('Pisem a neodchadzam ' + Date.now(), true);
    after(12000, caseE);
  }

  function caseE() {
    ok('D: poistka po 10 s ulozi raz', count(), 1);

    // E) opakovaný blur bez ďalšej zmeny → už nič
    reset();
    ed.view.dom.focus();
    ed.view.dom.blur();
    after(1500, caseF);
  }

  function caseF() {
    ok('E: blur bez novej zmeny neuklada', count(), 0);

    // F) odchod zo stránky s neuloženou zmenou → beacon
    reset();
    ed.view.dom.focus();
    ed.commands.setContent('Nedokoncena veta ' + Date.now(), true);
    window.dispatchEvent(new Event('pagehide'));
    after(300, function () {
      ok('F: odchod zo stranky posle beacon', posts.indexOf('BEACON') >= 0, true);
      caseG();
    });
  }

  // G) zivy nazov sa musi zrkadlit do skryteho pola formulara, inak rucny Submit vrati stary nazov
  function caseG() {
    var h3 = document.querySelector('.subject h3.re-title-edit');
    var inp = document.querySelector('#issue-form input[name="issue[subject]"]');
    if (!h3 || !inp) { ok('G: zrkadlenie nazvu', 'chyba h3/input', 'ok'); return done(); }
    h3.textContent = 'Novy nazov ' + Date.now();
    h3.dispatchEvent(new Event('input', { bubbles: true }));
    ok('G: nazov je zrkadleny do formulara', inp.value, h3.textContent);

    // H) natívny Submit musí čakajúce uloženie ZRUŠIŤ, nie doposlať (inak druhý záznam)
    reset();
    ed.view.dom.focus();
    ed.commands.setContent('Este jedna zmena ' + Date.now(), true);
    document.getElementById('issue-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    after(2000, function () {
      ok('H: nativny Submit zrusi cakajuce ulozenie', count(), 0);
      done();
    });
  }
})();
