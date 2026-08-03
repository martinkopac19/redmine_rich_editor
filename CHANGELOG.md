# Changelog

## 0.3.0

- F2 (part 1): **`#issue` autocomplete** — type `#` + text to search issues (via the
  command_palette search endpoint) and insert `#<id>`; **emoji `:` picker** — type `:name`
  to insert a Unicode emoji. Both insert plain text/Unicode that round-trips through Markdown
  (Redmine turns `#123` into a link on render). Still to come: `@mention`, image/file upload.
- Fix: give each suggestion (`/`, `#`, `:`) a **unique ProseMirror PluginKey** — they shared
  the default key and collided (`RangeError: Adding different instances of a keyed plugin`),
  which broke the whole editor mount. Also: a failed mount no longer retries in a loop.

## 0.2.2

- Fix: editor content was indented ~180px because Redmine's tabular form CSS
  (`.tabular p { padding-left: 180px }`) bled into the ProseMirror paragraphs. The editor
  now resets that padding on its own text blocks; content is left-aligned again.

## 0.2.1

- Fix: hide the **whole** native jsToolBar widget (Edit/Preview tabs + toolbar), not just the
  textarea — previously the native editor and the rich editor were stacked. The editor now
  waits for jsToolBar to build `.jstBlock`, then replaces it (native fallback preserved).
- Fix: editor UI strings (placeholder, link prompt, empty slash menu) now follow the user's
  Redmine language via `RE_CONFIG` (they were hardcoded in Slovak).

## 0.2.0

- Editing UX (F1): selection **bubble toolbar** (bold / italic / strike / inline code / link),
  `/` **slash block palette**, **markdown-as-you-type** input rules and keyboard shortcuts
  (`Cmd/Ctrl + B/I`, `Cmd/Ctrl + K` for links).
- Blocks: 4 heading levels, bullet / numbered / **task lists (checklists)**, blockquote,
  code block, **tables**, horizontal rule, links. All round-trip through GFM Markdown.

## 0.1.0

- Initial foundation (F0): TipTap-based editor mounts over the issue description / notes
  textarea and round-trips content to Markdown back into the field. Upgrade-safe
  (view hooks only, no core patch, no migrations, kill-switch, native fallback).
