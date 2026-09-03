/* Textové emotikony → emoji, podľa toho, čo robí Google Chat.
 *
 * Prečo to tu musí byť: `:` v editore otvára emoji autocomplete, takže `:D` sa
 * bez tejto tabuľky vyhodnotí ako HĽADANIE „d" — a keďže sa hľadá aj v kľúčových
 * slovách, prvá zhoda bola `cry` (má kľúčové slovo „sad"). Rovnako `:O` trafilo
 * `smile` cez „joy". Emotikon je preto potrebné rozpoznať skôr, než sa z neho
 * stane dopyt.
 *
 * Tá istá tabuľka žije aj v plugine redmine_emoji_picker
 * (`assets/javascripts/emoji_data.js`, `window.REP_EMOTICONS`), ktorý rieši
 * klasické textarey. Editor ju NEČÍTA odtiaľ zámerne — musí fungovať aj tam,
 * kde ten plugin nie je nainštalovaný alebo sa jeho skript nenačíta. Keď sa
 * jedna zmení, zmeň aj druhú, inak sa začnú správať rozdielne.
 */
import { Extension, InputRule } from '@tiptap/core';

export var EMOTICONS = {
  // úsmev
  ':D': '😄', ':-D': '😄', '=D': '😆', 'XD': '😆', 'xD': '😆', '^_^': '😄',
  ':)': '🙂', ':-)': '🙂', '=)': '🙂', '(:': '🙂',
  // smútok a zlosť
  ':(': '☹️', ':-(': '☹️', '=(': '☹️', ':C': '🙁', ':c': '🙁',
  '>:(': '😠', '>=(': '😠',
  ":'(": '😢', ":'-(": '😢', 'T_T': '😢',
  // žmurknutie, jazyk
  ';)': '😉', ';-)': '😉',
  ':P': '😛', ':-P': '😛', ':p': '😛', ':-p': '😛', '=P': '😛',
  ';P': '😜', ';p': '😜',
  // ostatné tváre
  ':|': '😐', ':-|': '😐',
  ':/': '😕', ':-/': '😕', ':\\': '😕',
  ':o': '😮', ':O': '😮', ':-o': '😮', ':-O': '😮',
  'D:': '😧', 'o_O': '😳', 'O_o': '😳', ':3': '😊',
  'B)': '😎', 'B-)': '😎', '8)': '😎',
  'O:)': '😇', 'O=)': '😇', '}:)': '😈', '}=)': '😈',
  ':*': '😘', ':-*': '😘',
  // neobličajové
  '<3': '❤️', '</3': '💔',
  '(y)': '👍', '(Y)': '👍', '(n)': '👎', '(N)': '👎',
  '\\m/': '🤘', '~@~': '💩'
};

/* Jednoznakové „chvosty" emotikonov, ktoré začínajú dvojbodkou (`:D`, `:O`, `:P`…).
   Podľa nich sa pozná, že človek píše emotikon a nehľadá emoji — vtedy sa
   autocomplete nemá otvárať. Dlhšie dopyty (`:dog`) tým dotknuté nie sú. */
export var EMOTICON_TAILS = (function () {
  var out = {};
  Object.keys(EMOTICONS).forEach(function (k) {
    if (k.length === 2 && k.charAt(0) === ':') out[k.charAt(1).toLowerCase()] = true;
  });
  return out;
})();

export function isEmoticonTail(query) {
  return query.length === 1 && !!EMOTICON_TAILS[query.toLowerCase()];
}

/* Konverzia pri písaní — rovnako ako v Google Chate: emotikon sa premení až
   vtedy, keď za ním nasleduje medzera, takže rozpísaný text nikto nezmení
   pod rukami.

   Vzory sú zoradené od najdlhších, aby `>:(` vyhralo nad `:(` a `:-D` nad `:-`.
   Porovnáva sa CITLIVO NA VEĽKOSŤ písmen: `:D` je emotikon, `:d` je začiatok
   hľadania emoji. */
/* Escapovanie pre regulárny výraz. Zámerne znak po znaku a bez regexu:
   vzory ako `:\` alebo `\m/` obsahujú spätné lomítko a v regexovom literáli
   sa pri každej ďalšej úprave súboru ľahko rozpadnú. */
function escapeRe(s) {
  var BS = String.fromCharCode(92);
  var special = '.*+?^${}()|[]' + BS;
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (special.indexOf(ch) >= 0) out += BS;
    out += ch;
  }
  return out;
}

export function emoticonPattern() {
  var keys = Object.keys(EMOTICONS).sort(function (a, b) { return b.length - a.length; });
  var WS = String.fromCharCode(92) + 's'; // s — zapísané cez kód znaku, nech ho úpravy súboru nezožerú
  return '(?:^|' + WS + ')(' + keys.map(escapeRe).join('|') + ')(' + WS + ')$';
}

export var EmoticonRules = Extension.create({
  name: 'reEmoticons',
  addInputRules: function () {
    return [new InputRule({
      find: new RegExp(emoticonPattern()),
      handler: function (p) {
        var emoji = EMOTICONS[p.match[1]];
        if (!emoji) return;
        /* `p.range.to` je koniec textu, ktorý UŽ je v dokumente. Medzera, ktorou človek
           emotikon potvrdil, sa v tej chvíli ešte NEVLOŽILA — input rule beží pred ňou
           a keď zaberie, ProseMirror ju sám nedoplní. Preto sa nahrádza presne emotikon
           a medzera sa dopisuje ručne. (Odpočítavanie `match[2]` posunulo rozsah o znak
           doľava a z `ab :D ` vzniklo `ab😄D`.) */
        var to = p.range.to;
        var from = to - p.match[1].length;
        p.state.tr.insertText(emoji + ' ', from, to);
      }
    })];
  }
});
