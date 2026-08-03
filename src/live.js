/* F3 — live inline editovanie na detaile issue (auto-save cez AJAX existujúceho #issue-form).
   POZOR: toto je najviac naviazané na Redmine DOM (menej upgrade-safe) → všade fallback. */

function csrf() {
  var m = document.querySelector('meta[name="csrf-token"]');
  return m ? m.getAttribute('content') : '';
}
function issueForm() { return document.getElementById('issue-form'); }

// Auto-save čiastkových polí issue cez natívny update (_method=patch). Rieši lock_version.
export function autosave(fields) {
  var form = issueForm();
  if (!form) return Promise.reject(new Error('no #issue-form'));
  var action = form.getAttribute('action');
  var lvEl = form.querySelector('input[name="issue[lock_version]"]');
  var body = new URLSearchParams();
  body.append('_method', 'patch');
  body.append('authenticity_token', csrf());
  if (lvEl) body.append('issue[lock_version]', lvEl.value);
  Object.keys(fields).forEach(function (k) { body.append('issue[' + k + ']', fields[k] == null ? '' : fields[k]); });
  return fetch(action, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  }).then(function (r) {
    return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t }; });
  }).then(function (res) {
    // z odpovede (redirect na show) vytiahni nové lock_version pre ďalšie uloženie
    var m = res.text.match(/name="issue\[lock_version\]"[^>]*value="(\d+)"/);
    if (m && lvEl) lvEl.value = m[1];
    res.success = res.ok && !/id="errorExplanation"/.test(res.text);
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
  } catch (e) { return; }

  var ind = makeIndicator(wrapper);
  var saver = autosaver(function () { return { description: textarea.value }; }, ind);
  editor.on('update', function () { saver.idle(); });
  editor.on('blur', function () { saver.onBlur(); });
  editor.on('focus', function () { saver.onFocus(); });
}
