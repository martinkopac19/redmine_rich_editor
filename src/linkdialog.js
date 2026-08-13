/* Dialóg odkazu (Ctrl/Cmd+K a tlačidlo 🔗 v lište).

   Nahrádza pôvodný `window.prompt`, do ktorého sa nedalo nič prilepiť. Vie dve veci:
     1) klasicky vložiť URL,
     2) prijať OBRÁZOK z clipboardu (Ctrl+V) alebo pretiahnutím — ten sa nahrá ako príloha
        a do textu sa vloží ODKAZ, nie náhľad. To je celý zmysel: kto chce obrázok vidieť
        rovno, vloží ho normálne; kto chce čistý text, dá ho sem a obrázok sa rozklikne.

   Keď je pred otvorením označený text, odkaz sa naň naviaže. Keď nie je, vloží sa popisok
   (defaultne „screenshot") a rovno sa OZNAČÍ, takže ho používateľ prepíše písaním. */
import { uploadAndAttach, attachmentPageUrl, clipboardName } from './attachments.js';

var I = (window.RE_CONFIG || {}).i18n || {};

/* Vloží popisok s odkazom a označí ho.

   GOTCHA: `setTextSelection` vynuluje `storedMarks`. Keby sme ich nenastavili späť, písanie
   cez označený popisok by odkaz zahodilo — ProseMirror by pri náhrade výberu vzal marks znaku
   PRED výberom (tam odkaz nie je). Preto sa storedMarks nastavia AŽ PO nastavení výberu. */
export function insertLinkedLabel(editor, href, label) {
  var pos = editor.state.selection.from;
  editor.chain().focus()
    .insertContent({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href: href } }] })
    .run();
  editor.chain().focus()
    .setTextSelection({ from: pos, to: pos + label.length })
    .command(function (p) {
      var mark = p.state.schema.marks.link;
      if (mark) p.tr.setStoredMarks([mark.create({ href: href })]);
      return true;
    })
    .run();
}

/* Výber si pamätáme od otvorenia dialógu, ale medzitým sa dokument mohol zmeniť (upload trvá
   sekundy). Mimo rozsahu by `setTextSelection` hodilo RangeError a odkaz by sa ticho nevložil. */
function clamp(editor, range) {
  if (!range) return null;
  var max = editor.state.doc.content.size;
  var from = Math.max(0, Math.min(range.from, max));
  return { from: from, to: Math.max(from, Math.min(range.to, max)) };
}

// Naviaže odkaz na označený text, alebo (ak nič označené nie je) vloží popisok s odkazom.
export function applyLink(editor, href, range, label) {
  range = clamp(editor, range);
  var hasSel = range && range.to > range.from;
  if (hasSel) {
    editor.chain().focus().setTextSelection(range).extendMarkRange('link')
      .setLink({ href: href }).run();
    return;
  }
  if (range) editor.chain().focus().setTextSelection(range).run();
  insertLinkedLabel(editor, href, label || href);
}

/* ---------- samotný dialóg ---------- */

var dlg = null;   // jediná inštancia, recyklovaná
var ctx = null;   // { editor, from, to }

function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function build() {
  var root = el('div', 're-link-dialog');
  root.style.display = 'none';

  var title = el('div', 're-link-title', I.link || 'Link (URL):');
  var input = el('input', 're-link-input');
  input.type = 'text';
  input.placeholder = I.linkPh || 'https://…  or paste an image (Ctrl+V)';
  var hint = el('div', 're-link-hint', I.linkHint ||
    'Tip: paste a screenshot here — it is attached and inserted as a link, with no preview.');
  var status = el('div', 're-link-status');
  status.style.display = 'none';

  var actions = el('div', 're-link-actions');
  var bFile = el('button', 're-link-btn', I.linkFile || 'Choose file…');
  var spacer = el('span', 're-link-spacer');
  var bRemove = el('button', 're-link-btn', I.linkRemove || 'Remove link');
  var bCancel = el('button', 're-link-btn', I.cancel || 'Cancel');
  var bOk = el('button', 're-link-btn re-primary', I.linkInsert || 'Insert');
  [bFile, bRemove, bCancel, bOk].forEach(function (b) { b.type = 'button'; });
  bFile.setAttribute('data-re-act', 'link-file');
  bRemove.setAttribute('data-re-act', 'link-remove');
  bCancel.setAttribute('data-re-act', 'link-cancel');
  bOk.setAttribute('data-re-act', 'link-ok');
  actions.appendChild(bFile);
  actions.appendChild(spacer);
  actions.appendChild(bRemove);
  actions.appendChild(bCancel);
  actions.appendChild(bOk);

  root.appendChild(title);
  root.appendChild(input);
  root.appendChild(hint);
  root.appendChild(status);
  root.appendChild(actions);
  document.body.appendChild(root);

  var fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  root.appendChild(fileInput);

  var api = {
    root: root, input: input, status: status, remove: bRemove,
    busy: function (on) {
      status.style.display = on ? 'block' : 'none';
      status.textContent = on ? (I.linkUploading || 'Uploading…') : '';
      bOk.disabled = !!on;
      bFile.disabled = !!on;
    }
  };

  // obrázok z clipboardu / pretiahnutím → nahrať a vložiť ako ODKAZ
  function takeFiles(files) {
    if (!files || !files.length || !ctx) return false;
    var file = null;
    for (var i = 0; i < files.length; i++) {
      if (/^image\//.test(files[i].type || '')) { file = files[i]; break; }
    }
    if (!file) file = files[0];
    if (!file) return false;
    // clipboard dáva vždy generický „image.png" → premenuj natívnou konvenciou Redmine
    if (/^image\//.test(file.type || '')) {
      try { file = new File([file], clipboardName(file), { type: file.type }); } catch (e) {}
    }
    api.busy(true);
    var editor = ctx.editor, range = { from: ctx.from, to: ctx.to };
    uploadAndAttach(editor, file).then(function (att) {
      api.busy(false);
      close();
      applyLink(editor, attachmentPageUrl(att.id), range, I.linkLabel || 'screenshot');
    }).catch(function (e) {
      api.busy(false);
      api.status.style.display = 'block';
      api.status.textContent = (I.linkFailed || 'Upload failed') + ': ' + e.message;
      if (window.console) console.error('[rich_editor] link dialog upload failed:', e);
    });
    return true;
  }

  input.addEventListener('paste', function (ev) {
    var files = ev.clipboardData && ev.clipboardData.files;
    if (files && files.length && takeFiles(files)) ev.preventDefault();
  });
  root.addEventListener('dragover', function (ev) { ev.preventDefault(); root.classList.add('re-drop'); });
  root.addEventListener('dragleave', function () { root.classList.remove('re-drop'); });
  root.addEventListener('drop', function (ev) {
    root.classList.remove('re-drop');
    var files = ev.dataTransfer && ev.dataTransfer.files;
    if (files && files.length) { ev.preventDefault(); takeFiles(files); }
  });
  fileInput.addEventListener('change', function () {
    takeFiles(fileInput.files);
    fileInput.value = '';
  });
  bFile.addEventListener('click', function () { fileInput.click(); });

  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); confirm(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); close(); }
  });
  bOk.addEventListener('click', confirm);
  bCancel.addEventListener('click', close);
  bRemove.addEventListener('click', function () {
    if (!ctx) return close();
    var editor = ctx.editor;
    editor.chain().focus().setTextSelection(clamp(editor, { from: ctx.from, to: ctx.to }))
      .extendMarkRange('link').unsetLink().run();
    close();
  });

  return api;
}

function confirm() {
  if (!ctx) return;
  var url = (dlg.input.value || '').trim();
  var editor = ctx.editor, range = { from: ctx.from, to: ctx.to };
  close();
  if (!url) {
    editor.chain().focus().setTextSelection(clamp(editor, range)).extendMarkRange('link').unsetLink().run();
    return;
  }
  // popisok pri prázdnom výbere = samotná URL (pri ručne písanom odkaze je to čitateľnejšie
  // než generické slovo); pri obrázku z clipboardu sa používa „screenshot"
  applyLink(editor, url, range, url);
}

function close() {
  if (!dlg) return;
  dlg.root.style.display = 'none';
  dlg.busy(false);
  ctx = null;
  document.removeEventListener('mousedown', onOutside, true);
}

function onOutside(ev) {
  if (dlg && dlg.root.contains(ev.target)) return;
  close();
}

// Umiestni dialóg pod výber (alebo pod kurzor), s okrajom vnútri okna.
function place(editor, from) {
  var box = dlg.root.getBoundingClientRect();
  var c;
  try { c = editor.view.coordsAtPos(from); } catch (e) { c = null; }
  var left = c ? c.left : (window.innerWidth / 2 - box.width / 2);
  var top = c ? c.bottom + 8 : (window.innerHeight / 2);
  left = Math.min(Math.max(8, left), window.innerWidth - box.width - 8);
  dlg.root.style.left = (left + window.scrollX) + 'px';
  dlg.root.style.top = (top + window.scrollY) + 'px';
}

export function openLinkDialog(editor) {
  if (!dlg) dlg = build();
  var sel = editor.state.selection;
  ctx = { editor: editor, from: sel.from, to: sel.to };

  dlg.input.value = editor.getAttributes('link').href || '';
  dlg.remove.style.display = editor.isActive('link') ? '' : 'none';
  dlg.busy(false);
  dlg.root.style.display = 'block';
  place(editor, sel.from);
  dlg.input.focus();
  dlg.input.select();
  document.addEventListener('mousedown', onOutside, true);
}
