/* F2 tokeny: #issue autocomplete + emoji `:`. Oba vkladajú čistý text/Unicode
   (round-trip cez Markdown; Redmine sám sprav #123 odkaz aj @mention notifikáciu). */
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { EMOJI } from './emoji-data.js';
import { isEmoticonTail } from './emoticons.js';

var CFG = window.RE_CONFIG || {};
var base = CFG.base || '';

// prvé návrhy hneď po `:` (najpoužívanejšie v práci)
var EMOJI_DEFAULTS = ['thumbsup', 'check', 'fire', 'rocket', 'tada', 'heart', 'eyes', 'pray']
  .map(function (n) { return EMOJI.filter(function (e) { return e.n === n; })[0]; })
  .filter(Boolean);

// `@`/`:` sa spustí len keď začína slovo (po medzere/na začiatku) → neruší email / 12:30
function wordStartAllow(props) {
  var from = props.range.from;
  var before = from > 0 ? props.state.doc.textBetween(from - 1, from, '\n', '') : '';
  return before === '' || /\s/.test(before);
}

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
      /* Popup sa pri emotikone nesmie ani otvoriť. Vrátiť z `items` prázdne pole
         NESTAČÍ — renderer v takom prípade vykreslí hlášku „No emoji", takže
         `:O` síce nevložilo nezmysel, ale zobrazilo prázdne okno. */
      allow: function (props) {
        if (!wordStartAllow(props)) return false;
        var txt = props.state.doc.textBetween(props.range.from, props.range.to, '', '');
        return !isEmoticonTail(txt.replace(/^:/, ''));
      },
      items: function (props) {
        var q = (props.query || '').toLowerCase();
        if (!q) return EMOJI_DEFAULTS; // hneď po `:` ukáž prvé návrhy

        /* `:D`, `:O`, `:P`… nie je hľadanie, ale emotikon — popup by doň len
           zavadzal a jeho prvá položka sa dala omylom potvrdiť. Premenu na emoji
           robia input rules (emoticons.js). Dopyty od dvoch znakov (`:dog`)
           to neobmedzuje. */
        if (isEmoticonTail(props.query || '')) return []; // poistka, ak by `allow` neprebehol

        /* Poradie podľa toho, ako tesne to sedí. Predtým sa filtrovalo obyčajným
           `indexOf` cez názov aj kľúčové slová, takže `:d` vrátilo ako prvé `cry`
           (kľúčové slovo „sad") a `:o` zase `smile` (cez „joy"). */
        function rank(e) {
          if (e.n === q) return 0;                                   // presný názov
          if (e.n.indexOf(q) === 0) return 1;                        // názov začína dopytom
          var kw = (e.k || '').split(/s+/);
          if (kw.indexOf(q) >= 0) return 2;                          // presné kľúčové slovo
          if (kw.some(function (w) { return w.indexOf(q) === 0; })) return 3; // kľúčové slovo začína
          if (e.n.indexOf(q) > 0) return 4;                          // niekde v názve
          return 5;                                                  // niekde v kľúčových slovách
        }
        return EMOJI
          .filter(function (e) { return e.n.indexOf(q) >= 0 || (e.k && e.k.indexOf(q) >= 0); })
          .map(function (e, i) { return { e: e, r: rank(e), i: i }; })
          .sort(function (a, b) { return a.r - b.r || a.i - b.i; })  // pri zhode pôvodné poradie
          .slice(0, 8)
          .map(function (x) { return x.e; });
      },
      command: function (props) {
        props.editor.chain().focus().deleteRange(props.range).insertContent(props.props.c + ' ').run();
      },
      render: function () { return makePopup(function (it) { return it.c + '   ' + it.n; }, 'No emoji'); }
    })];
  }
});

// @mention — členovia projektu cez vlastný endpoint; vloží `@login` (Redmine natívne notifikuje).
export var MentionSuggest = Extension.create({
  name: 'reMentionSuggest',
  addProseMirrorPlugins: function () {
    return [Suggestion({
      editor: this.editor,
      pluginKey: new PluginKey('reMention'),
      char: '@',
      allowSpaces: false,
      startOfLine: false,
      allow: wordStartAllow,
      items: function (props) {
        var url = base + '/rich_editor/mentionables?q=' + encodeURIComponent(props.query || '') +
          (CFG.projectId ? '&project_id=' + CFG.projectId : '');
        return fetch(url, {
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
        }).then(function (r) { return r.ok ? r.json() : []; })
          .then(function (list) { return (list || []).slice(0, 8); })
          .catch(function () { return []; });
      },
      command: function (props) {
        props.editor.chain().focus().deleteRange(props.range).insertContent('@' + props.props.login + ' ').run();
      },
      render: function () { return makePopup(function (it) { return it.name + '   (@' + it.login + ')'; }, 'No people'); }
    })];
  }
});
