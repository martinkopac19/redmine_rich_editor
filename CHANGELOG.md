# Changelog

## 0.7.2

- Style: the native issue edit-form **Submit** button now matches the comment Submit button
  (same height, radius, colour) so the two buttons on the issue page look consistent. Scoped
  to `#issue-form` so other pages are unaffected.

## 0.7.1

- Comments: **no more full-page reload** on Submit — the new comment is inserted by swapping in
  the updated history from the response, and the editor is cleared (no flash).
- Submit button restyled (flex-centered label, consistent height).
- Live description: the now-redundant description field inside the native edit form is hidden
  (previously its leftover "Edit" toggle just hid its own icon and confused things).

## 0.7.0

- F3 complete — **always-visible comments**: a rich-editor comment bar with a **Submit** button
  sits under the issue history (shown only if you can add notes). Submitting posts the note
  (via Redmine's own update) and refreshes so the comment appears.
- Auto-save (description) and comment Submit now also **attach pending drag&drop / paste
  uploads** (the `attachments[]` tokens are included in the save and cleared afterwards).
- With this, the planned F0–F3 scope is done: inline rich editor for title, description and
  comments, textarea-backed and upgrade-safe.

## 0.6.1

- F3 (part 2) — **inline title**: the issue subject is editable in place (click the title,
  type, `Enter` or click away to save) and auto-saves on blur/idle. Shown only when you can
  edit the issue. Comments bar next.

## 0.6.0

- F3 (part 1) — **live description**: on the issue page the description is now the rich editor
  itself (it replaces the read-only render) and edits **auto-save on blur / idle** via AJAX to
  Redmine's own update — one journal per editing session, `lock_version` handled. A small
  Saving… / Saved indicator shows status. This is the most DOM-coupled part; on any failure it
  degrades gracefully (the value stays in the field and the native Edit → Save still works).
- Note: this moves the editor into the description area, so `#123` / `@name` show as plain
  text while editing (Redmine renders them as links on save). Title & comments: next.

## 0.5.1

- Fix: **pasted / uploaded images now preview immediately** in the editor. The image node uses
  a local blob URL for display (`src`) but keeps the real filename in a `filename` attribute
  and serialises Markdown as `![](filename)` — so the preview is instant and the saved issue
  still renders the attachment. (Previously `src` was the bare filename → broken thumbnail /
  404 until the issue was saved.) Existing images loaded from Markdown still show a plain
  thumbnail until saved — separate follow-up.

## 0.5.0

- F2 complete — **images & files**: drag & drop, paste, `Cmd/Ctrl + Shift + A`, and the `/file`
  slash command. Files upload through Redmine's in-session `/uploads.js` (the `.json` variant
  needs the REST API, which returns 401 here), are linked to the issue form via hidden
  `attachments[]` fields, and inserted as `![](filename)` (images) or a link (other files) —
  so the attachment is saved and rendered by Redmine on the issue.
- Note: in-editor image preview is basic (staged uploads have no public URL yet, so the
  thumbnail shows the filename); the image renders correctly once the issue is saved.

## 0.4.0

- F2 (part 2a): **`@mention`** — type `@` to search the project's members (new read-only
  `rich_editor/mentionables` endpoint) and insert `@login`. Redmine turns it into a user link
  and notifies the mentioned person on save. Only triggers at the start of a word, so it
  doesn't fire inside email addresses.
- Adds a tiny `RichEditorController#mentionables` (login-gated) + route, and `projectId` to
  `RE_CONFIG`. Still upgrade-safe: no core patch, no migrations.

## 0.3.1

- Fix: the emoji `:` menu now shows suggestions **immediately** after `:` (previously it said
  "No emoji" until you typed 2 characters, which looked like a bug). It only triggers when `:`
  starts a word, so it no longer interferes with text like `12:30` or `note:`.

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
