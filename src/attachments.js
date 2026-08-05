/* F2: obrázky/súbory. Upload cez natívnu in-session cestu `/uploads.js` (rovnako ako Redmine;
   `/uploads.json` je za REST API → 401), naviazanie na issue formulár cez skryté `attachments[]`
   polia, vloženie referencie ako image NODE / plain text `attachment:` (nie literálny markdown). */
import { THUMB_DEFAULT } from './md-compat.js';

var CFG = window.RE_CONFIG || {};
var base = CFG.base || '';
var counter = 0;

// Nad touto veľkosťou vložíme screenshot ako malý klikateľný náhľad — inak by obrí obrázok
// odtlačil text pod sebou (Redmine obmedzuje obrázkom len šírku, nie výšku).
var BIG_W = 1200;
var BIG_H = 800;

function csrf() {
  var m = document.querySelector('meta[name="csrf-token"]');
  return m ? m.getAttribute('content') : '';
}

function isImage(att) {
  return /^image\//.test(att.contentType || '') ||
    /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(att.filename || '');
}

// Pre ktoré typy vie Redmine spraviť náhľad (Attachment#image? v jadre) — SVG medzi nimi NIE JE,
// tomu by `/attachments/thumbnail/…` vrátilo chybu.
function thumbnailable(att) {
  return /\.(bmp|gif|jpe?g|jpe|png|webp)$/i.test(att.filename || '');
}

// Upload jedného súboru → { token, filename, contentType }.
// Používa `/uploads.js` (in-session + CSRF; token je v JS odpovedi: .val('<id>.<digest>')).
function uploadFile(file) {
  var url = base + '/uploads.js?filename=' + encodeURIComponent(file.name);
  return fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrf(), 'X-Requested-With': 'XMLHttpRequest' },
    body: file
  }).then(function (r) {
    if (!r.ok) throw new Error('upload HTTP ' + r.status);
    return r.text();
  }).then(function (text) {
    var m = text.match(/\.val\('(\d+\.[a-f0-9]+)'\)/i);
    if (!m) throw new Error('no token in upload response');
    return { token: m[1], filename: file.name, contentType: file.type };
  });
}

// Formulár, do ktorého patria skryté `attachments[]` polia.
// POZOR: na detaile issue F3 (`src/live.js`) PRESUNIE editor MIMO `#issue-form` (popis pred
// `#issue_description_wiki`, komentár pod `#history`) → `closest('form')` je vtedy null a bez
// tohto fallbacku by sa upload nikdy nepriložil (`{{thumbnail}}` → „Attachment not found").
function targetForm(editor) {
  var dom = editor.view && editor.view.dom;
  return (dom && dom.closest('form')) || document.getElementById('issue-form') || null;
}

// Obrázok z clipboardu má v prehliadači vždy generický názov („image.png") → viac screenshotov
// v jednom issue by sa prekrývalo (Redmine rieši duplicitné názvy cez `Attachment.latest_attach`).
// Prepíšeme ho rovnakou konvenciou, akú používa natívny Redmine: `clipboard-YYYYMMDDhhmm-xxxxx.ext`.
export function clipboardName(file) {
  var d = new Date();
  var p2 = function (n) { return ('0' + n).slice(-2); };
  var ext = (file.name || '').split('.').pop();
  if (!ext || ext === file.name) ext = (file.type || '').split('/').pop() || 'png';
  var rnd = '';
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (var i = 0; i < 5; i++) rnd += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'clipboard-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) +
    p2(d.getHours()) + p2(d.getMinutes()) + '-' + rnd + '.' + ext.toLowerCase();
}

// Súbory z clipboardu → premenované kópie (obrázky). Ostatné nechá tak.
export function renameClipboardFiles(files) {
  return Array.prototype.map.call(files, function (file) {
    if (!/^image\//.test(file.type || '')) return file;
    try { return new File([file], clipboardName(file), { type: file.type }); } catch (e) { return file; }
  });
}

// Skryté polia do issue formulára → Redmine súbor priloží pri uložení (aj bez referencie v texte).
function addFormFields(form, att) {
  if (!form || !att.token) return;
  var key = 're' + (++counter);
  var fields = { token: att.token, filename: att.filename, content_type: att.contentType || '' };
  Object.keys(fields).forEach(function (f) {
    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'attachments[' + key + '][' + f + ']';
    input.value = fields[f];
    form.appendChild(input);
  });
}

// Rozmery obrázka z blob URL (na rozhodnutie full/thumb). Vždy resolvne — pri chybe {0,0}.
function measure(url) {
  return new Promise(function (resolve) {
    if (!url) return resolve({ w: 0, h: 0 });
    var img = new window.Image();
    var done = false;
    function fin(w, h) { if (!done) { done = true; resolve({ w: w, h: h }); } }
    img.onload = function () { fin(img.naturalWidth || 0, img.naturalHeight || 0); };
    img.onerror = function () { fin(0, 0); };
    setTimeout(function () { fin(0, 0); }, 4000);
    img.src = url;
  });
}

// Textový odkaz na prílohu. `attachment:nazov` je natívna Redmine syntax → po uložení odkaz
// na prílohu. (Pozor: `[label](nazov)` by dalo rozbitý relatívny odkaz.)
function insertAttachmentLink(editor, att) {
  editor.chain().focus().insertContent(' ').run();
  editor.chain().focus().insertContent({ type: 'text', text: 'attachment:' + att.filename }).run();
  editor.chain().focus().insertContent(' ').run();
}

// Vloženie referencie do editora. Obrázok: src = blob URL (okamžitý náhľad), filename ide do Markdownu.
// Veľký screenshot → display 'thumb' (malý klikateľný náhľad), inak 'full'.
function insertRef(editor, att, file) {
  if (!isImage(att)) { insertAttachmentLink(editor, att); return Promise.resolve(); }
  var src = att.filename;
  try { if (file) src = URL.createObjectURL(file); } catch (e) {}
  var canThumb = thumbnailable(att);
  return (canThumb && src !== att.filename ? measure(src) : Promise.resolve({ w: 0, h: 0 }))
    .then(function (dim) {
      var big = dim.w > BIG_W || dim.h > BIG_H;
      var display = (canThumb && big) ? 'thumb' : 'full';
      editor.chain().focus().insertContent({
        type: 'image',
        attrs: { src: src, filename: att.filename, alt: att.filename, display: display, size: THUMB_DEFAULT }
      }).run();
      editor.chain().focus().insertContent(' ').run();
    });
}

export function handleFiles(editor, files) {
  if (!files || !files.length) return;
  var form = targetForm(editor);
  if (!form && window.console) console.warn('[rich_editor] no form for attachments — upload would not be attached');
  Array.prototype.forEach.call(files, function (file) {
    uploadFile(file).then(function (att) {
      addFormFields(form, att);
      return insertRef(editor, att, file);
    }).catch(function (e) {
      if (window.console) console.error('[rich_editor] upload failed:', e);
    });
  });
}

// Otvorenie výberu súborov (Cmd/Ctrl+Shift+A alebo /file). Perzistentný input per editor.
export function openFilePicker(editor) {
  var input = editor.__reFileInput;
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.className = 're-file-input';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      handleFiles(editor, input.files);
      input.value = '';
    });
    editor.__reFileInput = input;
  }
  input.click();
}
