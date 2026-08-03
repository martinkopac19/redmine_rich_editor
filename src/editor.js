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
import { attachBubble, promptLink } from './bubble.js';

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
    Placeholder.configure({ placeholder: 'Píš… („/" pre bloky)' }),
    SlashCommand,
    LinkShortcut,
    Markdown.configure({ html: false, linkify: false, breaks: false, transformPastedText: true })
  ];
}

function mountOver(textarea) {
  if (textarea.dataset.reMounted) return;
  try {
    textarea.dataset.reMounted = '1';

    var wrapper = document.createElement('div');
    wrapper.className = 're-editor';
    textarea.parentNode.insertBefore(wrapper, textarea);
    textarea.style.display = 'none';

    var editor = new Editor({
      element: wrapper,
      extensions: extensions(),
      content: textarea.value || '',
      onUpdate: function (props) {
        textarea.value = props.editor.storage.markdown.getMarkdown();
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    attachBubble(editor);
    textarea._reEditor = editor;

    // Re-sync, keď textareu naplní niekto zvonku (napr. vloženie šablóny).
    textarea.addEventListener('re:resync', function () {
      editor.commands.setContent(textarea.value || '');
    });
  } catch (e) {
    textarea.dataset.reMounted = '';
    textarea.style.display = '';
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
