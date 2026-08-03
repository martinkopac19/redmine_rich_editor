/* Redmine Rich Editor (Previo) — F0: mount nad textareou + Markdown round-trip.
   Upgrade-safe: progresívne vylepšenie. Ak čokoľvek zlyhá, necháme natívnu textareu. */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

// Ktoré textarey preberáme (dlhodobo stabilné Redmine id-čka).
var SELECTOR = 'textarea#issue_description, textarea#issue_notes';

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
      extensions: [
        StarterKit,
        Markdown.configure({ html: false, linkify: false, breaks: false, transformPastedText: true })
      ],
      content: textarea.value || '',
      onUpdate: function (props) {
        // serializuj späť do Markdownu do "source of truth" textarey (+ input event pre Redmine)
        textarea.value = props.editor.storage.markdown.getMarkdown();
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    textarea._reEditor = editor;

    // Re-sync, keď textareu naplní niekto zvonku (napr. vloženie šablóny).
    // (Redmine/šablóny menia .value priamo → to sám event nevyvolá; preto aj manuálny hook.)
    textarea.addEventListener('re:resync', function () {
      editor.commands.setContent(textarea.value || '');
    });
  } catch (e) {
    // fallback: zruš príznak a nechaj natívnu textareu viditeľnú
    textarea.dataset.reMounted = '';
    textarea.style.display = '';
    if (window.console) console.error('[rich_editor] mount failed, using native textarea:', e);
  }
}

function scan() {
  var list = document.querySelectorAll(SELECTOR);
  for (var i = 0; i < list.length; i++) mountOver(list[i]);
}

// Debounce: MutationObserver nesmie spúšťať scan() pri každej mutácii
// (ProseMirror generuje veľa mutácií pri písaní) → inak zbytočná záťaž.
var scanScheduled = false;
function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  setTimeout(function () { scanScheduled = false; scan(); }, 250);
}

function init() {
  scan();
  // Turbo/AJAX: nové formuláre (nový komentár, edit) sa môžu doplniť neskôr
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
