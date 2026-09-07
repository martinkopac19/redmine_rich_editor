# Endpointy pluginu: @mention autocomplete (čítanie) a zaškrtnutie checkboxu v uloženom
# komentári (zápis jedného znaku). Oboje len pre prihláseného.
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

  # Zaškrtnutie/odškrtnutie jedného checkboxu v už uloženom komentári.
  #
  # Zámerne to NEIDE cez `PUT /journals/:id`: ten pustí dovnútra len autora komentára
  # (`Journal#editable_by?`) a prijme akýkoľvek text. Tu smie zaškrtnúť každý, kto na úlohu
  # môže komentovať, a jediná možná zmena je prepis jedného znaku medzi hranatými zátvorkami —
  # text komentára sa z requestu neprijíma vôbec, len poradové číslo políčka.
  #
  # `update_columns` je úmyselné: obchádza callbacky aj `updated_on`, takže komentár nezačne
  # hlásiť „· edited" (to by vyzeralo, akoby niekto prepísal jeho obsah).
  def toggle_task
    journal = Journal.visible.find(params[:id])
    return render_task_error(:forbidden, :forbidden) unless RichEditor::TaskToggle.allowed?(journal, User.current)

    new_text, err = RichEditor::TaskToggle.apply(
      journal.notes,
      index: params[:index].to_i,
      checked: params[:checked].to_s == '1',
      from: params[:from].to_s == '1',
      total: params[:total].to_i
    )
    return render_task_error(:conflict, err) if err

    journal.update_columns(notes: new_text) if new_text != journal.notes
    Rails.logger.info(
      "[rich_editor] task toggled: journal=#{journal.id} index=#{params[:index].to_i} " \
      "checked=#{params[:checked]} by=#{User.current.login}"
    )
    render json: { ok: true }
  rescue ActiveRecord::RecordNotFound
    render_task_error(:not_found, :not_found)
  end

  private

  def render_task_error(status, reason)
    render json: { ok: false, reason: reason.to_s }, status: status
  end

  # DB-agnostický CONCAT mena (PostgreSQL na tejto inštancii, ale nech je to prenosné).
  def concat_name_sql
    "COALESCE(firstname,'') || ' ' || COALESCE(lastname,'')"
  end
end
