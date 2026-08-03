/* F2: obrázky/súbory. Upload cez natívnu in-session cestu `/uploads.js` (rovnako ako Redmine;
   `/uploads.json` je za REST API → 401), naviazanie na issue formulár cez skryté `attachments[]`
   polia, vloženie `![](súbor)` / odkazu ako image/link NODE (nie literálny text → neescapuje sa). */
var CFG = window.RE_CONFIG || {};
var base = CFG.base || '';
var counter = 0;

function csrf() {
  var m = document.querySelector('meta[name="csrf-token"]');
  return m ? m.getAttribute('content') : '';
}

function isImage(att) {
  return /^image\//.test(att.contentType || '') ||
    /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(att.filename || '');
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

// Vloženie referencie do editora (image node pre obrázky, odkaz pre ostatné).
function insertRef(editor, att) {
  if (isImage(att)) {
    editor.chain().focus().setImage({ src: att.filename, alt: att.filename }).run();
    editor.chain().focus().insertContent(' ').run();
  } else {
    editor.chain().focus()
      .insertContent({ type: 'text', text: att.filename, marks: [{ type: 'link', attrs: { href: att.filename } }] })
      .run();
    editor.chain().focus().unsetMark('link').insertContent(' ').run();
  }
}

export function handleFiles(editor, files) {
  if (!files || !files.length) return;
  var form = editor.view && editor.view.dom.closest('form');
  Array.prototype.forEach.call(files, function (file) {
    uploadFile(file).then(function (att) {
      addFormFields(form, att);
      insertRef(editor, att);
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
