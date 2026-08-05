module RichEditor
  # Zmazanie komentára zmaže aj obrázky/súbory, ktoré s tým komentárom prišli.
  #
  # Ako to Redmine robí sám: „Delete" nad komentárom je `PUT /journals/:id` s prázdnymi notes a
  # journal sa zahodí LEN ak nemá žiadne details (`JournalsController#update`). Komentár s obrázkom
  # má detail „File X added", takže journal prežije a príloha ostane visieť na issue — obrázok je
  # stále v sekcii Files, v histórii aj na disku.
  #
  # Napájame sa na NATÍVNE hooky (`controller_journals_edit_post`, `view_journals_update_js_bottom`)
  # → žiadny patch jadra. Kill-switch pluginu vracia pôvodné chovanie Redmine.
  #
  # Mažeme len prílohy, ktoré:
  #   * pridal práve tento komentár (jeho vlastný `attachment` detail),
  #   * patria tomuto issue,
  #   * nie sú spomenuté v popise ani v inom komentári (aby sme nerozbili cudzí odkaz).
  # Prílohu rušíme priamo (`Attachment#destroy`), nie cez asociáciu issue — inak by
  # `acts_as_attachable :after_remove` dopísal do histórie ešte „File X deleted".
  # `after_commit :delete_from_disk` v jadre zmaže aj samotný súbor.
  class JournalHooks < Redmine::Hook::ViewListener
    def controller_journals_edit_post(context = {})
      return unless enabled?

      journal = context[:journal]
      return unless journal.is_a?(Journal) && journal.persisted?
      return unless journal.notes.blank? # zaujíma nás len zmazanie komentára, nie úprava

      issue = journal.journalized
      return unless issue.is_a?(Issue)

      removed = cleanup_attachments(journal, issue)
      return if removed.zero?

      # príznak pre view hook (musí sa nastaviť PRED destroy — zmazaný objekt je frozen)
      journal.instance_variable_set(:@re_removed_attachments, removed)
      journal.reload
      # rovnaké pravidlo ako v jadre: prázdny journal nemá čo zobrazovať
      journal.destroy if journal.details.empty? && journal.notes.blank?
    rescue StandardError => e
      log_error(e)
    end

    # Keď sme naozaj niečo zmazali, prekresli stránku — inak by v sekcii „Files" ostal riadok
    # odkazujúci na už neexistujúcu prílohu (natívna JS odpoveď mení len blok komentára).
    def view_journals_update_js_bottom(context = {})
      journal = context[:journal]
      return '' unless journal && journal.instance_variable_get(:@re_removed_attachments).to_i > 0

      'window.location.reload();'
    end

    private

    def cleanup_attachments(journal, issue)
      removed = 0
      journal.details.where(property: 'attachment').to_a.each do |detail|
        next if detail.value.blank? # „pridané" má value = názov súboru („zmazané" ho má v old_value)

        att = Attachment.find_by(id: detail.prop_key)
        if att.nil?
          detail.destroy # príloha už neexistuje → nenechávaj v histórii mŕtvy riadok
          next
        end
        next unless att.container_type == 'Issue' && att.container_id == issue.id
        next if referenced_elsewhere?(issue, journal, att.filename)

        att.destroy
        detail.destroy
        removed += 1
      end
      removed
    end

    def referenced_elsewhere?(issue, journal, filename)
      return true if issue.description.to_s.include?(filename)

      issue.journals.where.not(id: journal.id)
           .where('notes LIKE ?', "%#{filename}%").exists?
    end

    def enabled?
      Setting.plugin_redmine_rich_editor['enabled'].to_s != '0'
    end

    def log_error(err)
      return unless Rails.logger

      Rails.logger.error("[rich_editor] cleanup of comment attachments failed: #{err.class}: #{err.message}")
    end
  end
end
