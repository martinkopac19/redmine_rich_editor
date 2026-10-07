/* Image node s dvoma režimami zobrazenia:
     display: 'full'  → do Markdownu ide `![alt](filename)`            (obrázok v plnej šírke)
     display: 'thumb' → do Markdownu ide `{{thumbnail(filename, size=N)}}` (malý klikateľný náhľad)

   `src` je len na zobrazenie v editore; do Markdownu ide vždy `filename`, aby to Redmine po uložení
   vykreslil. Zdroj `src`:
     - nový upload → blob URL (vidno hneď, ešte nemá verejnú URL),
     - existujúca príloha → URL z mapy `RE_CONFIG.atts` (naplní hooks.rb na detaile issue). */
import Image from '@tiptap/extension-image';
import { mergeAttributes } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { THUMB_MARK, THUMB_DEFAULT } from './md-compat.js';
import { attachmentPageUrl } from './attachments.js';

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

// filename → id prílohy. Pre EXISTUJÚCE prílohy ho vieme vylúpnuť z URL v `RE_CONFIG.atts`
// (`/attachments/download/<id>/<meno>`); čerstvý upload má id priamo v atribúte uzla.
export function attIdFor(filename) {
  var a = atts()[filename];
  var m = /\/attachments\/(?:download\/|thumbnail\/)?(\d+)/.exec((a && a.u) || '');
  return m ? m[1] : null;
}

/* Obrázok v novom okne. Editor je na detaile issue zároveň čítacia plocha a klik obrázok len
   označí (lišta veľkosti) — bez tohto sa obrázok nedal pozrieť v plnej veľkosti. Ide na stránku
   prílohy ako natívny Redmine náhľad; čerstvý upload stránku ešte nemá → aspoň jeho blob. */
export function openImage(attrs) {
  var a = attrs || {};
  var href = attachmentPageUrl(a.attId || attIdFor(a.filename)) || a.src;
  if (href) window.open(href, '_blank', 'noopener');
}

function imageMarkdown(attrs) {
  var f = attrs.filename || attrs.src || '';
  if (attrs.display === 'thumb') return '{{thumbnail(' + f + ', size=' + (attrs.size || THUMB_DEFAULT) + ')}}';
  return '![' + (attrs.alt || '') + '](' + f + ')';
}

/* Zmena LEN veľkosti/režimu obrázkov → nový Markdown vznikne výmenou zápisu tých obrázkov
   v PÔVODNOM texte, nie novou serializáciou celého dokumentu. Tá by starý popis preformátovala
   (`1)` → `1.`, prázdne riadky, `->` → `-&gt;`…) a server by zmenu nespoznal ako „len obrázok"
   (merge_hooks.rb, ImageOnly) → záznam v histórii a notifikácia. Na 60 reálnych popisoch
   by bez tohto prešlo potichu len 7.
   Vráti null, keď to nie je čistá zmena obrázkov alebo text nesedí s dokumentom — volajúci
   potom serializuje celý dokument ako doteraz. */
var IMG_MD = /\{\{\s*thumbnail\(\s*([^,)]+?)\s*(?:,[^)]*)?\)\s*\}\}|!\[[^\]]*\]\(\s*([^)\s]+)\s*\)/g;

function imagesOf(doc) {
  var out = [];
  doc.descendants(function (n) { if (n.type.name === 'image') out.push(n.attrs); });
  return out;
}

function withoutImageLook(doc) {
  return JSON.stringify(doc.toJSON(), function (k, v) {
    return (v && v.type === 'image' && v.attrs) ? { type: 'image', f: v.attrs.filename } : v;
  });
}

export function patchImageMarkdown(prevDoc, nextDoc, prevMd) {
  if (prevDoc.content.size !== nextDoc.content.size) return null; // písanie mení veľkosť, obrázok nie
  var before = imagesOf(prevDoc);
  var after = imagesOf(nextDoc);
  if (!before.length || before.length !== after.length) return null;
  if (withoutImageLook(prevDoc) !== withoutImageLook(nextDoc)) return null;

  var hits = [];
  var m;
  IMG_MD.lastIndex = 0;
  while ((m = IMG_MD.exec(prevMd))) hits.push({ at: m.index, len: m[0].length, f: (m[1] || m[2] || '').trim() });
  if (hits.length !== before.length) return null;
  for (var i = 0; i < hits.length; i++) if (hits[i].f !== before[i].filename) return null;

  var out = prevMd;
  for (var j = hits.length - 1; j >= 0; j--) {
    var a = before[j], b = after[j];
    if (a.display === b.display && a.size === b.size) continue;
    out = out.slice(0, hits[j].at) + imageMarkdown(b) + out.slice(hits[j].at + hits[j].len);
  }
  return out;
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
      },
      // Kým sa čerstvo vložený obrázok nahráva (attachments.js `showImage`). Len v editore —
      // do Markdownu nejde a z HTML sa neprevezme (skopírovaný obrázok sa už nenahráva).
      uploading: {
        default: false,
        parseHTML: function () { return false; },
        renderHTML: function (attrs) { return attrs.uploading ? { 'data-re-uploading': '' } : {}; }
      },
      // Id prílohy — potrebné, keď sa obrázok prepne na režim „len odkaz" (postaví sa z neho
      // trvalá URL). Do Markdownu NEIDE, je to len pomocná informácia v editore.
      attId: {
        default: null,
        parseHTML: function (el) {
          var name = el.getAttribute('data-filename') || splitMark(el.getAttribute('src')).filename;
          return el.getAttribute('data-re-att-id') || attIdFor(name);
        },
        renderHTML: function (attrs) { return attrs.attId ? { 'data-re-att-id': attrs.attId } : {}; }
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
  // Dvojklik alebo Ctrl/Cmd+klik otvorí obrázok rovno, bez lišty.
  addProseMirrorPlugins: function () {
    function open(node, event) {
      if (node.type.name !== 'image') return false;
      event.preventDefault();
      openImage(node.attrs);
      return true;
    }
    return [new Plugin({
      props: {
        handleClickOn: function (view, pos, node, nodePos, event, direct) {
          return direct && (event.ctrlKey || event.metaKey) && open(node, event);
        },
        handleDoubleClickOn: function (view, pos, node, nodePos, event, direct) {
          return direct && open(node, event);
        }
      }
    })];
  },
  addStorage: function () {
    return {
      markdown: {
        serialize: function (state, node) { state.write(imageMarkdown(node.attrs)); }
      }
    };
  }
});
