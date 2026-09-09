# Changelog

## 0.15.0

**`Cmd/Ctrl + Enter` submits the comment.** Same as clicking *Add comment*: an empty comment
is not sent, the draft is cleared afterwards, and plain `Enter` / `Shift + Enter` keep making
new lines. The shortcut is in the button's tooltip, so it is discoverable without being told.

**It is deliberately not `Cmd/Ctrl + K`,** which is what was originally asked for. That key is
already taken twice: inside the editor it opens the link dialog (`editor.js` `Mod-k`, the
feature that replaced the CloudShoot workaround in v0.9.0), and outside it opens the command
palette. A third meaning on the same key would mean nobody could predict what it does, and in
a comment the link shortcut would have been lost. `Enter` was free — verified against Redmine
core as well — and is the convention in Linear, GitHub, Slack and Jira.

- The listener sits on the comment bar, not on the document: the shortcut applies while writing
  a comment, not anywhere on the page.
- `altKey` is excluded because **AltGr is ctrl+alt** on Czech and Slovak keyboards — the same
  trap the command palette hit with its own shortcut.
- Editing an *existing* comment through the pencil keeps its native Save button; that form is
  Redmine's own and the plugin only upgrades its textarea.
- New test `extra/comment_shortcut_cdp_test.mjs` — 11 checks with real key events, including
  that `Ctrl+K` in a comment does **not** submit it (so the link dialog stayed intact) and that
  `Enter` alone still makes a new line.

## 0.14.0

**A comment or a new issue you started writing survives a page reload.**

Reported case: the description of an existing issue saves itself, but text typed into a
comment or into the new-issue form was lost on reload. The cause is different from the
description, and so is the fix: those two have **nowhere on the server to save to**.
Saving a comment means adding it to the history and mailing everyone who watches the
issue; saving a new issue means creating it. Neither may happen on its own — the whole
point of this plugin is that the person clicks the button.

- The text is therefore kept **in the browser** (`sessionStorage`) and put back into the
  editor when the page loads again. Nothing is sent anywhere, nothing is created, nobody
  gets a notification.
- **`sessionStorage`, not `localStorage`** (decided 9 Sep 2026): the draft survives a
  reload and clicking around Redmine, but dies with the tab. On a shared computer nobody
  finds a half-written comment left behind by the previous person.
- **Restored automatically**, but only into an *empty* editor — text that is already on the
  page is never overwritten.
- A draft is **tied to its place**: a comment to its issue, a new issue to its project. Text
  from one issue can never surface on another.
- Cleared when the comment is actually submitted, when the new-issue form is submitted, and
  when the person empties the field themselves.
- On the new-issue form the draft is restored **once per page load**, not on every redraw.
  Changing the tracker rebuilds the form from the server and inserts that tracker's
  description template — restoring the draft again would overwrite the template the person
  just asked for.
- Redmine 6.1.3 has no draft mechanism of its own (only the `warnLeavingUnsaved` "Leave
  site?" prompt, which saves nothing), so there was nothing to hook into.
- New test `extra/draft_cdp_test.mjs` — 13 checks against a live Redmine with real key
  events: the draft survives one reload and a second one, submitting clears it (so the
  comment cannot be posted twice), and both the subject and the description of a new issue
  come back.

## 0.13.0

**Checkboxes in a saved comment can be ticked without opening the comment for editing.**
Redmine renders task lists as `disabled` checkboxes everywhere, so a checklist written in a
comment could only be ticked through the pencil — and that is the author's alone. A shared
checklist in a comment was dead for everybody else.

- **Who may tick:** anyone who may add a comment to the issue, via the core
  `Issue#notes_addable?` — so roles limited to a tracker and closed projects are respected, and
  a private comment can only be ticked by someone allowed to see it. Read-only access still
  sees the checkbox locked. The server enforces this independently of the page: a hand-made
  request from someone without the permission is refused with 403.
- **The request carries no text.** Only the checkbox's position, the total count and its
  previous state travel to the server, so the endpoint cannot rewrite a comment even if asked
  to — the one thing it can do is flip a single character between the square brackets. That is
  what makes it safe to open to people who may not edit the comment. Redmine's own
  `PUT /journals/:id` is no use here: it is gated to the author and accepts arbitrary text.
- **The comment does not start claiming "· edited".** `updated_by`/`updated_on` stay untouched,
  because an edit marker would read as if someone had rewritten the content. The tick goes to
  the server log. It also adds no issue-history entry — a ten-item checklist would otherwise
  produce ten of them.
- **Nothing is written when the marker order is uncertain.** The `[ ]` markers found in the
  Markdown are cross-checked against the number of checkboxes the renderer really produces, and
  against what the browser saw at click time. If they disagree — an indented code block, a
  macro, or someone editing the comment in the meantime — the request is refused with 409 and
  the checkbox springs back with a hint to reload rather than ticking the wrong line.
- The click handler is delegated from `document` rather than attached to each checkbox. Attaching
  per element broke as soon as the history was redrawn through `innerHTML`: that serialises the
  plugin's own marker attribute, so the new checkboxes arrived looking unlocked but with no
  handler — clicks did nothing and silently failed to save. Found by test, not in review.

## 0.12.0

**Editing an existing comment now uses the rich editor too.** Clicking the pencil on a comment
in the history opened Redmine's old toolbar-and-textarea widget — the one place on the issue
page where none of the new editing worked. It now opens the same editor as *Add comment* and
the description: formatting as you type, `/` for blocks, `#123`, `@mentions`, emoji and
emoticons, links with Ctrl/Cmd+K.

- Who may edit a comment has not changed by one line. The pencil is still rendered only by
  Redmine, the form still comes from `GET /journals/:id/edit`, and saving still goes through
  `PUT /journals/:id` — all three already check `Journal#editable_by?`. The plugin only
  upgrades a textarea that Redmine had already decided to show.
- **Files still cannot be added while editing an existing comment**, because
  `JournalsController#update` accepts only `notes` and `private_notes` and would silently drop
  the upload, leaving the text pointing at an attachment that does not exist. Native Redmine
  offers no attachments in this form either. Dropping, pasting or `Ctrl/Cmd+Shift+A` now says
  so instead of appearing to work. Add the file in a new comment.
- The editor is discarded when the form closes, so repeatedly opening and cancelling the pencil
  no longer piles up editor instances on the page.

## 0.11.0

**Text emoticons now become the emoji you meant.** Typing `:D` used to produce 😢 and `:O`
produced 😄 — nonsense that came from the `:` autocomplete treating the letter after the colon
as a search term. It searched keywords too, so `d` first matched *cry* (keyword "sad") and `o`
matched *smile* (keyword "joy").

- Emoticons are converted while you type, the way Google Chat does it: the emoji appears once you
  type the space after it, so nothing changes under your hands mid-word. 59 patterns —
  `:D :) :( ;) :P :O XD <3 </3 >:( O:) }:) (y) (n) ^_^ T_T` and their `:-` variants.
- The autocomplete no longer opens for a single character that forms an emoticon (`:D`, `:O`,
  `:P`…), so its first entry can no longer be accepted by accident. Real searches of two
  characters or more (`:dog`) are unaffected.
- When you do search, results are ranked by how closely they match: exact name first, then names
  starting with the query, then keywords. Previously any substring hit anywhere counted equally.
- Times like `12:30` and URLs are left alone.
- The same emoticon table lives in the redmine_emoji_picker plugin, which handles plain
  textareas; both were aligned so the two behave identically.

## 0.10.0

**One edit now leaves one history entry and one notification.** Paste an image, switch it to
*Link only* a moment later, and you used to get two entries in the history and two e-mails about
the same thing. Redmine has no journal aggregation at all — every save is a new entry and a new
notification — so this is fixed on both sides.

**Client — the editor saves once per edit, not once per keystroke burst:**

- Leaving the field is now the trigger; the idle timer is only a 10-second fallback (it used to
  be the 2-second main trigger, which is why the save landed before you could click *Link only*).
- Both timers are one timer, so a save on blur can no longer be followed 1.3 s later by an
  identical second POST.
- **Nothing is sent when nothing changed.** Clicking into the description and back out used to
  save — Redmine keeps an empty `attachments[dummy][file]` field in the form at all times, and
  that alone was enough to look like a pending change.
- Saving is deferred while an upload is in flight, so an attachment is never attached before the
  text that references it.
- Leaving the page flushes the pending change with `sendBeacon` (`fetch` is cancelled when the
  page goes away), and a native *Submit* cancels the pending save instead of racing it.

**Server — consecutive live edits fold into the previous entry.** Within the merge window
(default 10 minutes), when the same user edits again and both entries only carry a description,
a subject or an added attachment, the change is folded into the previous entry and no second
notification is sent. A comment in between, another user, a status change, a normal form save,
the REST API and bulk edits are all left exactly as Redmine does them. Both the merging and the
window are configurable, and turning it off restores the original behaviour completely.
This needs no core patch — it runs from the native `controller_issues_edit_after_save` hook,
inside the same transaction as the save.

**Also fixed:** the live title was never mirrored into the form’s hidden subject field, so
renaming an issue in the editor and then clicking *Submit* by hand brought the old title back.

Verified with 13 server-side checks (`extra/selftest_merge.rb`, everything inside a transaction
that is rolled back, mail delivery switched to `:test`) and 10 browser checks
(`extra/savetest_browser.js`, POSTs stubbed, three identical runs).

## 0.9.3

**Links in the editor can be opened again, and a link bar makes them editable.** On the issue page
this editor *replaces* the rendered description, so it is the only place where a reader sees a link
— and a click did nothing, because the editor swallowed it. Three changes:

- **A click opens the link** (`openOnClick`), in a new tab, so nothing typed gets lost.
- **Hovering a link shows a bar** with *Open*, *Edit link* and — for an attachment link — *Show as
  image*. Until now that last one only appeared in the text bar, which needs a non-empty selection,
  so undoing *Link only* meant selecting the link text by hand and hoping. The bar also shows when
  the caret sits in a link, and it works while the editor is not focused, which is the normal state
  when someone is just reading an issue.
- **The hover state is released when the link disappears.** Converting the hovered link back to an
  image removes the element without a `mouseout`, so the bubble logic thought the mouse was still
  over a link and stopped showing any bar at all. It now re-checks that the link mark is still
  there.

Verified in a headless browser on both the new-issue form and the issue page (live description):
13 checks, including that the click opens exactly the href, that *Show as image* restores an image
node, and that the bars are not stuck afterwards.

## 0.9.2

**The first line of the editor no longer starts a blank row below the top border.** Redmine's core
form CSS sets `clear: left` on every `.tabular p`, which also matched the paragraphs *inside* the
editor. The field label is floated, so the first paragraph was pushed below it and the top of the
box became dead space as tall as the label (~21 px) — clicking it did nothing, because there was no
text line to land in. The reset that already undid the other leaks from that rule now also sets
`clear: none`.

## 0.9.1

Self-review follow-ups on 0.9.0:

- **"Show as image" no longer shows a broken image for an attachment that hasn't been saved yet.**
  It rebuilt the preview from `RE_CONFIG.atts`, which only lists attachments that existed when the
  page was rendered — a screenshot pasted a moment ago isn't there, and the server won't serve its
  thumbnail either while it has no container. The blob URL created at insert time is now kept and
  reused, with the server thumbnail path as a fallback.
- **The link dialog clamps the selection it remembered.** An upload takes seconds, and if the
  document changed meanwhile, `setTextSelection` would throw and the link would silently not appear.

Also verified in this pass: a plain attachment that the text never mentions keeps its native
preview (the 0.9.0 dedupe change could have hidden every image on the page), and the new link
survives a Markdown round-trip byte for byte — a drift there would make the issue page auto-save a
phantom description change on every visit.

## 0.9.0

**"Link only" now actually produces a link.** Picking *Link only* on an image used to insert
`attachment:shot.png` — and Redmine still rendered its own preview under the comment, so the mode
changed nothing visible. Two fixes:

- The mode now inserts a **complete absolute link** to the attachment page, e.g.
  `[screenshot](https://redmine.example.com/attachments/26137)`. It can be copied and sent to a
  colleague, who has to sign in to open it. This works because Redmine's upload token is
  `<id>.<digest>` — the attachment id is known the moment the file is uploaded, long before the
  issue is saved, so no extra endpoint and no second save are needed.
- The native duplicate preview is now hidden whenever the text **refers** to an attachment, not only
  when it renders one as an image. Older comments using `attachment:name` are cleaned up too.

The inserted label is the word `screenshot`, left selected so typing replaces it. The link mark is
carried across that replacement via stored marks, which `setTextSelection` would otherwise clear —
without it, typing over the label would silently drop the link. **Show as image** in the bubble
toolbar converts a link back into a preview.

**`Cmd/Ctrl + K` is a real dialog now**, not `window.prompt`. It takes a URL as before, or an image
**pasted or dropped into the dialog itself** — that image is uploaded, attached, and inserted as a
link with no preview.

The link host comes from the browser's origin rather than `Setting.host_name`: a clone restored from
a production dump carries the production host name, and links built from it would point at the wrong
server.

## 0.8.5

Two bits of Redmine's form CSS were leaking into the editor:

- **Checklist boxes now line up with their text.** `.tabular label` (`float:left`,
  `margin-left:-180px`, `width:175px`) applies to the checkbox label, which pulled the box out past
  the editor's left edge and left it sitting above the text baseline. The checkbox is now centred on
  the first line of its text, and checklist text starts at exactly the same indent as bullet and
  numbered list text.
- **Headings differ only in size, and are always bold.** Redmine's global
  `h4 { border-bottom: 1px solid #ccc; font-weight: normal }` reached the editor (core only
  overrides it under `.wiki`), so an H4 came out thin with a full-width rule under it. H1–H4 are now
  bold with no border, at the same sizes Redmine renders them at (1.6 / 1.4 / 1.2 / 1.1em) — so the
  editor shows what the reader will see.

Also: list items no longer carry the paragraph's bottom margin, so multi-item lists sit tighter.

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
