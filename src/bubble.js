/* Bublinové lišty (vlastné, bez tippy):
     - po označení textu: veľkosť textu, formátovanie, bloky (odrážky/číslovanie/checklist/kód), odkaz
     - po kliknutí na obrázok: Malý náhľad / Plná šírka / Len odkaz + veľkosť náhľadu
     - nad odkazom (myšou alebo kurzorom): Otvoriť / Upraviť odkaz / Zobraziť ako obrázok */
import { getMarkRange } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { THUMB_SIZES, THUMB_DEFAULT } from './md-compat.js';
import { attUrl, attIdFor } from './image.js';
import { attachmentPageUrl, filenameForAttId, previewForAttId, attachmentThumbUrl } from './attachments.js';
import { openLinkDialog, insertLinkedLabel } from './linkdialog.js';

var RE_I18N = (window.RE_CONFIG || {}).i18n || {};

// Id prílohy z URL odkazu (`/attachments/123`, aj `/attachments/download/123/meno.png`).
var RE_ATT_HREF = /\/attachments\/(?:download\/|thumbnail\/)?(\d+)/;

/* Odkaz na prílohu, ktorej názov poznáme (z `RE_CONFIG.atts` alebo z uploadu v tejto relácii).
   Len taký sa dá premeniť späť na obrázok — bez názvu nevieme poskladať `src` náhľadu. */
function linkedAttachment(href) {
  var m = RE_ATT_HREF.exec(href || '');
  if (!m) return null;
  var name = filenameForAttId(m[1]);
  return name ? { id: m[1], filename: name } : null;
}

/* Rozsah odkazu (`{ from, to, href }`) na danej pozícii. Rozsah držíme explicitne, lebo lišta
   sa ukazuje aj pri prejdení myšou — vtedy je kurzor inde a `extendMarkRange` by siahol
   na nesprávne miesto. `to` z dĺžky textu je záchranná brzda, keby `getMarkRange` zlyhal. */
function linkTargetAt(editor, pos, href, fallbackLen) {
  if (!href) return null;
  var range = null;
  try { range = getMarkRange(editor.state.doc.resolve(pos), editor.state.schema.marks.link); } catch (e) {}
  if (!range) range = { from: pos, to: pos + (fallbackLen || 0) };
  return { from: range.from, to: range.to, href: href };
}

// Odkaz, v ktorom práve stojí kurzor / výber.
function currentLinkTarget(editor) {
  var sel = editor.state.selection;
  return linkTargetAt(editor, sel.from, editor.getAttributes('link').href, sel.to - sel.from);
}

// Do lišty sa URL nezmestí celá; celá je v tooltipe.
function shortUrl(href) {
  var s = String(href || '').replace(/^https?:\/\//, '');
  return s.length > 42 ? s.slice(0, 40) + '…' : s;
}

/* Cesta späť: odkaz na prílohu → obrázok. Bez toho by sa voľba „len odkaz" dala vrátiť
   iba cez Ctrl+Z. `getTarget` vracia rozsah, na ktorý sa má siahnuť (viď `linkTargetAt`). */
function mkAsImageBtn(bar, editor, getTarget) {
  return mkBtn(bar, RE_I18N.asImage || 'Show as image', RE_I18N.asImage || 'Show as image',
    're-label', function () {
      var t = getTarget();
      var info = t && linkedAttachment(t.href);
      if (!info) return;
      editor.chain().focus().setTextSelection({ from: t.from, to: t.to }).deleteSelection().run();
      /* Náhľad v editore: najprv mapa uložených príloh (má správnu veľkosť), potom blob
         z tejto relácie (príloha ešte nie je uložená → server jej náhľad nevydá) a až
         nakoniec serverová cesta podľa id. Bez blob varianty tu bol rozbitý obrázok. */
      var src = attUrl(info.filename, 'thumb', THUMB_DEFAULT) ||
        previewForAttId(info.id) ||
        attachmentThumbUrl(info.id, THUMB_DEFAULT) ||
        info.filename;
      editor.chain().focus().insertContent({
        type: 'image',
        attrs: {
          src: src,
          filename: info.filename, alt: info.filename,
          display: 'thumb', size: THUMB_DEFAULT, attId: info.id
        }
      }).run();
    }, 'link-as-image');
}

function mkBar() {
  var bar = document.createElement('div');
  bar.className = 're-bubble';
  bar.style.display = 'none';
  document.body.appendChild(bar);
  return bar;
}

// `act` = stabilný identifikátor akcie (nezávislý od jazyka) — pre CSS aj testy.
function mkBtn(bar, label, title, cls, onRun, act) {
  var el = document.createElement('button');
  el.type = 'button';
  el.className = 're-bubble-btn' + (cls ? ' ' + cls : '');
  el.textContent = label;
  el.title = title || label;
  if (act) el.setAttribute('data-re-act', act);
  // mousedown + preventDefault → kurzor/výber v editore sa nestratí
  el.addEventListener('mousedown', function (ev) { ev.preventDefault(); onRun(); });
  bar.appendChild(el);
  return el;
}

function mkSep(bar) {
  var s = document.createElement('span');
  s.className = 're-bubble-sep';
  bar.appendChild(s);
}

// Umiestni lištu nad rozsah from..to v editore.
function place(bar, editor, from, to) {
  var s = editor.view.coordsAtPos(from);
  var e = editor.view.coordsAtPos(to);
  var box = bar.getBoundingClientRect();
  var midLeft = (Math.min(s.left, e.left) + Math.max(s.right || s.left, e.right || e.left)) / 2;
  bar.style.left = Math.max(8, midLeft - box.width / 2 + window.scrollX) + 'px';
  bar.style.top = (Math.min(s.top, e.top) + window.scrollY - box.height - 8) + 'px';
}

/* ---------- lišta pre označený text ---------- */

function buildTextBar(editor) {
  var bar = mkBar();

  // veľkosť textu (dropdown)
  var sizeBtn = mkBtn(bar, 'Aa', RE_I18N.textSize || 'Text size', 're-wide', function () { toggleMenu(); }, 'size');
  var caret = document.createElement('span');
  caret.className = 're-bubble-caret';
  caret.textContent = '▾';
  sizeBtn.appendChild(caret);

  var menu = document.createElement('div');
  menu.className = 're-bubble-menu';
  menu.style.display = 'none';
  bar.appendChild(menu); // vnútri lišty → blur guard (bar.contains) funguje

  var HEAD = [null, 1, 2, 3, 4];
  HEAD.forEach(function (level) {
    var row = document.createElement('div');
    row.className = 're-bubble-menu-item' + (level ? ' re-h' + level : '');
    row.setAttribute('data-re-act', level ? ('h' + level) : 'p');
    row.textContent = level
      ? ((RE_I18N.heading || 'Heading') + ' ' + level)
      : (RE_I18N.normalText || 'Normal text');
    row.addEventListener('mousedown', function (ev) {
      ev.preventDefault();
      if (level) editor.chain().focus().setNode('heading', { level: level }).run();
      else editor.chain().focus().setParagraph().run();
      closeMenu();
    });
    menu.appendChild(row);
  });

  function toggleMenu() { menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; }
  function closeMenu() { menu.style.display = 'none'; }

  mkSep(bar);

  var MARKS = [
    { label: 'B', title: 'Bold (Ctrl/Cmd+B)', name: 'bold', run: function (c) { return c.toggleBold(); } },
    { label: 'I', title: 'Italic (Ctrl/Cmd+I)', name: 'italic', cls: 're-i', run: function (c) { return c.toggleItalic(); } },
    { label: 'S', title: 'Strikethrough', name: 'strike', cls: 're-s', run: function (c) { return c.toggleStrike(); } },
    { label: '</>', title: 'Inline code', name: 'code', cls: 're-wide', run: function (c) { return c.toggleCode(); } },
    { label: '{ }', title: RE_I18N.codeBlock || 'Code block', name: 'codeBlock', cls: 're-wide', run: function (c) { return c.toggleCodeBlock(); } },
    { sep: true },
    { label: '•', title: RE_I18N.bulletList || 'Bullet list', name: 'bulletList', run: function (c) { return c.toggleBulletList(); } },
    { label: '1.', title: RE_I18N.numberedList || 'Numbered list', name: 'orderedList', cls: 're-wide', run: function (c) { return c.toggleOrderedList(); } },
    { label: '☑', title: RE_I18N.checklist || 'Checklist', name: 'taskList', run: function (c) { return c.toggleTaskList(); } },
    { sep: true },
    { label: '🔗', title: 'Link (Ctrl/Cmd+K)', name: 'link', run: null }
  ];

  var stateful = [];
  MARKS.forEach(function (b) {
    if (b.sep) { mkSep(bar); return; }
    var el = mkBtn(bar, b.label, b.title, b.cls, function () {
      closeMenu();
      if (b.run) b.run(editor.chain().focus()).run();
      else openLinkDialog(editor);
    }, b.name);
    stateful.push({ el: el, name: b.name });
  });

  // Odkaz na prílohu sa dá premeniť späť na obrázok aj odtiaľto (keď je jeho text označený).
  var bAsImage = mkAsImageBtn(bar, editor, function () { return currentLinkTarget(editor); });

  return {
    bar: bar,
    close: closeMenu,
    sync: function () {
      stateful.forEach(function (b) {
        if (editor.isActive(b.name)) b.el.classList.add('re-on');
        else b.el.classList.remove('re-on');
      });
      bAsImage.style.display = linkedAttachment(editor.getAttributes('link').href) ? '' : 'none';
      var lvl = 0;
      for (var i = 1; i <= 4; i++) { if (editor.isActive('heading', { level: i })) { lvl = i; break; } }
      sizeBtn.firstChild.nodeValue = lvl ? ('H' + lvl) : 'Aa';
      Array.prototype.forEach.call(menu.children, function (row, idx) {
        var level = idx === 0 ? 0 : idx;
        if (level === lvl) row.classList.add('re-active'); else row.classList.remove('re-active');
      });
    }
  };
}

/* ---------- lišta pre obrázok ---------- */

function buildImageBar(editor) {
  var bar = mkBar();
  bar.classList.add('re-bubble-img');

  function attrs() {
    var sel = editor.state.selection;
    return (sel instanceof NodeSelection && sel.node) ? sel.node.attrs : {};
  }

  // Pri prepnutí režimu/veľkosti prehoď aj `src`, aby náhľad v editore ukazoval správnu variantu
  // (na novom issue mapu príloh nemáme → ostane blob URL, veľkosť ostrihne CSS zo `renderHTML`).
  function apply(next) {
    var sel = editor.state.selection;
    if (!(sel instanceof NodeSelection)) return;
    var pos = sel.from;
    var a = sel.node.attrs;
    var display = next.display || a.display || 'full';
    var size = next.size || a.size || THUMB_DEFAULT;
    var patch = { display: display, size: size };
    var url = attUrl(a.filename, display, size);
    if (url) patch.src = url;
    // updateAttributes zhodí NodeSelection na kurzor → obnov ju, aby lišta ostala otvorená
    editor.chain().focus().updateAttributes('image', patch).setNodeSelection(pos).run();
  }

  /* „Len odkaz" — obrázok sa nahradí TEXTOM S ODKAZOM na prílohu.

     Odkaz je absolútny a kompletný (`https://host/attachments/<id>`), takže sa dá označiť,
     skopírovať a poslať kolegovi; Redmine si od neho vyžiada prihlásenie. Popisok („screenshot")
     je rovno označený, takže ho používateľ prepíše písaním.

     Fallback na pôvodné `attachment:názov` ostáva pre prípad, že by sa id prílohy nepodarilo
     zistiť (napr. obrázok vložený mimo nášho uploadu) — vtedy je lepší funkčný Redmine odkaz
     než nič. */
  function toLink() {
    var a = attrs();
    var name = a.filename || a.alt || '';
    if (!name) return;
    var id = a.attId || attIdFor(name);
    var href = attachmentPageUrl(id);
    editor.chain().focus().deleteSelection().run();
    if (href) {
      insertLinkedLabel(editor, href, RE_I18N.linkLabel || 'screenshot');
    } else {
      editor.chain().focus().insertContent({ type: 'text', text: 'attachment:' + name }).run();
      editor.chain().focus().insertContent(' ').run();
    }
  }

  function step(dir) {
    var a = attrs();
    var cur = a.size || THUMB_DEFAULT;
    var i = THUMB_SIZES.indexOf(cur);
    if (i < 0) { i = THUMB_SIZES.indexOf(THUMB_DEFAULT); if (i < 0) i = 0; }
    var next = THUMB_SIZES[Math.min(THUMB_SIZES.length - 1, Math.max(0, i + dir))];
    apply({ display: 'thumb', size: next });
  }

  var bThumb = mkBtn(bar, RE_I18N.imgSmall || 'Small preview', RE_I18N.imgSmall || 'Small preview', 're-label', function () { apply({ display: 'thumb' }); }, 'img-thumb');
  var bFull = mkBtn(bar, RE_I18N.imgFull || 'Full width', RE_I18N.imgFull || 'Full width', 're-label', function () { apply({ display: 'full' }); }, 'img-full');
  mkBtn(bar, RE_I18N.imgLink || 'Link only', RE_I18N.imgLink || 'Link only', 're-label', toLink, 'img-link');
  mkSep(bar);
  var bMinus = mkBtn(bar, '−', RE_I18N.imgSmaller || 'Smaller preview', null, function () { step(-1); }, 'img-smaller');
  var bPlus = mkBtn(bar, '+', RE_I18N.imgBigger || 'Bigger preview', null, function () { step(1); }, 'img-bigger');

  return {
    bar: bar,
    close: function () {},
    sync: function () {
      var a = attrs();
      var thumb = a.display === 'thumb';
      bThumb.classList.toggle('re-on', thumb);
      bFull.classList.toggle('re-on', !thumb);
      var i = THUMB_SIZES.indexOf(a.size || THUMB_DEFAULT);
      bMinus.disabled = thumb && i === 0;
      bPlus.disabled = thumb && i === THUMB_SIZES.length - 1;
    }
  };
}

/* ---------- lišta pre odkaz ---------- */

/* Editor je zároveň čítacia plocha popisu issue (F3), takže odkaz musí ísť aj otvoriť.
   Samotný klik ho otvorí (`openOnClick`), ale bez tejto lišty by sa už nedal upraviť
   ani vrátiť späť na obrázok — kurzor sa do odkazu myšou nedostane. */
function buildLinkBar(editor) {
  var bar = mkBar();
  bar.classList.add('re-bubble-link');
  var target = null;

  var url = document.createElement('span');
  url.className = 're-bubble-url';
  bar.appendChild(url);
  mkSep(bar);

  mkBtn(bar, RE_I18N.openLink || 'Open', RE_I18N.openLink || 'Open', 're-label', function () {
    if (target) window.open(target.href, '_blank', 'noopener');
  }, 'link-open');

  mkBtn(bar, RE_I18N.editLink || 'Edit link', RE_I18N.editLink || 'Edit link', 're-label', function () {
    if (!target) return;
    // dialóg si berie rozsah z výberu → najprv naň postav výber (pri prejdení myšou je inde)
    editor.chain().focus().setTextSelection({ from: target.from, to: target.to }).run();
    openLinkDialog(editor);
  }, 'link-edit');

  var bAsImage = mkAsImageBtn(bar, editor, function () { return target; });

  return {
    bar: bar,
    close: function () {},
    setTarget: function (t) { target = t; },
    sync: function () {
      if (!target) return;
      url.textContent = shortUrl(target.href);
      url.title = target.href;
      bAsImage.style.display = linkedAttachment(target.href) ? '' : 'none';
    }
  };
}

export function attachBubble(editor) {
  var text = buildTextBar(editor);
  var img = buildImageBar(editor);
  var link = buildLinkBar(editor);
  var bars = [text, img, link];

  // odkaz práve pod myšou; kým je nastavený, má prednosť pred kurzorom (aj v needitovanom editore)
  var hovered = null;
  var hoverTimer = null;

  function hideAll() {
    bars.forEach(function (b) { b.close(); b.bar.style.display = 'none'; });
  }

  function show(which, from, to) {
    bars.forEach(function (b) {
      if (b === which) return;
      b.close();
      b.bar.style.display = 'none';
    });
    which.sync();
    which.bar.style.display = 'flex';
    place(which.bar, editor, from, to);
  }

  function showLink(t) {
    link.setTarget(t);
    show(link, t.from, t.to);
  }

  /* Odkaz spod myši mohol medzitým z dokumentu zmiznúť — typicky práve tým, že sme ho z tejto
     lišty premenili na obrázok. `mouseout` v takom prípade nepríde (element sa nezrušil pod
     myšou, ale odstránil z DOM), takže bez tejto kontroly by `hovered` ostalo nastavené navždy
     a ŽIADNA lišta by sa už neukázala. */
  function hoverAlive() {
    if (!hovered || hovered.from > editor.state.doc.content.size) return false;
    try { return !!getMarkRange(editor.state.doc.resolve(hovered.from), editor.state.schema.marks.link); }
    catch (e) { return false; }
  }

  function update() {
    if (hovered && !hoverAlive()) hovered = null;
    if (hovered) return;
    if (!editor.isEditable || !editor.isFocused) { hideAll(); return; }
    var sel = editor.state.selection;
    if (sel instanceof NodeSelection && sel.node && sel.node.type.name === 'image') {
      show(img, sel.from, sel.to);
      return;
    }
    var hasText = !sel.empty && editor.state.doc.textBetween(sel.from, sel.to, ' ').trim().length > 0;
    if (!hasText) {
      var t = sel.empty && currentLinkTarget(editor);
      if (t) { showLink(t); return; }
      hideAll();
      return;
    }
    show(text, sel.from, sel.to);
  }

  /* Prejdenie myšou. Editor nemusí byť ani zafokusovaný — na detaile issue je toto bežný stav
     (človek si len číta popis) a práve tam odkaz najčastejšie treba. */
  function hoverOff() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () { hovered = null; update(); }, 220);
  }

  var dom = editor.view.dom;
  dom.addEventListener('mouseover', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a || !dom.contains(a)) return;
    var pos;
    try { pos = editor.view.posAtDOM(a, 0); } catch (e) { return; }
    var t = linkTargetAt(editor, pos, a.getAttribute('href'), (a.textContent || '').length);
    if (!t) return;
    clearTimeout(hoverTimer);
    hovered = t;
    showLink(t);
  });
  dom.addEventListener('mouseout', function (ev) {
    if (!ev.target || !ev.target.closest || !ev.target.closest('a[href]')) return;
    hoverOff();
  });
  link.bar.addEventListener('mouseenter', function () { clearTimeout(hoverTimer); });
  link.bar.addEventListener('mouseleave', hoverOff);

  editor.on('selectionUpdate', update);
  editor.on('transaction', update);
  editor.on('blur', function () {
    setTimeout(function () {
      if (hovered) return;
      var focused = bars.some(function (b) { return b.bar.contains(document.activeElement); });
      if (focused) return;
      hideAll();
    }, 120);
  });
  editor.on('destroy', function () { bars.forEach(function (b) { b.bar.remove(); }); });
  return text.bar;
}
