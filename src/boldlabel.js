/* Enter za tučným „nadpisom" sekcie začne normálny text.
   Šablóny (Bug, Feature) majú sekcie ako celé tučné riadky (`**Actual result:**`). ProseMirror pri
   Enteri drží značky (keepMarks), takže text pod nadpisom sa písal tučne a bolo treba bold ručne
   vypnúť. Platí len pre odsek na najvyššej úrovni, ktorý je CELÝ tučný, s kurzorom na konci —
   inde (zoznamy, bežný text s tučným slovom) sa Enter správa ako doteraz.
   V `extensions()` musí byť PRED našepkávačmi: tiptap skladá klávesy od konca zoznamu, takže
   Enter v otvorenom našepkávači (@, #, :, /) vyhrá skôr, než príde sem. */
import { Extension } from '@tiptap/core';

export var BoldLabelEnter = Extension.create({
  name: 'reBoldLabelEnter',
  addKeyboardShortcuts: function () {
    return {
      Enter: function (props) {
        var state = props.editor.state;
        var sel = state.selection;
        var $from = sel.$from;
        var bold = state.schema.marks.bold;
        if (!sel.empty || !bold || $from.depth !== 1) return false;
        var p = $from.parent;
        if (p.type.name !== 'paragraph' || $from.parentOffset !== p.content.size || !p.textContent.trim()) return false;
        var allBold = true;
        p.forEach(function (n) { if (n.isText && !bold.isInSet(n.marks)) allBold = false; });
        if (!allBold) return false;
        return props.editor.commands.splitBlock({ keepMarks: false });
      }
    };
  }
});
