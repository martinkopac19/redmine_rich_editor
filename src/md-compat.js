/* Kompatibilita Markdownu Redmine ↔ tiptap.

   Redmine má natívne makro `{{thumbnail(file.png, size=320)}}`, ktoré vyrenderuje malý KLIKATEĽNÝ
   náhľad odkazujúci na plný obrázok. markdown-it ho nepozná (bral by ho ako text), preto ho pred
   vstupom do editora prepíšeme na obrázok s markerom vo fragmente URL:

     {{thumbnail(file.png, size=320)}}  →  ![](<file.png#re-thumb-320>)

   `ReImage` (src/image.js) si z fragmentu vytiahne `display: 'thumb'` + `size` a pri serializácii
   napíše makro späť → čistý round-trip. Makrá s inými argumentmi (napr. `title=`) NEPREPISUJEME —
   ostanú v dokumente ako obyčajný text, takže sa uložia presne tak, ako prišli. */

export var THUMB_MARK = '#re-thumb-';

// Redmine náhľady zaokrúhľuje nahor na násobok 50 a stropuje na 800 px
// (Attachment#thumbnail: `size = (size / 50.0).ceil * 50`). Držíme sa násobkov 50,
// aby editor ukazoval PRESNE to, čo potom uvidí čitateľ na stránke.
export var THUMB_DEFAULT = 350;
export var THUMB_SIZES = [200, 350, 500, 650, 800];

// Makro bez `size=` má v jadre Redmine default 200 px (nie Setting.thumbnails_size).
var MACRO_DEFAULT = 200;

var RE_MACRO = /\{\{\s*thumbnail\(([^)]*)\)\s*\}\}/gi;

export function preprocess(md) {
  if (!md || md.indexOf('{{') < 0) return md || '';
  return md.replace(RE_MACRO, function (whole, inner) {
    var parts = String(inner).split(',');
    var filename = (parts.shift() || '').trim();
    if (!filename) return whole;
    var size = MACRO_DEFAULT;
    for (var i = 0; i < parts.length; i++) {
      var m = /^\s*size\s*=\s*(\d+)\s*$/.exec(parts[i]);
      if (!m) return whole; // neznámy argument (title=…) → nechaj makro ako text (bez straty)
      size = parseInt(m[1], 10) || MACRO_DEFAULT;
    }
    // <> okolo cieľa: názvy súborov môžu obsahovať medzery/zátvorky
    return '![](<' + filename + THUMB_MARK + size + '>)';
  });
}
