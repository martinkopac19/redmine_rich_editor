/* Image node s okamžitým náhľadom: pri novom uploade je `src` = blob URL (vidno hneď),
   ale do Markdownu sa serializuje `filename` (aby to Redmine po uložení vykreslil). */
import Image from '@tiptap/extension-image';

export var ReImage = Image.extend({
  addAttributes: function () {
    var parent = this.parent ? this.parent() : {};
    return Object.assign({}, parent, {
      filename: {
        default: null,
        parseHTML: function (el) { return el.getAttribute('data-filename'); },
        renderHTML: function (attrs) { return attrs.filename ? { 'data-filename': attrs.filename } : {}; }
      }
    });
  },
  addStorage: function () {
    return {
      markdown: {
        // do Markdownu píš filename (nie blob src); alt necháme = filename
        serialize: function (state, node) {
          var url = node.attrs.filename || node.attrs.src || '';
          state.write('![' + (node.attrs.alt || '') + '](' + url + ')');
        }
      }
    };
  }
});
