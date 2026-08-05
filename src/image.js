/* Image node s dvoma režimami zobrazenia:
     display: 'full'  → do Markdownu ide `![alt](filename)`            (obrázok v plnej šírke)
     display: 'thumb' → do Markdownu ide `{{thumbnail(filename, size=N)}}` (malý klikateľný náhľad)

   `src` je len na zobrazenie v editore; do Markdownu ide vždy `filename`, aby to Redmine po uložení
   vykreslil. Zdroj `src`:
     - nový upload → blob URL (vidno hneď, ešte nemá verejnú URL),
     - existujúca príloha → URL z mapy `RE_CONFIG.atts` (naplní hooks.rb na detaile issue). */
import Image from '@tiptap/extension-image';
import { mergeAttributes } from '@tiptap/core';
import { THUMB_MARK, THUMB_DEFAULT } from './md-compat.js';

function atts() { return (window.RE_CONFIG || {}).atts || {}; }

// "file.png#re-thumb-320" → { filename:'file.png', display:'thumb', size:320 }
export function splitMark(raw) {
  var s = String(raw || '');
  var i = s.indexOf(THUMB_MARK);
  if (i < 0) return { filename: s, display: 'full', size: THUMB_DEFAULT };
  return {
    filename: s.slice(0, i),
    display: 'thumb',
    size: parseInt(s.slice(i + THUMB_MARK.length), 10) || THUMB_DEFAULT
  };
}

// filename → URL zobraziteľná v editore (len keď máme mapu príloh, t. j. na detaile issue).
export function attUrl(filename, display, size) {
  var a = atts()[filename];
  if (!a) return null;
  if (display === 'thumb' && a.t) return a.t + '/' + (size || THUMB_DEFAULT);
  return a.u || null;
}

export var ReImage = Image.extend({
  addAttributes: function () {
    var parent = this.parent ? this.parent() : {};
    return Object.assign({}, parent, {
      // src prepíšeme: z markdownu prichádza iba filename (+ prípadný #re-thumb-N marker),
      // čo prehliadač nevie načítať → nahraď reálnou URL prílohy, ak ju poznáme.
      src: {
        default: null,
        parseHTML: function (el) {
          var raw = el.getAttribute('src') || '';
          if (/^(blob:|data:|https?:|\/)/i.test(raw)) return raw; // už hotová URL (blob/nový upload)
          var info = splitMark(raw);
          var name = el.getAttribute('data-filename') || info.filename;
          return attUrl(name, info.display, info.size) || raw;
        },
        renderHTML: function (attrs) { return attrs.src ? { src: attrs.src } : {}; }
      },
      filename: {
        default: null,
        parseHTML: function (el) {
          return el.getAttribute('data-filename') || splitMark(el.getAttribute('src')).filename || null;
        },
        renderHTML: function (attrs) { return attrs.filename ? { 'data-filename': attrs.filename } : {}; }
      },
      display: {
        default: 'full',
        parseHTML: function (el) {
          return el.getAttribute('data-re-display') || splitMark(el.getAttribute('src')).display;
        },
        renderHTML: function (attrs) { return { 'data-re-display': attrs.display || 'full' }; }
      },
      size: {
        default: THUMB_DEFAULT,
        parseHTML: function (el) {
          return parseInt(el.getAttribute('data-re-size'), 10) || splitMark(el.getAttribute('src')).size;
        },
        renderHTML: function (attrs) { return { 'data-re-size': attrs.size || THUMB_DEFAULT }; }
      }
    });
  },
  // V režime 'thumb' zmenši obrázok aj v editore. Ak URL už je thumbnail z Redmine, je malý sám;
  // pri novom uploade je to blob plnej veľkosti → strop dá inline style (presne podľa `size`).
  renderHTML: function (props) {
    var node = props.node;
    var out = mergeAttributes(this.options.HTMLAttributes || {}, props.HTMLAttributes);
    if (node.attrs.display === 'thumb') {
      out.style = 'max-width:' + (node.attrs.size || THUMB_DEFAULT) + 'px;height:auto';
    }
    return ['img', out];
  },
  addStorage: function () {
    return {
      markdown: {
        serialize: function (state, node) {
          var f = node.attrs.filename || node.attrs.src || '';
          if (node.attrs.display === 'thumb') {
            state.write('{{thumbnail(' + f + ', size=' + (node.attrs.size || THUMB_DEFAULT) + ')}}');
          } else {
            state.write('![' + (node.attrs.alt || '') + '](' + f + ')');
          }
        }
      }
    };
  }
});
