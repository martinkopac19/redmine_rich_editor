# Redmine Rich Editor (Previo)

A **Linear-style inline WYSIWYG editor** for Redmine issue **title, description and comments**.
Type and see formatted text instantly, with a `/` slash block palette, a selection bubble
toolbar, keyboard shortcuts and markdown-as-you-type.

Built to be **upgrade-safe**: it is a progressive enhancement over Redmine's existing
`textarea` fields. It reads the Markdown, lets you edit it visually, and serialises **back to
Markdown** into the same field — so Redmine still does the saving, change-logging (journals),
permissions, search and template insertion. Nothing in core is patched; there are no
migrations and no storage-format change. If a future Redmine version changes the DOM, the
editor simply doesn't mount and you fall back to the native textarea.

## Status

- **F0 — foundation (done):** mounts over the description / notes textarea, Markdown ⇄ rich
  round-trip, syncs back to the textarea.
- **F1 — editing UX (done):** bubble toolbar, `/` slash palette, markdown input rules,
  keyboard shortcuts; blocks: 4 heading levels, bullet / numbered / **task lists**, blockquote,
  code block, **tables**, horizontal rule, links (`Cmd/Ctrl + K`).
- **F2 (done):** `#` issue links, `:` emoji, `@` mentions, and image/file upload
  (drag & drop, paste, `Cmd/Ctrl + Shift + A`, `/file`).
- **F3 (done):** live description with auto-save on blur/idle, inline title editing, and an
  always-visible comments bar with Submit — all on the issue page.
- **F4 (done):** image handling — big pasted screenshots become small clickable previews, with a
  per-image toolbar (small preview / full width / link only + preview size), and images already
  saved in a description now preview correctly in the editor. Bubble toolbar gained text size and
  block buttons (lists, checklist, code block).
- **F5 (done):** *Link only* now produces a real, shareable link instead of a preview, and
  `Cmd/Ctrl + K` opens a dialog that accepts a URL **or** an image pasted from the clipboard.

## Images

A screenshot from a large monitor, pasted at full size, pushes the text below it out of sight —
Redmine caps image **width** to the content column but not **height**. So:

- Pasted / dropped images wider than **1200 px** (or taller than 800 px) are inserted as a
  **small clickable preview** using Redmine's own macro: `{{thumbnail(shot.png, size=350)}}`.
  Smaller images go in inline at full size: `![](icon.png)`.
- Click an image in the editor to switch its mode:

  | Mode | Stored Markdown | Rendered |
  |---|---|---|
  | Small preview (clickable) | `{{thumbnail(shot.png, size=N)}}` | small thumbnail, click → full image |
  | Full width | `![](shot.png)` | inline image, full width |
  | Link only | `[screenshot](https://host/attachments/123)` | a plain link — **no preview at all** |

  `−` / `+` step the size through **200 / 350 / 500 / 650 / 800 px** — multiples of 50, because
  Redmine rounds thumbnail sizes up to the nearest 50 (and caps at 800), so what you see in the
  editor is what the reader gets.

Everything here is native Redmine Markdown and macros, so previews keep rendering even with the
plugin turned off.

**Deleting a comment deletes its images.** Redmine's *Delete* on a comment only blanks the text, so
a comment that carried a screenshot used to stay behind as a bare *"File … added"* line with the
image still attached. Those files are now removed for good — but only the ones that came with that
comment, and only if the filename isn't referenced in the description or another comment. This is
irreversible; editing a comment (rather than deleting it) never removes a file.

**One preview, not two.** Redmine also renders its own preview for every attached image (under the
*"File … added"* line in the history, and in the issue's *Files* section). When the text already
refers to that attachment — as an image **or as a link** — the duplicate is hidden. It is kept only
when the attachment isn't mentioned in the text at all (a plain attached file), so nothing becomes
invisible; the file itself always stays listed under *Files*.

## Link only, and the link dialog

*Link only* turns a screenshot into a **complete, absolute link** to the attachment page, e.g.
`https://redmine.example.com/attachments/26137`. That link can be selected, copied and sent to a
colleague — and Redmine asks them to sign in before showing it, so screenshots with sensitive data
stay behind the login. (An attachment in a *public* project is readable without signing in; this is
login-gated, not a secret.)

The inserted label is the word **`screenshot`**, and it is left selected, so typing replaces it with
your own wording while keeping the link. Prefer the preview back? Select the link and use
**Show as image** in the bubble toolbar.

The URL host comes from the browser's current origin, **not** from `Setting.host_name` — a staging
clone restored from a production dump carries the production host name, and links built from it
would point at the wrong server.

`Cmd/Ctrl + K` (or 🔗 in the bubble toolbar) opens a small dialog that takes either:

- a **URL** — applied to the selected text, as before; or
- an **image pasted or dropped straight into the dialog** — it gets uploaded, attached to the issue
  and inserted **as a link, with no preview**.

That is the second route to the same result: write the sentence first, select a word, `Cmd/Ctrl + K`,
paste the screenshot. Readers who want to see images inline still get them from the other two modes —
this is for the ones who would rather read text and open pictures on demand.

## Keyboard

| Key | Action |
|-----|--------|
| `Cmd/Ctrl + B` / `I` | Bold / italic |
| `Cmd/Ctrl + K` | Insert link — **when text is selected** |
| `Cmd/Ctrl + Shift + A` | Attach a file |
| `/` | Block palette |
| `#` / `@` / `:` | Issue link / mention / emoji |

`Cmd/Ctrl + K` is contextual (like Linear): with a selection it belongs to the editor and inserts
a link; with no selection — or outside the editor — it opens the
[command palette](https://github.com/martinkopac19/redmine_command_palette) (**0.4.1+** required
for this split; `Cmd/Ctrl + Shift + K` always opens the palette).

## Scope

Feature set is limited to what round-trips cleanly through Redmine's CommonMark storage.
Notion-only features that Redmine's Markdown/sanitizer can't represent — underline,
collapsible sections, video auto-embeds, date mentions, Figma previews — are intentionally
out of scope.

## Requirements

- Redmine **6.0+** (`text_formatting = common_mark`).

## Installation

```
cd /path/to/redmine/plugins
git clone https://github.com/martinkopac19/redmine_rich_editor.git
# restart Redmine (e.g. restart the app server / container)
```

Toggle it in **Administration → Plugins → Configure** (kill-switch). When off, the native
textarea editor is used.

## Development

The client is TipTap (ProseMirror), bundled with esbuild into a single static file that
Redmine serves — no Node at runtime.

```
npm install
npm run build   # -> assets/javascripts/rich_editor.bundle.js
```

## How it works

- A view hook (`view_layouts_base_html_head` / `_body_bottom`) injects the CSS/JS and a tiny
  `RE_CONFIG`.
- The editor mounts over `textarea#issue_description` / `#issue_notes`, hides the textarea and
  keeps it as the source of truth: every change is serialised to Markdown back into it.
- Saving uses Redmine's own endpoints, so journals and permissions are unchanged.

## License

Copyright (C) 2026 Martin Kopáč

GPL-2.0.
