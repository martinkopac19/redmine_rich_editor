/* Bublinová lišta po označení textu (bold/italic/strike/code/link). Vlastná, bez tippy. */

export function promptLink(editor) {
  var prev = editor.getAttributes('link').href || '';
  var url = window.prompt('Odkaz (URL):', prev);
  if (url === null) return;
  if (url.trim() === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
}

export function attachBubble(editor) {
  var bar = document.createElement('div');
  bar.className = 're-bubble';
  bar.style.display = 'none';

  var BTN = [
    { label: 'B', title: 'Bold (Ctrl/Cmd+B)', mark: 'bold', run: function () { editor.chain().focus().toggleBold().run(); } },
    { label: 'I', title: 'Italic (Ctrl/Cmd+I)', mark: 'italic', run: function () { editor.chain().focus().toggleItalic().run(); }, cls: 're-i' },
    { label: 'S', title: 'Strikethrough', mark: 'strike', run: function () { editor.chain().focus().toggleStrike().run(); }, cls: 're-s' },
    { label: '</>', title: 'Inline code', mark: 'code', run: function () { editor.chain().focus().toggleCode().run(); } },
    { label: '🔗', title: 'Link (Ctrl/Cmd+K)', mark: 'link', run: function () { promptLink(editor); } }
  ];
  var buttons = BTN.map(function (b) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 're-bubble-btn' + (b.cls ? ' ' + b.cls : '');
    el.textContent = b.label;
    el.title = b.title;
    el.addEventListener('mousedown', function (ev) { ev.preventDefault(); b.run(); update(); });
    bar.appendChild(el);
    return { el: el, mark: b.mark };
  });
  document.body.appendChild(bar);

  function update() {
    if (!editor.isEditable) { bar.style.display = 'none'; return; }
    var sel = editor.state.selection;
    var hasText = !sel.empty && editor.state.doc.textBetween(sel.from, sel.to, ' ').trim().length > 0;
    if (!hasText || !editor.isFocused) { bar.style.display = 'none'; return; }
    // aktívne stavy
    buttons.forEach(function (b) {
      if (editor.isActive(b.mark)) b.el.classList.add('re-on'); else b.el.classList.remove('re-on');
    });
    // pozícia nad výberom
    bar.style.display = 'flex';
    var s = editor.view.coordsAtPos(sel.from);
    var e = editor.view.coordsAtPos(sel.to);
    var box = bar.getBoundingClientRect();
    var midLeft = (Math.min(s.left, e.left) + Math.max(s.right || s.left, e.right || e.left)) / 2;
    var left = Math.max(8, midLeft - box.width / 2 + window.scrollX);
    var top = Math.min(s.top, e.top) + window.scrollY - box.height - 8;
    bar.style.left = left + 'px';
    bar.style.top = top + 'px';
  }

  editor.on('selectionUpdate', update);
  editor.on('transaction', update);
  editor.on('blur', function () {
    setTimeout(function () { if (!bar.contains(document.activeElement)) bar.style.display = 'none'; }, 120);
  });
  editor.on('destroy', function () { bar.remove(); });
  return bar;
}
