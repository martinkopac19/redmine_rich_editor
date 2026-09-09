# Redmine Rich Editor (Previo) — Linear-style inline WYSIWYG nad issue popisom/názvom/komentármi.
# Upgrade-safe: len view a controller hooky + progresívne vylepšenie textarey, žiadny patch jadra,
# žiadne migrácie, ukladá sa cez natívne Redmine endpointy (zachová journaly aj práva).
# Aj zlučovanie záznamov histórie ide cez natívny hook `controller_issues_edit_after_save`.

require_relative 'lib/rich_editor/hooks'
require_relative 'lib/rich_editor/task_toggle'
require_relative 'lib/rich_editor/journal_hooks'
require_relative 'lib/rich_editor/merge_hooks'

Redmine::Plugin.register :redmine_rich_editor do
  name 'Redmine Rich Editor (Previo)'
  author 'Martin Kopáč'
  description 'Linear-style inline WYSIWYG editor for issue title, description and comments. ' \
              'Text-area backed, round-trips to Markdown, preserves journals and permissions.'
  version '0.15.0'
  url 'https://github.com/martinkopac19/redmine_rich_editor'
  requires_redmine version_or_higher: '6.0'

  settings default: {
             'enabled' => '1',
             'merge_live_edits' => '1',
             'merge_window_minutes' => '10'
           },
           partial: 'settings/rich_editor'
end
