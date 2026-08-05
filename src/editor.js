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
import { ReImage } from './image.js';
import { preprocess } from './md-compat.js';
import { ReHardBreak } from './hardbreak.js';
import { SlashCommand } from './slash.js';
import { IssueSuggest, EmojiSuggest, MentionSuggest } from './tokens.js';
import { attachBubble, promptLink } from './bubble.js';
import { handleFiles, openFilePicker, renameClipboardFiles } from './attachments.js';
import { liveDescription, liveTitle, liveComments, keepLastTabCookie } from './live.js';
import { dedupeThumbnails } from './dedupe.js';

var CFG = window.RE_CONFIG || {};
var I = CFG.i18n || {};

// Ktoré textarey preberáme (dlhodobo stabilné Redmine id-čka).
var SELECTOR = 'textarea#issue_description, textarea#issue_notes';

// Cmd/Ctrl+K = odkaz nad označeným textom.
var LinkShortcut = Extension.create({
  name: 'reLinkShortcut',
  addKeyboardShortcuts: function () {
    var self = this;
    return {
      'Mod-k': function () { promptLink(self.editor); return true; },
      'Mod-Shift-a': function () { openFilePicker(self.editor); return true; }
    };
  }
});

function extensions() {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, hardBreak: false }),
    ReHardBreak,
    Link.configure({ openOnClick: false, autolink: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow, TableHeader, TableCell,
    ReImage.configure({ inline: true }),
    Placeholder.configure({ placeholder: I.placeholder || 'Write…  ("/" for blocks)' }),
    SlashCommand,
    IssueSuggest,
    EmojiSuggest,
    MentionSuggest,
    LinkShortcut,
    Markdown.configure({ html: false, linkify: false, breaks: true, transformPastedText: true })
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

    var reWriting = false; // guard: rozlíš náš zápis do textarey od externého (šablóny)
    var editor = new Editor({
      element: wrapper,
      extensions: extensions(),
      content: preprocess(textarea.value || ''),
      editorProps: {
        handlePaste: function (view, event) {
          var files = event.clipboardData && event.clipboardData.files;
          // z clipboardu majú obrázky generické „image.png" → premenuj (viď attachments.js)
          if (files && files.length) { handleFiles(editor, renameClipboardFiles(files)); return true; }
          return false;
        },
        handleDrop: function (view, event) {
          var files = event.dataTransfer && event.dataTransfer.files;
          if (files && files.length) { event.preventDefault(); handleFiles(editor, files); return true; }
          return false;
        }
      },
      onUpdate: function (props) {
        reWriting = true;
        textarea.value = props.editor.storage.markdown.getMarkdown();
        reWriting = false;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    textarea._reEditor = editor;

    // Externá zmena textarey (napr. vloženie šablóny cez redmine_issue_templates, ktoré
    // nastaví .value priamo bez eventu) → premietni ju do editora. reWriting bráni slučke.
    try {
      var vdesc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      Object.defineProperty(textarea, 'value', {
        configurable: true,
        get: function () { return vdesc.get.call(this); },
        set: function (val) {
          vdesc.set.call(this, val);
          if (!reWriting) { try { editor.commands.setContent(preprocess(val || '')); } catch (e) {} }
        }
      });
    } catch (e) {}
    textarea.addEventListener('re:resync', function () {
      editor.commands.setContent(preprocess(textarea.value || ''));
    });
    attachBubble(editor);

    // F3: na detaile issue urob popis "live" (editor nahradí rendered popis + auto-save)
    if (textarea.id === 'issue_description' && document.getElementById('issue_description_wiki')) {
      try { liveDescription(editor, textarea); } catch (e) {}
    }
    if (textarea.id === 'issue_notes' && document.getElementById('history')) {
      try { liveComments(editor, textarea); } catch (e) {}
    }
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
  // obrázok, ktorý je už v texte, nemusí mať aj natívny náhľad pod ním
  try { dedupeThumbnails(); } catch (e) {}
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
  try { if (document.getElementById('issue-form')) liveTitle(); } catch (e) {}
  try { keepLastTabCookie(); } catch (e) {}
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
