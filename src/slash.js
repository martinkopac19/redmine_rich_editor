/* Slash `/` paleta blokov — Linear-style. Vlastný popup (bez tippy). */
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';

var RE_I18N = (window.RE_CONFIG || {}).i18n || {};

var ITEMS = [
  { title: 'Heading 1', kw: 'h1 nadpis heading', run: function (c) { return c.setNode('heading', { level: 1 }); } },
  { title: 'Heading 2', kw: 'h2 nadpis heading', run: function (c) { return c.setNode('heading', { level: 2 }); } },
  { title: 'Heading 3', kw: 'h3 nadpis heading', run: function (c) { return c.setNode('heading', { level: 3 }); } },
  { title: 'Heading 4', kw: 'h4 nadpis heading', run: function (c) { return c.setNode('heading', { level: 4 }); } },
  { title: 'Bullet list', kw: 'ul bullet odrazky zoznam list', run: function (c) { return c.toggleBulletList(); } },
  { title: 'Numbered list', kw: 'ol ordered cislovany zoznam list', run: function (c) { return c.toggleOrderedList(); } },
  { title: 'Checklist', kw: 'task todo checklist checkbox ulohy', run: function (c) { return c.toggleTaskList(); } },
  { title: 'Quote', kw: 'blockquote citacia quote', run: function (c) { return c.toggleBlockquote(); } },
  { title: 'Code block', kw: 'code kod pre', run: function (c) { return c.toggleCodeBlock(); } },
  { title: 'Table', kw: 'table tabulka', run: function (c) { return c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }); } },
  { title: 'Divider', kw: 'hr divider oddelovac ruler line', run: function (c) { return c.setHorizontalRule(); } }
];

function filterItems(query) {
  var q = (query || '').toLowerCase().trim();
  if (!q) return ITEMS;
  return ITEMS.filter(function (it) {
    return it.title.toLowerCase().indexOf(q) >= 0 || it.kw.indexOf(q) >= 0;
  });
}

// Vlastný popup renderer pre suggestion.
function makeRenderer() {
  var box, items = [], sel = 0, cmd = null;

  function paint() {
    box.innerHTML = '';
    if (!items.length) {
      var e = document.createElement('div'); e.className = 're-slash-empty'; e.textContent = RE_I18N.noBlocks || 'No blocks';
      box.appendChild(e); return;
    }
    items.forEach(function (it, i) {
      var row = document.createElement('div');
      row.className = 're-slash-item' + (i === sel ? ' re-active' : '');
      row.textContent = it.title;
      row.addEventListener('mousedown', function (ev) { ev.preventDefault(); pick(i); });
      row.addEventListener('mousemove', function () { sel = i; paint(); });
      box.appendChild(row);
    });
  }
  function place(rect) {
    if (!rect) return;
    box.style.left = (rect.left + window.scrollX) + 'px';
    box.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  }
  function pick(i) { var it = items[i]; if (it && cmd) cmd(it); }

  return {
    onStart: function (props) {
      cmd = props.command;
      items = props.items; sel = 0;
      box = document.createElement('div');
      box.className = 're-slash';
      document.body.appendChild(box);
      paint(); place(props.clientRect && props.clientRect());
    },
    onUpdate: function (props) {
      cmd = props.command; items = props.items; sel = 0;
      paint(); place(props.clientRect && props.clientRect());
    },
    onKeyDown: function (props) {
      var k = props.event.key;
      if (k === 'ArrowDown') { sel = (sel + 1) % Math.max(items.length, 1); paint(); return true; }
      if (k === 'ArrowUp') { sel = (sel - 1 + items.length) % Math.max(items.length, 1); paint(); return true; }
      if (k === 'Enter') { pick(sel); return true; }
      if (k === 'Escape') { if (box) box.remove(); return true; }
      return false;
    },
    onExit: function () { if (box) { box.remove(); box = null; } }
  };
}

export var SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins: function () {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: function (props) { return filterItems(props.query); },
        command: function (props) {
          // props.props = vybraný item; zmaž "/query" a spusti akciu
          var chain = props.editor.chain().focus().deleteRange(props.range);
          props.props.run(chain).run();
        },
        render: makeRenderer
      })
    ];
  }
});
