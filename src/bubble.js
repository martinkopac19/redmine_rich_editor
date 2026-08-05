/* Bublinové lišty (vlastné, bez tippy):
     - po označení textu: veľkosť textu, formátovanie, bloky (odrážky/číslovanie/checklist/kód), odkaz
     - po kliknutí na obrázok: Malý náhľad / Plná šírka / Len odkaz + veľkosť náhľadu */
import { NodeSelection } from '@tiptap/pm/state';
import { THUMB_SIZES, THUMB_DEFAULT } from './md-compat.js';
import { attUrl } from './image.js';

var RE_I18N = (window.RE_CONFIG || {}).i18n || {};

export function promptLink(editor) {
  var prev = editor.getAttributes('link').href || '';
  var url = window.prompt(RE_I18N.link || 'Link (URL):', prev);
  if (url === null) return;
  if (url.trim() === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
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
      else promptLink(editor);
    }, b.name);
    stateful.push({ el: el, name: b.name });
  });

  return {
    bar: bar,
    close: closeMenu,
    sync: function () {
      stateful.forEach(function (b) {
        if (editor.isActive(b.name)) b.el.classList.add('re-on');
        else b.el.classList.remove('re-on');
      });
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

  function toLink() {
    var a = attrs();
    var name = a.filename || a.alt || '';
    if (!name) return;
    editor.chain().focus().deleteSelection()
      .insertContent({ type: 'text', text: 'attachment:' + name }).run();
    editor.chain().focus().insertContent(' ').run();
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

export function attachBubble(editor) {
  var text = buildTextBar(editor);
  var img = buildImageBar(editor);

  function hideAll() {
    text.close();
    text.bar.style.display = 'none';
    img.bar.style.display = 'none';
  }

  function show(which, from, to) {
    var other = which === text ? img : text;
    other.close();
    other.bar.style.display = 'none';
    which.sync();
    which.bar.style.display = 'flex';
    place(which.bar, editor, from, to);
  }

  function update() {
    if (!editor.isEditable || !editor.isFocused) { hideAll(); return; }
    var sel = editor.state.selection;
    if (sel instanceof NodeSelection && sel.node && sel.node.type.name === 'image') {
      show(img, sel.from, sel.to);
      return;
    }
    var hasText = !sel.empty && editor.state.doc.textBetween(sel.from, sel.to, ' ').trim().length > 0;
    if (!hasText) { hideAll(); return; }
    show(text, sel.from, sel.to);
  }

  editor.on('selectionUpdate', update);
  editor.on('transaction', update);
  editor.on('blur', function () {
    setTimeout(function () {
      if (text.bar.contains(document.activeElement) || img.bar.contains(document.activeElement)) return;
      hideAll();
    }, 120);
  });
  editor.on('destroy', function () { text.bar.remove(); img.bar.remove(); });
  return text.bar;
}
