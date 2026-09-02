/* F3 — live inline editovanie na detaile issue (auto-save cez AJAX existujúceho #issue-form).
   POZOR: toto je najviac naviazané na Redmine DOM (menej upgrade-safe) → všade fallback. */
import { uploadsPending } from './attachments.js';

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
// `opts.live` → do POSTu ide príznak `re_live=1`, podľa ktorého server (merge_hooks.rb) zlučuje
// po sebe idúce úpravy do jedného záznamu histórie. Bežné uloženie formulára ho nemá a nezlučuje sa.
export function autosave(fields, opts, _retry) {
  opts = opts || {};
  var form = issueForm();
  if (!form) return Promise.reject(new Error('no #issue-form'));
  var action = form.getAttribute('action');
  var lvEl = form.querySelector('input[name="issue[lock_version]"]');
  var body = new URLSearchParams();
  body.append('_method', 'patch');
  body.append('authenticity_token', csrf());
  if (opts.live) body.append('re_live', '1');
  // natívny parameter jadra — auto-save nemá nechávať hlášku „Successful update" pre ďalšiu navigáciu
  body.append('no_flash', '1');
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
      return refreshLockVersion(form).then(function () { return autosave(fields, opts, true); });
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

/* ---------------------------------------------------------------------------
   Auto-save: JEDNA súvislá úprava = JEDNO uloženie.

   Prečo prepísané: v Redmine 6.1.3 NEEXISTUJE žiadna agregácia záznamov histórie —
   každé uloženie je nový riadok v `journals` a jeden mail. Každý POST navyše je teda
   riadok v histórii navyše a notifikácia navyše. Pôvodná verzia ich robila tri spôsobmi:
     - `idle` 2 s bol hlavný spúšťač → vloženie obrázka sa uložilo skôr, než sa stihlo
       kliknúť „len odkaz" (presne nahlásený prípad),
     - `onBlur` nerušil idle časovač → po uložení na blur o ~1,3 s dobehol idle a poslal
       DRUHÝ, obsahovo identický POST,
     - nebola žiadna kontrola „zmenilo sa vôbec niečo" → klik do poľa a von = uloženie.

   Nové pravidlá:
     - JEDINÝ časovač pre obe cesty → blur a idle sa navzájom prebijú, nikdy nebežia oba,
     - blur je hlavný spúšťač, idle 10 s len poistka pre „píšem a neodchádzam",
     - pred každým POSTom porovnanie s naposledy uloženým stavom,
     - kým beží upload prílohy, uloženie sa odloží.
   --------------------------------------------------------------------------- */
var BLUR_MS = 400;    // hlavný spúšťač: odchod z poľa (krátky odklad, fokus sa môže presúvať v našej UI)
var IDLE_MS = 10000;  // poistka pri dlhom písaní bez odchodu z poľa (rozhodnutie zadávateľa)
var BUSY_MS = 400;    // ako často skúšať znova, kým beží upload prílohy
var BUSY_MAX = 30000; // ...ale nie donekonečna, nech zaseknutý upload nezablokuje uloženie textu

var SAVERS = [];
var nativeSubmitting = false;

/* Naša vlastná UI nie je „odchod z poľa". Bublinové lišty používajú mousedown+preventDefault
   (editor neblurne), ale dialóg odkazu si fokus berie naozaj — uprostred vkladania odkazu
   sa ukladať nemá. */
function inEditorChrome(node) {
  return !!(node && node.closest && node.closest('.re-bubble, .re-link-dialog, .re-slash'));
}

function autosaver(getFields, ind) {
  var timer = null;   // JEDINÝ časovač — preto sa blur a idle nemôžu prebiť do duplikátu
  var saving = false;
  var busySince = 0;

  function sig() { try { return JSON.stringify(getFields()); } catch (e) { return null; } }

  /* Čakajúce prílohy sú „zmena" aj keď je text rovnaký — skryté `attachments[…]` polia treba
     issue priradiť. Zámerne to NIE JE súčasť baseline: `autosave` ich po úspechu z DOM odstráni,
     takže hneď po uložení je počet 0 a `dirty()` sa upokojí samo.

     POZOR na `[name$="[token]"]` a neprázdnu hodnotu: Redmine má vo formulári VŽDY prázdne
     `attachments[dummy][file]` (výber súboru). Počítať všetko, čo začína na `attachments[`,
     znamená byť trvalo „špinavý" — a potom aj obyčajné kliknutie do popisu a von vyrobí
     uloženie, záznam v histórii a notifikáciu. */
  function pendingAtts() {
    var f = issueForm();
    if (!f) return 0;
    return Array.prototype.filter.call(
      f.querySelectorAll('input[name^="attachments["][name$="[token]"]'),
      function (i) { return !!i.value; }
    ).length;
  }

  /* Základ porovnania = stav pri načítaní stránky. Bez neho by prvý blur uložil kozmetickú
     normalizáciu Markdownu z TipTapu, ktorú užívateľ nespravil. */
  var lastSaved = sig();

  function dirty() { return sig() !== lastSaved || pendingAtts() > 0; }
  function cancel() { clearTimeout(timer); timer = null; }
  function arm(ms) { clearTimeout(timer); timer = setTimeout(run, ms); }

  function run() {
    timer = null;
    if (saving) return;                      // po dobehnutí POSTu sa `dirty()` prekontroluje samo
    if (!dirty()) { busySince = 0; return; } // NIČ SA NEZMENILO → neposielaj nič

    if (uploadsPending()) {
      if (!busySince) busySince = Date.now();
      if (Date.now() - busySince < BUSY_MAX) { arm(BUSY_MS); return; }
    }
    busySince = 0;

    var sent = sig(); // presne toto sa po úspechu stane novým baseline
    saving = true; ind.saving();
    autosave(getFields(), { live: true }).then(function (res) {
      saving = false;
      if (res.success) {
        lastSaved = sent;
        ind.saved();
        if (dirty()) arm(BLUR_MS); // medzitým sa ešte niečo zmenilo → dorieš to jedným kolom
      } else {
        /* NEOPAKUJ HNEĎ: `lastSaved` sa neposunul, takže `dirty()` je stále true a okamžitý
           re-run by roztočil nekonečnú slučku padajúcich POSTov. Skús až po poistke. */
        ind.failed();
        arm(IDLE_MS);
      }
    }).catch(function () { saving = false; ind.failed(); });
  }

  var api = {
    idle: function () { arm(IDLE_MS); },
    /* `arm` prepíše aj bežiacu poistku, takže po uložení na blur UŽ NEMÔŽE dobehnúť druhý
       (idle) POST — to bola príčina duplikátov. */
    onBlur: function () {
      arm(BLUR_MS);
      if (inEditorChrome(document.activeElement)) api.idle(); // dialóg odkazu → stále editujeme
    },
    onFocus: function () { if (dirty()) arm(IDLE_MS); else cancel(); },
    cancel: cancel,
    dirty: dirty,
    /* Posledná záchrana pri odchode zo stránky. Vracia false, ak sa nepodarilo odoslať. */
    flush: function () {
      cancel();
      if (nativeSubmitting) return true;   // natívny submit nesie hodnoty sám
      if (saving || !dirty()) return true; // bežiaci POST už na serveri je
      var fields = getFields();
      var ok = beaconSave(fields);
      if (ok) lastSaved = JSON.stringify(fields); // aby druhý flush neposlal duplikát
      return ok;
    }
  };
  SAVERS.push(api);
  return api;
}

/* Uloženie „na odchode" zo stránky. `fetch` sa pri zániku stránky NEDOKONČÍ (prehliadač zahodí
   JS kontext aj s otvorenými spojeniami), `sendBeacon` áno — požiadavku prevezme sieťová vrstva.
   Cena: ODPOVEĎ NEVIDÍME, teda žiadna obnova `lock_version` ani detekcia konfliktu. Preto je to
   naozaj len poistka; bežne ukladá `autosave` cez fetch, kým stránka žije. */
function beaconSave(fields) {
  var form = issueForm();
  if (!form || !navigator.sendBeacon) return false;
  var body = new URLSearchParams();
  body.append('_method', 'patch');
  body.append('authenticity_token', csrf());
  body.append('re_live', '1');
  body.append('no_flash', '1');
  var lvEl = form.querySelector('input[name="issue[lock_version]"]');
  if (lvEl) body.append('issue[lock_version]', lvEl.value);
  Object.keys(fields).forEach(function (k) { body.append('issue[' + k + ']', fields[k] == null ? '' : fields[k]); });
  Array.prototype.slice.call(form.querySelectorAll('input[name^="attachments["]'))
    .forEach(function (inp) { body.append(inp.name, inp.value); });
  try {
    return navigator.sendBeacon(form.getAttribute('action'),
      new Blob([body.toString()], { type: 'application/x-www-form-urlencoded' }));
  } catch (e) { return false; }
}

/* Spoločné ošetrenie odchodu zo stránky.

   Prečo `pagehide` a NIE `visibilitychange`: ten sa spustí pri KAŽDOM preklikaní na iný tab
   alebo aplikáciu (Alt+Tab). Uložiť rozpísanú vetu vtedy by vyrobilo presne ten záznam
   v histórii a mail navyše, ktorému sa týmto celým prepisom vyhýbame.

   `beforeunload` je tu ako prvý pokus (spustí sa skôr) a zároveň ako jediné miesto, kde vieme
   zobraziť varovanie, keď sa beacon nepodarí. Dvojitý flush je bezpečný vďaka `dirty()` —
   po úspešnom beacone sa baseline posunie a druhý flush už nič neposiela. */
function registerExitFlush() {
  if (window.__reExitFlush) return;
  window.__reExitFlush = 1;

  function flushAll() {
    var ok = true;
    SAVERS.forEach(function (s) { try { if (!s.flush()) ok = false; } catch (e) { ok = false; } });
    return ok;
  }

  window.addEventListener('beforeunload', function (e) {
    if (flushAll()) return;
    // beacon sa nepodarilo zaradiť → aspoň sa spýtaj, nech sa zmena nestratí ticho
    e.preventDefault();
    e.returnValue = '';
  });
  window.addEventListener('pagehide', flushAll);

  /* Natívne odoslanie #issue-form nesie `issue[subject]` aj `issue[description]` samo →
     čakajúci auto-save treba ZRUŠIŤ, nie doposlať. Inak vznikne druhý záznam a náš POST
     si s natívnym submitom rozbijú `lock_version`. */
  var form = issueForm();
  if (form) {
    form.addEventListener('submit', function () {
      nativeSubmitting = true;
      SAVERS.forEach(function (s) { try { s.cancel(); } catch (e) {} });
    });
  }
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
  function readTitle() { return el.textContent.replace(/\s+/g, ' ').trim(); }

  /* Natívny Submit posiela `issue[subject]` z INPUTU vo formulári, nie z nášho contenteditable
     h3 → bez zrkadlenia by ručné uloženie vrátilo pôvodný názov. Zároveň vďaka nemu netreba
     pri natívnom submite nič doukladávať, a teda nevznikne druhý záznam v histórii. */
  var subjInput = issueForm().querySelector('input[name="issue[subject]"]');

  var saver = autosaver(function () { return { subject: readTitle() }; }, ind);
  registerExitFlush();
  el.addEventListener('input', function () {
    if (subjInput) subjInput.value = readTitle();
    saver.idle();
  });
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
  registerExitFlush();
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
