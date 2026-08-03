# Redmine Rich Editor (Previo) — Linear-style inline WYSIWYG nad issue popisom/názvom/komentármi.
# Upgrade-safe: len view hooky + progresívne vylepšenie textarey, žiadny patch jadra,
# žiadne migrácie, ukladá sa cez natívne Redmine endpointy (zachová journaly aj práva).

require_relative 'lib/rich_editor/hooks'

Redmine::Plugin.register :redmine_rich_editor do
  name 'Redmine Rich Editor (Previo)'
  author 'Martin Kopáč'
  description 'Linear-style inline WYSIWYG editor for issue title, description and comments. ' \
              'Text-area backed, round-trips to Markdown, preserves journals and permissions.'
  version '0.7.2'
  url 'https://github.com/martinkopac19/redmine_rich_editor'
  requires_redmine version_or_higher: '6.0'

  settings default: { 'enabled' => '1' }, partial: 'settings/rich_editor'
end
