/* Rozpísaný text tam, kde sa uložiť na server NEDÁ.
 *
 * Popis existujúcej úlohy sa ukladá cez `autosave` (live.js) — tam server je
 * a záznam do histórie patrí. Komentár a nová úloha ho nemajú:
 *   - uložiť komentár = pridať ho do histórie a rozposlať notifikácie kolegom,
 *   - uložiť novú úlohu = založiť ju.
 * Ani jedno sa nesmie stať samo. Rozpísaný text sa preto drží v prehliadači
 * a po návrate na stránku sa vráti do editora. Nikam sa neposiela.
 *
 * `sessionStorage`, nie `localStorage` (rozhodnutie zadávateľa 9. 9. 2026):
 * text prežije refresh a preklikanie po Redmine, ale zomrie so zatvorením
 * karty — na zdieľanom počítači po nikom nezostane rozpísaný komentár.
 *
 * Redmine 6.1.3 nič také nemá; jediné, čo robí, je varovanie „Leave site?"
 * (`warnLeavingUnsaved`), ktoré text nezachráni.
 */

var PREFIX = 're.draft.';
/* Strop na jedno pole. Popis úlohy býva dlhý, ale `sessionStorage` má na
 * doménu jednotky MB a delíme sa o ne s frontou plánu z AI asistenta. */
var MAX_CHARS = 100000;

function store() {
  try { return window.sessionStorage; } catch (e) { return null; }
}

/* Kľúč viaže koncept na KONKRÉTNE miesto, inak by sa text z jednej úlohy
 * objavil pri druhej. Komentár patrí úlohe, nová úloha projektu. */
export function notesKey(issueId) {
  return issueId ? PREFIX + 'notes.' + issueId : null;
}

export function newIssueKey(projectId) {
  return PREFIX + 'newissue.' + (projectId || 'global');
}

/* Číslo úlohy z adresy. Vracia null aj na `/issues/123/edit` a `/issues` —
 * koncept komentára patrí len detailu úlohy. */
export function issueIdFromPath() {
  var m = String(window.location.pathname).match(/\/issues\/(\d+)\/?$/);
  return m ? m[1] : null;
}

export function saveDraft(key, fields) {
  var s = store();
  if (!s || !key) return;

  // Prázdny obsah nie je koncept — je to pokyn koncept zahodiť.
  var any = Object.keys(fields).some(function (k) { return (fields[k] || '').trim(); });
  if (!any) { clearDraft(key); return; }

  var out = {};
  Object.keys(fields).forEach(function (k) {
    out[k] = String(fields[k] || '').slice(0, MAX_CHARS);
  });
  try { s.setItem(key, JSON.stringify({ v: 1, at: Date.now(), fields: out })); } catch (e) {}
}

/* Číta a NEMAŽE: človek môže stránku obnoviť viackrát a text tam má zostať.
 * Maže sa až vtedy, keď sa naozaj odošle (alebo keď ho človek sám vyprázdni).
 *
 * `sessionStorage` je zapisovateľné z konzoly prehliadača, takže hodnoty
 * prechádzajú kontrolou typu a dĺžky. Do DOM sa nevkladajú ako HTML — idú do
 * editora ako markdown, ktorý Redmine pri uložení aj tak sanitizuje. */
export function readDraft(key) {
  var s = store();
  if (!s || !key) return null;

  var raw;
  try { raw = JSON.parse(s.getItem(key)); } catch (e) { return null; }
  if (!raw || raw.v !== 1 || !raw.fields || typeof raw.fields !== 'object') return null;

  var out = {};
  Object.keys(raw.fields).forEach(function (k) {
    var v = raw.fields[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.slice(0, MAX_CHARS);
  });
  return Object.keys(out).length ? out : null;
}

export function clearDraft(key) {
  var s = store();
  if (!s || !key) return;
  try { s.removeItem(key); } catch (e) {}
}

/* Ukladá sa s odkladom — pri každom stlačení klávesy by to bol zápis do
 * úložiska na každý znak. Vracia funkciu, ktorou sa zápis vyžiada. */
export function debouncedSaver(key, getFields, ms) {
  var timer = null;
  return function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      try { saveDraft(key, getFields()); } catch (e) {}
    }, ms || 800);
  };
}
