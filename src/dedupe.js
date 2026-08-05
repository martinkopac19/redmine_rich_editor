/* Odstránenie DVOJITÉHO náhľadu obrázka.

   Redmine ku každej prílohe pridáva vlastný náhľad (`div.thumbnails`) — v journale hneď pod riadok
   „File … added" a pri issue do sekcie „Files". Ak je ten istý obrázok už zobrazený v TEXTE
   (popis/komentár), používateľ vidí to isté dvakrát.

   Preto: keď je príloha v texte vykreslená ako OBRÁZOK, jej natívny náhľad skryjeme. Keď je v texte
   len ako odkaz (`attachment:file.png`, teda režim „len odkaz") alebo v texte nie je vôbec,
   natívny náhľad NECHÁME — inak by sa obrázok nedal vidieť vôbec.

   Skrývame len zobrazenie; DOM ani dáta nemeníme, súbor zostáva v zozname príloh. */

var RE_ATT = /\/attachments\/(?:download\/|thumbnail\/)?(\d+)/;

function attId(url) {
  var m = RE_ATT.exec(url || '');
  return m ? m[1] : null;
}

// Id príloh, ktoré sú v texte na stránke vykreslené ako obrázok.
function shownInText() {
  var ids = {};
  var scopes = [];
  var push = function (sel) {
    var list = document.querySelectorAll(sel);
    for (var i = 0; i < list.length; i++) scopes.push(list[i]);
  };
  push('#issue_description_wiki');       // renderovaný popis (F3 ho skryje, ale obsah je platný)
  push('.wiki.journal-note');            // komentáre
  push('.re-editor .ProseMirror');       // live editor (popis/komentár) — img má URL z RE_CONFIG.atts

  scopes.forEach(function (scope) {
    var imgs = scope.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var id = attId(imgs[i].getAttribute('src')) || attId(imgs[i].getAttribute('srcset'));
      if (id) ids[id] = true;
    }
  });
  return ids;
}

// Skrývame CSS triedou (nie inline štýlom): natívny `showIssueHistory()` pri prepnutí tabu histórie
// robí jQuery `.show()` nad `.journal .thumbnails`, čo by inline `display:none` prebilo.
// Trieda má v `rich_editor.css` `display:none !important`.
export function dedupeThumbnails() {
  var ids;
  try { ids = shownInText(); } catch (e) { return; }

  var boxes = document.querySelectorAll('.thumbnails');
  for (var b = 0; b < boxes.length; b++) {
    var box = boxes[b];
    var items = box.querySelectorAll('.thumbnail');
    var dupes = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var a = it.querySelector('a[href*="/attachments/"]');
      var img = it.querySelector('img');
      var id = attId(a && a.getAttribute('href')) ||
        attId(img && img.getAttribute('src')) || attId(img && img.getAttribute('srcset'));
      if (id && ids[id]) { it.classList.add('re-dupe-hidden'); dupes++; }
      else it.classList.remove('re-dupe-hidden');
    }
    // ak sú duplikátom všetky náhľady v bloku, skry celý blok (nech nezostane prázdna medzera)
    if (items.length && dupes === items.length) box.classList.add('re-dupe-hidden');
    else box.classList.remove('re-dupe-hidden');
  }
}
