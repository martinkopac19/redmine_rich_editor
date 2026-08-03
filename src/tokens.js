/* F2 tokeny: #issue autocomplete + emoji `:`. Oba vkladajú čistý text/Unicode
   (round-trip cez Markdown; Redmine sám sprav #123 odkaz aj @mention notifikáciu). */
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { EMOJI } from './emoji-data.js';

var CFG = window.RE_CONFIG || {};
var base = CFG.base || '';

// Zdieľaný popup renderer pre suggestion (rovnaký vzhľad ako slash paleta).
function makePopup(labelFn, emptyText) {
  var box, items = [], sel = 0, cmd = null;
  function paint() {
    box.innerHTML = '';
    if (!items.length) {
      var e = document.createElement('div'); e.className = 're-slash-empty';
      e.textContent = emptyText || 'No results'; box.appendChild(e); return;
    }
    items.forEach(function (it, i) {
      var row = document.createElement('div');
      row.className = 're-slash-item' + (i === sel ? ' re-active' : '');
      row.textContent = labelFn(it);
      row.addEventListener('mousedown', function (ev) { ev.preventDefault(); if (cmd) cmd(items[i]); });
      row.addEventListener('mousemove', function () { sel = i; paint(); });
      box.appendChild(row);
    });
  }
  function place(rect) {
    if (!rect || !box) return;
    box.style.left = (rect.left + window.scrollX) + 'px';
    box.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  }
  return {
    onStart: function (props) {
      cmd = props.command; items = props.items || []; sel = 0;
      box = document.createElement('div'); box.className = 're-slash';
      document.body.appendChild(box); paint(); place(props.clientRect && props.clientRect());
    },
    onUpdate: function (props) {
      cmd = props.command; items = props.items || []; sel = 0;
      paint(); place(props.clientRect && props.clientRect());
    },
    onKeyDown: function (props) {
      var k = props.event.key;
      if (k === 'ArrowDown') { sel = (sel + 1) % Math.max(items.length, 1); paint(); return true; }
      if (k === 'ArrowUp') { sel = (sel - 1 + items.length) % Math.max(items.length, 1); paint(); return true; }
      if (k === 'Enter') { if (cmd && items[sel]) cmd(items[sel]); return true; }
      if (k === 'Escape') { if (box) box.remove(); return true; }
      return false;
    },
    onExit: function () { if (box) { box.remove(); box = null; } }
  };
}

// #issue — hľadá cez existujúci command_palette endpoint (scope=i). Ak chýba/zlyhá,
// popup sa nezobrazí a `#123` sa dá napísať ručne (Redmine ho aj tak sprav odkazom).
export var IssueSuggest = Extension.create({
  name: 'reIssueSuggest',
  addProseMirrorPlugins: function () {
    return [Suggestion({
      editor: this.editor,
      pluginKey: new PluginKey('reIssue'),
      char: '#',
      allowSpaces: false,
      startOfLine: false,
      items: function (props) {
        var query = props.query;
        if (!query || query.length < 1) return [];
        return fetch(base + '/command_palette/search?scope=i&q=' + encodeURIComponent(query), {
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
        }).then(function (r) { return r.ok ? r.json() : { groups: [] }; })
          .then(function (data) {
            var out = [];
            (data.groups || []).forEach(function (g) {
              (g.items || []).forEach(function (it) {
                if (it.issue_id) out.push({ id: it.issue_id, label: '#' + it.issue_id + '  ' + (it.label || '') });
              });
            });
            return out.slice(0, 8);
          }).catch(function () { return []; });
      },
      command: function (props) {
        props.editor.chain().focus().deleteRange(props.range).insertContent('#' + props.props.id + ' ').run();
      },
      render: function () { return makePopup(function (it) { return it.label; }, 'No issues'); }
    })];
  }
});

// emoji `:` — malý zabudovaný set; vkladá Unicode. Popup až od 2 znakov (nech neruší text ako 12:30).
export var EmojiSuggest = Extension.create({
  name: 'reEmojiSuggest',
  addProseMirrorPlugins: function () {
    return [Suggestion({
      editor: this.editor,
      pluginKey: new PluginKey('reEmoji'),
      char: ':',
      allowSpaces: false,
      startOfLine: false,
      items: function (props) {
        var q = (props.query || '').toLowerCase();
        if (q.length < 2) return [];
        return EMOJI.filter(function (e) {
          return e.n.indexOf(q) >= 0 || (e.k && e.k.indexOf(q) >= 0);
        }).slice(0, 8);
      },
      command: function (props) {
        props.editor.chain().focus().deleteRange(props.range).insertContent(props.props.c + ' ').run();
      },
      render: function () { return makePopup(function (it) { return it.c + '   ' + it.n; }, 'No emoji'); }
    })];
  }
});
