/* Hard break, ktorý sa serializuje na ČISTÉ `\n` (nie `\\\n`, ako default tiptap-markdown).
   Redmine má common_mark_enable_hardbreaks=true → `\n` vykreslí ako <br>, takže:
   - existujúce popisy (jednoduché `\n` v odseku) sa zobrazia so zalomeniami ako v produkcii,
   - round-trip nezmení uložený text (žiadne pridané spätné lomítka → žiadny falošný diff). */
import HardBreak from '@tiptap/extension-hard-break';

export var ReHardBreak = HardBreak.extend({
  addStorage: function () {
    return {
      markdown: {
        serialize: function (state, node, parent, index) {
          // preskoč koncové hard breaky (konvencia prosemirror-markdown)
          for (var i = index + 1; i < parent.childCount; i++) {
            if (parent.child(i).type !== node.type) { state.write('\n'); return; }
          }
        }
      }
    };
  }
});
