/* Redmine Rich Editor (Previo) — F1: Linear-style UX nad textareou.
   Upgrade-safe: progresívne vylepšenie. Ak čokoľvek zlyhá, necháme natívnu textareu. */
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { SlashCommand } from './slash.js';
import { IssueSuggest, EmojiSuggest } from './tokens.js';
import { attachBubble, promptLink } from './bubble.js';

var CFG = window.RE_CONFIG || {};
var I = CFG.i18n || {};

// Ktoré textarey preberáme (dlhodobo stabilné Redmine id-čka).
var SELECTOR = 'textarea#issue_description, textarea#issue_notes';

// Cmd/Ctrl+K = odkaz nad označeným textom.
var LinkShortcut = Extension.create({
  name: 'reLinkShortcut',
  addKeyboardShortcuts: function () {
    var self = this;
    return { 'Mod-k': function () { promptLink(self.editor); return true; } };
  }
});

function extensions() {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
    Link.configure({ openOnClick: false, autolink: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow, TableHeader, TableCell,
    Placeholder.configure({ placeholder: I.placeholder || 'Write…  ("/" for blocks)' }),
    SlashCommand,
    IssueSuggest,
    EmojiSuggest,
    LinkShortcut,
    Markdown.configure({ html: false, linkify: false, breaks: false, transformPastedText: true })
  ];
}

function nativeBlock(ta) { return ta.closest('.jstBlock'); }

function mountOver(textarea) {
  // už namountované → len zabezpeč, že natívny widget ostáva skrytý
  if (textarea.dataset.reMounted) {
    var b0 = nativeBlock(textarea);
    if (b0) b0.style.display = 'none';
    return;
  }
  // Počkaj, kým Redmine jsToolBar vytvorí .jstBlock (tabs Edit/Preview + toolbar),
  // aby sme vedeli skryť CELÝ natívny widget, nie len textareu. Observer nás zavolá znova;
  // ak do 1,5 s .jstBlock nepríde, mountneme na holú textareu (fallback).
  var block = nativeBlock(textarea);
  if (!block) {
    if (!textarea.dataset.reWait) {
      textarea.dataset.reWait = '1';
      setTimeout(function () { textarea.dataset.reForce = '1'; scan(); }, 1500);
    }
    if (!textarea.dataset.reForce) return;
  }
  try {
    textarea.dataset.reMounted = '1';
    var anchor = block || textarea;

    var wrapper = document.createElement('div');
    wrapper.className = 're-editor';
    anchor.parentNode.insertBefore(wrapper, anchor.nextSibling);
    // skry celý natívny widget; textarea (vnútri) ostáva ako "source of truth" pre uloženie
    if (block) block.style.display = 'none'; else textarea.style.display = 'none';

    var editor = new Editor({
      element: wrapper,
      extensions: extensions(),
      content: textarea.value || '',
      onUpdate: function (props) {
        textarea.value = props.editor.storage.markdown.getMarkdown();
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    textarea._reEditor = editor;

    // Re-sync, keď textareu naplní niekto zvonku (napr. vloženie šablóny).
    textarea.addEventListener('re:resync', function () {
      editor.commands.setContent(textarea.value || '');
    });
    attachBubble(editor);
  } catch (e) {
    // NEopakovať mount pri zlyhaní (inak observer spustí storm) → natívny fallback
    textarea.dataset.reMounted = 'failed';
    if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
    if (block) block.style.display = ''; else textarea.style.display = '';
    if (window.console) console.error('[rich_editor] mount failed, using native textarea:', e);
  }
}

function scan() {
  var list = document.querySelectorAll(SELECTOR);
  for (var i = 0; i < list.length; i++) mountOver(list[i]);
}

// Debounce: MutationObserver nesmie spúšťať scan() pri každej mutácii.
var scanScheduled = false;
function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  setTimeout(function () { scanScheduled = false; scan(); }, 250);
}

function init() {
  scan();
  try {
    var mo = new MutationObserver(scheduleScan);
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
