# Changelog

## 0.8.4

**The history tab now survives an inline comment.** Two things were off after the swap of
`#history`:

- The previously open tab was re-clicked only when the server had picked a *different* one. When
  they matched, nothing ran — and since the `<script>` the tabs partial appends is never executed
  from `innerHTML`, no journal filtering happened at all. The tab is now always re-clicked; the
  click is idempotent.
- Redmine writes the `history_last_tab` cookie from a handler delegated on `#history .tabs` — the
  very element the swap destroys. From the first inline comment on, the cookie stopped being
  updated, so the *Last tab visited* preference silently went stale. The plugin now delegates the
  same write from `#history`, which survives.

Note that which tab you land on after a **full page** submit is Redmine's own setting
(*My account → Issue history default tab*), not something this plugin controls.

**Deleting a comment now also deletes the images it brought with it.** Redmine's *Delete* on a
comment only blanks the note text, and the comment is dropped only if it carries no property
changes — a comment with a pasted screenshot carries a *"File … added"* entry, so the comment
stayed as that bare line and the image stayed attached to the issue, in *Files* and on disk.

The attachments that arrived with a deleted comment are now removed for good: the file, the
*"File … added"* line, and the emptied comment itself. Deliberate limits:

- Only files that came with **that** comment, and only if the filename isn't mentioned in the
  description or in any other comment — so a file someone else links to is never pulled away.
- Only on **delete**. Editing a comment and taking the image out of the text leaves the file alone.
- **This is irreversible** (that's the point) — the file is gone from disk too, unless another
  attachment happens to share the same bytes, which Redmine stores once.

Done through the native `controller_journals_edit_post` hook — no core patch — so the plugin's
kill-switch restores Redmine's stock behaviour.

## 0.8.3

**Fix: a comment could silently fail to save.** Adding a second comment without reloading the page
lost it — the UI said "Saved", the editor cleared, but nothing was stored. Three things lined up:

- The `lock_version` (Redmine's optimistic-locking counter) was never refreshed after a save,
  because the regex reading it out of the reply assumed `value` comes *after* `name` in the
  `<input>`. Rails renders it the other way round, so the match never fired and every save after
  the first one sent a stale version.
- Redmine answers a stale version with `ActiveRecord::StaleObjectError` and re-renders the edit
  view containing `<div class="conflict">` — but **no** `errorExplanation`, which is all the
  success check looked for. So a rejected save was read as a successful one, and the comment text
  was cleared away.
- The reply is followed through a redirect, and Redmine sends `ETag` + `must-revalidate`, so the
  browser could answer that follow-up from its own cache with a **304** — leaving us reading a page
  from *before* the save. Requests now go out with `cache: 'no-store'`.

On top of the fixes, saving is now self-correcting and honest about failure:

- A conflict re-reads the current `lock_version` from the server and **retries once**, so a save
  no longer fails just because the page's counter drifted.
- The comment editor is only cleared once the reply actually contains the new comment. If anything
  goes wrong, your text stays where it is and the indicator says so.

## 0.8.2

- **Fix: the same screenshot was previewed twice.** Redmine adds its own preview for every attached
  image — right under the *"File … added"* line in the history, and in the issue's *Files* section.
  Together with 0.8.0's in-text preview you saw the same picture twice. The native preview is now
  hidden **when that attachment is already shown as an image in the text**, leaving just the in-text
  preview you can click for the full size.

  It stays visible when the image is *not* in the text — a plain attachment, or the *Link only*
  mode — otherwise there would be no way to see it at all. Nothing is deleted: the file stays in
  the *Files* list, and turning the plugin off brings the stock behaviour back.

## 0.8.1

Fixes for bugs found while using 0.8.0 on the issue page (0.8.0 only got tested on the
*new issue* form, where the editor still sits inside `#issue-form` — on the issue detail page
F3 moves it out, which broke all three of these).

- **Fix: files pasted on the issue page were never attached.** The hidden `attachments[]` fields
  were bound via `closest('form')`, which returns `null` once F3 has moved the editor out of
  `#issue-form` (description above the rendered text, comment box below the history). The upload
  itself succeeded, so the text referenced a file that was never attached — with 0.8.0's
  `{{thumbnail}}` that surfaced as *"Error executing the thumbnail macro (Attachment image.png not
  found)"*. Now falls back to `#issue-form`.
- **Fix: "Add comment" switched the history tab.** The reply is re-rendered by the server using the
  user's `history_default_tab` preference, so swapping in the fresh `#history` moved you off the
  tab you were on (typically History → Notes). The previously selected tab is now restored.
- **Fix: clipboard images were all called `image.png`.** Browsers give every pasted image that same
  generic name, so a second screenshot in the same issue collided with the first (Redmine resolves
  duplicate names via `Attachment.latest_attach`, i.e. both references pointed at the newest file).
  Pasted images are now renamed the way Redmine itself does it:
  `clipboard-YYYYMMDDhhmm-xxxxx.png`.
- **Fix: submitting a comment left the old text in the textarea**, so a second click on
  "Add comment" posted the same comment again. (`setContent` doesn't emit an update in TipTap 2,
  which is what kept the textarea stale.)

## 0.8.0

**Images**

- **Big screenshots no longer bury the text below them.** A pasted or dropped image wider than
  1200 px (or taller than 800 px) is inserted as a **small clickable preview** — Redmine's own
  `{{thumbnail(file.png, size=350)}}` macro — so the reader sees the text under it right away and
  still gets the full image on click. Smaller images keep going in inline at full size.
- **Three display modes per image**, switchable from a toolbar that appears when you click an
  image in the editor:
  - *Small preview (clickable)* → `{{thumbnail(file.png, size=N)}}`
  - *Full width* → `![](file.png)`
  - *Link only* → `attachment:file.png` (a plain text link — the same thing you'd get by pasting
    a URL behind selected text, without leaving the editor)
  - `−` / `+` step the preview size through 200 / 350 / 500 / 650 / 800 px. Those are multiples of
    50 on purpose: Redmine rounds thumbnail sizes up to the nearest 50 (max 800), so the editor
    shows exactly what the reader will see.
- **Existing images now preview properly in the editor.** Previously an image already saved in a
  description showed up broken until the issue was reloaded, because the Markdown only carries the
  filename. The issue's attachments are now passed to the editor (filename → attachment URL), so
  saved images render — as a thumbnail in *Small preview* mode, full size otherwise.
- Fix: **non-image attachments** were inserted as `[file.zip](file.zip)`, which Redmine renders as
  a broken relative link. They now use `attachment:file.zip`, which resolves to the attachment.
- SVG files are never put in preview mode — Redmine can't generate thumbnails for them.

**Bubble toolbar (select text)**

- Added **text size** (a dropdown: Normal text, Heading 1–4; the button shows the current level),
  **bullet list**, **numbered list**, **checklist** and **code block** next to the existing
  bold / italic / strikethrough / inline code / link.

**Keyboard**

- `Cmd/Ctrl+K` is now **contextual**, like Linear: with text selected in the editor it inserts a
  link; with no selection, or outside the editor, it opens the command palette. `Cmd/Ctrl+Shift+K`
  always opens the palette. (Needs `redmine_command_palette` **0.4.1** or newer.)

All of this uses native Redmine Markdown and macros — no core patch, no migration — so previews
keep working even with the plugin's kill-switch off.

## 0.7.5

- Fix: descriptions of existing tasks that use **single line breaks** inside a paragraph (e.g.
  `**Where?**` on its own line, text below) now render correctly in the editor — matching
  Redmine, which renders single newlines as `<br>` (`common_mark_enable_hardbreaks` is on).
  The editor now parses single `\n` as a line break (`breaks: true`) and serializes it back to
  a **plain `\n`** (custom hard-break node) so the stored Markdown is unchanged (no stray
  backslashes, no false history diff).

## 0.7.4

- Fix: **issue templates now populate the editor**. `redmine_issue_templates` sets the
  description textarea's value directly (no event), so the editor now watches for external
  writes to the textarea and reflects them (guarded against our own writes to avoid loops).
- Fix: removed the **odd gap above the "Write…" placeholder** on the new-issue form — Redmine's
  tabular-form `p` rules (`min-height`/`padding`) were bleeding into the editor's paragraphs;
  the reset now also zeroes those.

## 0.7.3

- Rename the comment button to **"Add comment"** (was "Submit") so it's distinct from the
  native edit-form **"Submit"** (which saves the whole issue). Dropped the now-redundant
  "Add a comment" heading above the comment box.

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
