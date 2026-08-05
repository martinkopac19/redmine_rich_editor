/* F3 — live inline editovanie na detaile issue (auto-save cez AJAX existujúceho #issue-form).
   POZOR: toto je najviac naviazané na Redmine DOM (menej upgrade-safe) → všade fallback. */

function csrf() {
  var m = document.querySelector('meta[name="csrf-token"]');
  return m ? m.getAttribute('content') : '';
}
function issueForm() { return document.getElementById('issue-form'); }

// `lock_version` z HTML. POZOR na poradie atribútov: Rails renderuje
// `<input autocomplete="off" type="hidden" value="50" name="issue[lock_version]" …>`,
// teda `value` PRED `name` → naivný regex „name=… potom value=…" nikdy nesedel a lock_version
// sa po uložení neaktualizoval → druhé uloženie na tej istej stránke skončilo konfliktom.
function parseLockVersion(html) {
  var tag = /<input[^>]*name="issue\[lock_version\]"[^>]*>/i.exec(html || '');
  if (!tag) return null;
  var v = /value="(\d+)"/i.exec(tag[0]);
  return v ? v[1] : null;
}

// Redmine pri `ActiveRecord::StaleObjectError` vyrenderuje `edit` s `<div class="conflict">`
// (a prílohy odpojí) — BEZ `errorExplanation`. Bez tejto detekcie sa konflikt tvári ako úspech
// a komentár sa tiicho zahodí.
function isConflict(html) {
  return /class="conflict"/.test(html || '');
}

// Znovu prečítaj aktuálne lock_version priamo zo servera (po konflikte alebo keď sa nedá vyparsovať).
// `cache: 'no-store'` je dôležité: Redmine posiela ETag + `must-revalidate`, takže inak môže
// prehliadač vrátiť 304 a my by sme čítali STARÚ stránku.
function refreshLockVersion(form) {
  var action = form.getAttribute('action');
  return fetch(action, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  }).then(function (r) { return r.text(); }).then(function (t) {
    var lv = parseLockVersion(t);
    var lvEl = form.querySelector('input[name="issue[lock_version]"]');
    if (lv && lvEl) lvEl.value = lv;
    return lv;
  }).catch(function () { return null; });
}

// Auto-save čiastkových polí issue cez natívny update (_method=patch). Rieši lock_version aj konflikt.
export function autosave(fields, _retry) {
  var form = issueForm();
  if (!form) return Promise.reject(new Error('no #issue-form'));
  var action = form.getAttribute('action');
  var lvEl = form.querySelector('input[name="issue[lock_version]"]');
  var body = new URLSearchParams();
  body.append('_method', 'patch');
  body.append('authenticity_token', csrf());
  if (lvEl) body.append('issue[lock_version]', lvEl.value);
  Object.keys(fields).forEach(function (k) { body.append('issue[' + k + ']', fields[k] == null ? '' : fields[k]); });
  // čakajúce prílohy (drag&drop/paste) → priloží ich pri tomto uložení
  var attInputs = Array.prototype.slice.call(form.querySelectorAll('input[name^="attachments["]'));
  attInputs.forEach(function (inp) { body.append(inp.name, inp.value); });
  return fetch(action, {
    method: 'POST', credentials: 'same-origin',
    cache: 'no-store', // nech nás nedostihne 304 z prehliadačovej cache (ETag + must-revalidate)
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  }).then(function (r) {
    return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t }; });
  }).then(function (res) {
    // konflikt (niekto — často naše vlastné predchádzajúce uloženie — medzitým issue zmenil):
    // vytiahni aktuálne lock_version a skús RAZ znova, nech sa text nestratí
    if (isConflict(res.text)) {
      if (_retry) { res.success = false; res.conflict = true; return res; }
      return refreshLockVersion(form).then(function () { return autosave(fields, true); });
    }
    var lv = parseLockVersion(res.text);
    if (lv && lvEl) lvEl.value = lv;
    res.success = res.ok && !/id="errorExplanation"/.test(res.text);
    // ak sa lock_version z odpovede nedá prečítať, dotiahni ho — inak by ďalšie uloženie konfliktovalo
    if (res.success) {
      attInputs.forEach(function (inp) { if (inp.parentNode) inp.parentNode.removeChild(inp); });
      if (!lv) refreshLockVersion(form);
    }
    return res;
  });
}

// malý "Saving…/Saved/Failed" indikátor
function makeIndicator(host) {
  var ind = document.createElement('div');
  ind.className = 're-save-ind';
  host.appendChild(ind);
  return {
    saving: function () { ind.textContent = 'Saving…'; ind.className = 're-save-ind re-saving'; },
    saved: function () { ind.textContent = 'Saved'; ind.className = 're-save-ind re-saved'; setTimeout(function () { ind.textContent = ''; }, 1500); },
    failed: function () { ind.textContent = 'Save failed — use Edit to save manually'; ind.className = 're-save-ind re-error'; }
  };
}

// Debounced auto-save controller (blur + idle), bez zbytočného spamu journalov.
function autosaver(getFields, ind) {
  var timer, blurTimer, saving = false, again = false;
  function run() {
    if (saving) { again = true; return; }
    saving = true; ind.saving();
    autosave(getFields()).then(function (res) {
      saving = false;
      if (res.success) ind.saved(); else ind.failed();
      if (again) { again = false; run(); }
    }).catch(function () { saving = false; ind.failed(); });
  }
  return {
    idle: function () { clearTimeout(timer); timer = setTimeout(run, 2000); },
    onBlur: function () { clearTimeout(blurTimer); blurTimer = setTimeout(run, 700); },
    onFocus: function () { clearTimeout(blurTimer); }
  };
}

// LIVE NÁZOV: subject (.subject h3) urob inline editovateľný (contenteditable) + auto-save.
export function liveTitle() {
  if (!issueForm()) return; // formulár existuje len ak má user právo editovať
  var subject = document.querySelector('.subject[data-sticky-issue-header-target="original"]') ||
    document.querySelector('.subject');
  var el = subject && subject.querySelector('h3');
  if (!el || el.dataset.reTitle) return;
  el.dataset.reTitle = '1';
  el.setAttribute('contenteditable', 'true');
  el.setAttribute('spellcheck', 'false');
  el.classList.add('re-title-edit');

  var ind = makeIndicator(subject);
  var saver = autosaver(function () { return { subject: el.textContent.replace(/\s+/g, ' ').trim() }; }, ind);
  el.addEventListener('input', function () { saver.idle(); });
  el.addEventListener('focus', function () { saver.onFocus(); });
  el.addEventListener('blur', function () { saver.onBlur(); });
  el.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
  });
}

// LIVE POPIS: editor (rich) presuň na miesto renderovaného popisu, schovaj rendered, auto-save.
export function liveDescription(editor, textarea) {
  var wiki = document.getElementById('issue_description_wiki');
  var wrapper = editor.options && editor.options.element;
  if (!wiki || !wrapper) return;
  try {
    wiki.parentNode.insertBefore(wrapper, wiki);
    wiki.style.display = 'none';
    // skry zbytočný/mätúci pôvodný popis-riadok v edit formulári (label + "Edit" ikona +
    // skrytá textarea) — popis sa teraz edituje live hore. Textarea ostáva v DOM ako data store.
    var fieldP = textarea.closest('p');
    if (fieldP) fieldP.style.display = 'none';
  } catch (e) { return; }

  var ind = makeIndicator(wrapper);
  var saver = autosaver(function () { return { description: textarea.value }; }, ind);
  editor.on('update', function () { saver.idle(); });
  editor.on('blur', function () { saver.onBlur(); });
  editor.on('focus', function () { saver.onFocus(); });
}

/* Redmine si cookie `history_last_tab` (preferencia „posledná navštívená záložka")
 * píše delegovaným handlerom na `#history .tabs`. Tento element pri inline uložení
 * komentára prepisujeme cez innerHTML, čím handler zmizne — od prvého komentára by
 * sa cookie prestala aktualizovať a Redmine by usera vracal na starý tab.
 *
 * Delegujeme preto z `#history`, ktorý zostáva. Zápis je zámerne rovnaký ako
 * Redmineov (bez `path`), aby sa prepisovala tá istá cookie a nevznikla druhá. */
export function keepLastTabCookie() {
  var host = document.getElementById('history');
  if (!host || host.dataset.reTabCookie) return;
  host.dataset.reTabCookie = '1';
  host.addEventListener('click', function (e) {
    var link = e.target && e.target.closest ? e.target.closest('.tabs a[id^="tab-"]') : null;
    if (!link) return;
    document.cookie = 'history_last_tab=' + link.id.replace('tab-', '') + '; SameSite=Lax';
  });
}

// LIVE KOMENTÁRE: notes editor presuň pod históriu ako vždy viditeľnú lištu + Submit tlačidlo.
export function liveComments(editor, textarea) {
  var wrapper = editor.options && editor.options.element;
  var host = document.getElementById('history');
  if (!wrapper || !host) return;
  var i18n = (window.RE_CONFIG || {}).i18n || {};
  try {
    var box = document.createElement('div');
    box.className = 're-comment-box';
    host.parentNode.insertBefore(box, host.nextSibling);
    box.appendChild(wrapper); // presuň rich editor do viditeľnej lišty
  } catch (e) { return; }

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 're-comment-submit';
  btn.textContent = i18n.addComment || 'Add comment';
  box.appendChild(btn);
  var ind = makeIndicator(box);

  btn.addEventListener('click', function () {
    var val = (textarea.value || '').trim();
    if (!val) return;
    btn.disabled = true; ind.saving();
    // Ktorý tab histórie (History / Notes / Property changes) má user otvorený. Server vyrenderuje
    // odpoveď podľa `issue_history_default_tab` (preferencia usera), takže bez tohto by výmena
    // histórie usera prehodila na iný tab.
    var prevTab = document.querySelector('#history .tabs a.selected');
    var prevTabId = prevTab ? prevTab.id : null;
    var countBefore = document.querySelectorAll('#history .journal').length;
    autosave({ notes: val }).then(function (res) {
      btn.disabled = false;
      if (!res.success) { ind.failed(); return; }
      // bez reloadu: z odpovede (show page) vymeň históriu a vyčisti editor
      var doc = null;
      try { doc = new DOMParser().parseFromString(res.text, 'text/html'); } catch (e) {}
      // POISTKA: text zmažeme LEN keď v odpovedi naozaj pribudol komentár. Keby uloženie tíško
      // neprešlo (konflikt, cache, čokoľvek), radšej necháme rozpísaný text v editore.
      var landed = !doc || doc.querySelectorAll('#history .journal').length > countBefore;
      if (!landed) { ind.failed(); return; }
      try {
        var nh = doc && doc.getElementById('history');
        var ch = document.getElementById('history');
        if (nh && ch) {
          ch.innerHTML = nh.innerHTML;
          // Obnov pôvodný tab. Klikáme VŽDY, aj keď server vyrenderoval ten istý tab:
          // triedu `selected` síce prinesie HTML, ale journaly filtruje až
          // showIssueHistory a inline <script> z tabs partialu sa po nastavení
          // innerHTML nespustí. Klik je idempotentný.
          var link = prevTabId ? ch.querySelector('#' + prevTabId) : null;
          if (link) link.click();
        }
      } catch (e) {}
      // POZOR: `setContent` v tiptape 2 NEEMITUJE update (emitUpdate default false) → bez `true`
      // by v textarei zostal starý text a druhý klik na „Add comment" by poslal duplikát.
      editor.commands.setContent('', true);
      if ((textarea.value || '').trim()) textarea.value = '';
      ind.saved();
    }).catch(function () { btn.disabled = false; ind.failed(); });
  });
}
