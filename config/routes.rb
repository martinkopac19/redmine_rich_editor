RedmineApp::Application.routes.draw do
  # Autocomplete pre @mention (vráti login + meno; @login potom notifikuje natívne Redmine).
  get 'rich_editor/mentionables', to: 'rich_editor#mentionables', as: 'rich_editor_mentionables'
end
