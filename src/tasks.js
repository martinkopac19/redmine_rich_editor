/* Zaškrtávanie checkboxov priamo v uloženom komentári — bez otvárania editácie.

   Redmine renderuje task listy vždy ako `disabled` checkbox, takže políčko v komentári
   sa dalo zaškrtnúť len cez ceruzku „upraviť komentár" — a tú má len autor komentára.
   Tu políčka odblokujeme a klik pošleme na vlastný endpoint, ktorý prepíše práve jednu
   značku `[ ]` / `[x]` v texte.

   ZÁMERNE len komentáre (`div#journal-<id>-notes`). Popis úlohy má živý editor
   (`liveDescription`), wiki a novinky do zadania nepatria.

   POZOR na jednu pascu: listener NESMIE visieť na jednotlivých políčkach so značkou
   v `dataset`. História sa na stránke prekresľuje cez `innerHTML`, čo serializuje aj naše
   atribúty — nové políčka by teda prišli s `data-…="1"` a triedou `re-task-live`, ale bez
   listenera. Vyzerali by klikateľné a klik by sa nikam neodoslal. Preto je listener
   delegovaný z `document` (registruje sa raz) a políčka sa poznávajú podľa selektora. */

var CFG = window.RE_CONFIG || {};
var I = CFG.i18n || {};

var BOX_SELECTOR = 'div[id^="journal-"][id$="-notes"].wiki';
var CB_SELECTOR = 'input.task-list-item-checkbox';

function csrf() {
  var m = document.querySelector('meta[name="csrf-token"]');
  return m ? m.getAttribute('content') : '';
}

function journalIdOf(box) {
  var m = /^journal-(\d+)-notes$/.exec(box.id || '');
  return m ? m[1] : null;
}

/* Krátka spätná väzba pri zlyhaní. Zámerne bez alertu: zaškrtnutie je drobné gesto
   a modálne okno by z neho spravilo udalosť. */
function flashError(cb, text) {
  cb.title = text || '';
  cb.classList.add('re-task-failed');
  setTimeout(function () { cb.classList.remove('re-task-failed'); }, 2500);
}

function send(cb, jid, index, total) {
  var checked = cb.checked;
  var body = new URLSearchParams();
  body.append('index', String(index));
  body.append('total', String(total));
  body.append('checked', checked ? '1' : '0');
  // stav PRED kliknutím — server podľa neho pozná, že medzitým komentár nikto nezmenil
  body.append('from', checked ? '0' : '1');

  cb.disabled = true;
  fetch(CFG.base + '/rich_editor/journals/' + jid + '/task', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-CSRF-Token': csrf(),
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: body.toString()
  }).then(function (r) {
    cb.disabled = false;
    if (r.ok) return;
    // vráť políčko do pôvodného stavu — v DB sa nič nezmenilo
    cb.checked = !checked;
    flashError(cb, r.status === 409 ? I.taskStale : I.taskFailed);
  }).catch(function () {
    cb.disabled = false;
    cb.checked = !checked;
    flashError(cb, I.taskFailed);
  });
}

function onChange(e) {
  var cb = e.target;
  if (!cb || !cb.matches || !cb.matches(CB_SELECTOR)) return;
  var box = cb.closest(BOX_SELECTOR);
  if (!box) return;
  var jid = journalIdOf(box);
  if (!jid) return;

  // `index`/`total` sa čítajú až tu, zo živého DOM: komentár sa mohol medzitým
  // prekresliť a zapamätané čísla by ukazovali na iné políčko.
  var list = box.querySelectorAll(CB_SELECTOR);
  var index = Array.prototype.indexOf.call(list, cb);
  if (index < 0) return;
  send(cb, jid, index, list.length);
}

/* Odblokuje checkboxy vo všetkých komentároch na stránke.
   Volá sa z každého `scan()`, teda aj po tom, čo sa história vymení za nové HTML zo servera —
   bez toho by po pridaní komentára boli políčka opäť zamknuté. */
export function enableJournalTasks() {
  if (!CFG.taskToggle) return;

  if (!document.documentElement.dataset.reTaskBound) {
    document.documentElement.dataset.reTaskBound = '1';
    document.addEventListener('change', onChange, true);
  }

  var boxes = document.querySelectorAll(BOX_SELECTOR);
  for (var b = 0; b < boxes.length; b++) {
    var box = boxes[b];
    if (!journalIdOf(box)) continue;
    var list = box.querySelectorAll(CB_SELECTOR);
    for (var i = 0; i < list.length; i++) {
      var cb = list[i];
      // nič nemeň, ak už je hotové — inak by každý zápis vyvolal ďalšiu mutáciu a scan()
      if (!cb.disabled && cb.classList.contains('re-task-live')) continue;
      cb.disabled = false;
      cb.classList.add('re-task-live');
    }
  }
}
