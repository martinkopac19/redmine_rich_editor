# Malý endpoint pre @mention autocomplete. Vracia login + meno; vloženie `@login` do textu
# spustí natívnu Redmine mention notifikáciu pri uložení. Len čítanie, len prihlásený.
class RichEditorController < ApplicationController
  before_action :require_login

  def mentionables
    q = params[:q].to_s.strip.downcase
    scope = User.active

    # ak poznáme projekt, obmedz na jeho členov (aby @mention dávala zmysel = notifikuje)
    project = params[:project_id].present? ? Project.find_by(id: params[:project_id]) : nil
    if project
      member_ids = project.members.pluck(:user_id)
      scope = scope.where(id: member_ids) if member_ids.any?
    end

    if q.present?
      like = "%#{ActiveRecord::Base.sanitize_sql_like(q)}%"
      scope = scope.where(
        "LOWER(login) LIKE :q OR LOWER(firstname) LIKE :q OR LOWER(lastname) LIKE :q " \
        "OR LOWER(#{concat_name_sql}) LIKE :q", q: like
      )
    end

    users = scope.order(:lastname, :firstname).limit(8)
    render json: users.map { |u| { login: u.login, name: u.name } }
  end

  private

  # DB-agnostický CONCAT mena (PostgreSQL na tejto inštancii, ale nech je to prenosné).
  def concat_name_sql
    "COALESCE(firstname,'') || ' ' || COALESCE(lastname,'')"
  end
end
