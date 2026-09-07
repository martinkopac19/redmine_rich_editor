RedmineApp::Application.routes.draw do
  # Autocomplete pre @mention (vráti login + meno; @login potom notifikuje natívne Redmine).
  get 'rich_editor/mentionables', to: 'rich_editor#mentionables', as: 'rich_editor_mentionables'

  # Zaškrtnutie checkboxu v uloženom komentári — bez otvárania editácie komentára.
  post 'rich_editor/journals/:id/task', to: 'rich_editor#toggle_task', as: 'rich_editor_journal_task'
end
