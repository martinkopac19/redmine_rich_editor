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
- **F3 (in progress):** live description with auto-save on blur/idle (done); inline title
  editing and an always-visible comments bar are next.

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

GPL-2.0.
