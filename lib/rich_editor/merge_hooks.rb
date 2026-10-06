module RichEditor
  # ZLÚČENIE PO SEBE IDÚCICH ŽIVÝCH ÚPRAV POPISU/NÁZVU DO JEDNÉHO ZÁZNAMU HISTÓRIE.
  #
  # Problém: živý editor ukladá sám. Keď užívateľ vloží obrázok a o pár sekúnd ho prepne
  # na odkaz, vzniknú DVA záznamy (A→B, B→C) a DVE notifikácie o tom istom. V Redmine 6.1.3
  # neexistuje žiadna agregácia journalov, takže sa to musí spraviť tu.
  # Cieľ: v histórii JEDEN záznam A→C (medzikroky sa nezobrazujú vôbec) a jeden mail.
  #
  # Ako: Redmine necháme urobiť jeho prácu úplne normálne (validácie, práva, detaily, prílohy)
  # a AŽ POTOM — ešte v tej istej transakcii, z NATÍVNEHO hooku `controller_issues_edit_after_save`
  # — detaily nového záznamu vlejeme do predchádzajúceho a nový zahodíme. Žiadny patch jadra,
  # žiadna migrácia.
  #
  # Tri veci, na ktorých to stojí:
  #   1) `journal.notify = false` MUSÍ byť nastavené explicitne. `after_create_commit` sa spustí
  #      aj pre riadok zmazaný v tej istej transakcii — Rails sa v `transaction_include_any_action?`
  #      pozerá na stav pri VSTUPE do transakcie. Samotné `destroy` mail nepotlačí.
  #   2) Detail v predchádzajúcom zázname sa upravuje NA MIESTE (`update_columns`).
  #      `journal_details.id` je v už odoslanom prvom maile ako odkaz „(diff)" (jadro pre
  #      `description` renderuje odkaz na diff, nie samotný text). Zachovaním id ten odkaz
  #      ďalej funguje a ukazuje rovno finálny stav A→C.
  #   3) Celé zlúčenie beží vo vnorenej transakcii (SAVEPOINT) a NIKDY nevyhodí výnimku von.
  #      Sme vnútri `Issue.transaction` zo `save_issue_with_child_records`; výnimka by zrolovala
  #      uloženie a užívateľovi by zmizol text. Keď zlúčenie zlyhá, ostane pôvodné správanie:
  #      dva záznamy.
  module LiveMerge
    MERGEABLE_ATTRS = %w[description subject].freeze

    module_function

    def settings
      Setting.plugin_redmine_rich_editor || {}
    end

    # POZOR: pluginové nastavenia sa po pridaní nového kľúča NEDOPLNIA do už uloženého riadku
    # v `settings` — default sa použije len keď riadok neexistuje. Preto všade vlastný fallback
    # (chýbajúci kľúč = zapnuté / 30 minút). Na klone aj na testovacom serveri je v DB uložené
    # len `enabled`, takže o dĺžke okna reálne rozhoduje TENTO fallback, nie default v `init.rb`.
    # Plugin zapnutý (ticho pri obrázku a pri úprave autora). Zlučovanie má navyše vlastný prepínač.
    def plugin_enabled?
      settings['enabled'].to_s != '0'
    end

    def enabled?
      plugin_enabled? && settings['merge_live_edits'].to_s != '0'
    end

    def window
      m = settings['merge_window_minutes'].to_i
      m = 30 if m <= 0
      m.clamp(1, 60).minutes
    end

    # Biela, nie čierna listina: keď iný plugin pridá vlastný typ detailu, zlučovanie sa samo
    # vypne, namiesto aby mu ticho zožralo záznam.
    def mergeable_detail?(detail)
      (detail.property == 'attr' && MERGEABLE_ATTRS.include?(detail.prop_key)) ||
        (detail.property == 'attachment' && detail.value.present?)
    end

    def mergeable_journal?(journal)
      journal.notes.blank? && !journal.private_notes? &&
        journal.details.all? { |d| mergeable_detail?(d) }
    end

    def call(issue, journal)
      return false unless enabled?
      return false unless journal.persisted?
      return false if journal.details.empty?
      return false unless mergeable_journal?(journal)

      prev = issue.journals.where.not(id: journal.id).order(:id).last
      return false unless prev
      return false unless prev.user_id == journal.user_id
      return false unless prev.created_on && prev.created_on > window.ago

      prev.reload
      return false unless mergeable_journal?(prev)
      # Úprava po 30-minútovej lehote autora sa NEzlúči do tichého záznamu z lehoty — inak by
      # zlúčenie (ktoré druhý mail vždy potlačí) predĺžilo ticho aj na neskoršie zmeny.
      return false if AuthorGrace.within?(issue, prev) && !AuthorGrace.within?(issue, journal)

      Journal.transaction(requires_new: true) do
        journal.notify = false # bez tohto odíde druhý mail aj po zmazaní záznamu
        fold(journal, prev)
      end
      true
    rescue StandardError => e
      Rails.logger&.warn("[rich_editor] journal merge skipped: #{e.class}: #{e.message}")
      false
    end

    def fold(journal, prev)
      targets = prev.details.to_a.index_by { |d| [d.property, d.prop_key] }

      journal.details.reload.to_a.each do |detail|
        target = targets[[detail.property, detail.prop_key]]
        if target.nil?
          # napr. „File X added" — nemá párový starý detail, len ho presuň
          detail.update_columns(journal_id: prev.id)
        elsif target.old_value.to_s == detail.value.to_s
          # zmena sa vrátila na pôvodnú hodnotu → v histórii nemá čo hľadať
          target.destroy
          detail.destroy
        else
          # A→B + B→C  ⇒  A→C. Id detailu zostáva, takže odkaz „(diff)" v starom maile žije.
          target.update_columns(value: detail.value)
          detail.destroy
        end
      end

      # `details` má `dependent: :delete_all`; po presune/zmazaní treba zhodiť cache asociácie,
      # inak by `destroy` zmazal aj riadky, ktoré sme práve presunuli do `prev`.
      journal.details.reset
      journal.destroy

      prev.reload
      prev.destroy if prev.notes.blank? && prev.details.empty?
    end
  end

  # TICHÁ ZMENA VEĽKOSTI OBRÁZKA.
  #
  # Popis issue je na detaile zároveň čítacia plocha a upraviť ho smie veľa ľudí. Kto si len
  # prepne náhľad (malý ↔ plná šírka, − / +), zmení tým text popisu → záznam v histórii
  # a notifikácia všetkým sledujúcim, hoci obsahovo sa nezmenilo nič.
  #
  # Rozhodnutie (Martin, 6. 10. 2026): takú zmenu uložiť ÚPLNE POTICHU — bez záznamu v histórii
  # a bez notifikácie. Čo je „len veľkosť", rozhoduje server porovnaním textov, nie klient:
  # popis pred a po sa musí zhodovať, keď sa každý obrázok (`![…](f)` aj `{{thumbnail(f, size=N)}}`)
  # zredukuje na samotný názov súboru. Akákoľvek iná zmena = bežný záznam ako doteraz.
  module ImageOnly
    module_function

    def call(journal)
      return false unless LiveMerge.plugin_enabled?
      return false unless journal.persisted? && journal.notes.blank?

      details = journal.details.to_a
      return false unless details.size == 1
      d = details.first
      return false unless d.property == 'attr' && d.prop_key == 'description'
      return false unless neutral(d.old_value) == neutral(d.value)

      Journal.transaction(requires_new: true) do
        journal.notify = false # viď LiveMerge — samotné destroy mail nepotlačí
        journal.destroy
      end
      true
    rescue StandardError => e
      Rails.logger&.warn("[rich_editor] silent image change skipped: #{e.class}: #{e.message}")
      false
    end

    # Text bez informácie o veľkosti/režime obrázkov. Normalizujú sa aj koncovky riadkov
    # (textarea posiela \r\n) a `<https://…>` — editor holú URL pri prvom uložení obalí
    # zátvorkami (0.17.8), Redmine ju vykreslí rovnako.
    def neutral(text)
      text.to_s.gsub("\r\n", "\n")
          .gsub(/\{\{\s*thumbnail\(\s*([^,)]+?)\s*(?:,[^)]*)?\)\s*\}\}/) { "\u0000img(#{$1})" }
          .gsub(/!\[[^\]]*\]\(\s*([^)\s]+)\s*\)/) { "\u0000img(#{$1})" }
          .gsub(%r{<(https?://[^>\s]+)>}, '\1')
          .strip
    end
  end

  # ÚPRAVA VLASTNEJ ÚLOHY TESNE PO ZALOŽENÍ — BEZ NOTIFIKÁCIE.
  #
  # Autor úlohu založí (odíde mail „nová úloha") a do pár minút si v nej doladí názov alebo popis.
  # Každá taká úprava poslala ďalší mail o tom istom. Rozhodnutie (Martin, 6. 10. 2026): keď autor
  # do 30 minút od založenia mení LEN názov / popis (prípadne pri tom pridá prílohu, napr. vložený
  # screenshot), záznam v histórii ostane, ale notifikácia neodíde.
  #
  # Výnimka: úprava, ktorou v popise PRIBUDNE @zmienka, notifikuje normálne — inak by sa zmienený
  # človek o úlohe nedozvedel. Komentár, zmena stavu, riešiteľa či iného poľa notifikujú vždy.
  # Platí pre každé uloženie (živý editor, formulár aj API).
  module AuthorGrace
    WINDOW = 30.minutes

    module_function

    def within?(issue, journal)
      issue.created_on && journal.created_on && journal.user_id == issue.author_id &&
        journal.created_on <= issue.created_on + WINDOW
    end

    def call(issue, journal)
      return false unless LiveMerge.plugin_enabled?
      return false unless journal.persisted? && journal.notes.blank? && within?(issue, journal)

      details = journal.details.to_a
      return false unless details.any? { |d| d.property == 'attr' }
      return false unless details.all? do |d|
        (d.property == 'attr' && %w[subject description].include?(d.prop_key)) ||
          (d.property == 'attachment' && d.value.present?)
      end
      return false if issue.respond_to?(:mentioned_users) && Array(issue.mentioned_users).any?

      journal.notify = false
      true
    rescue StandardError => e
      Rails.logger&.warn("[rich_editor] author grace skipped: #{e.class}: #{e.message}")
      false
    end
  end

  class MergeHooks < Redmine::Hook::ViewListener
    # `controller_issues_edit_after_save` (issues_controller.rb:681) beží VNÚTRI `Issue.transaction`,
    # teda pred commitom. Práve preto sa tu ešte dá potlačiť notifikácia a zmazanie záznamu je
    # atomické s uložením.
    def controller_issues_edit_after_save(context = {})
      params  = context[:params]
      issue   = context[:issue]
      journal = context[:journal]
      return unless params && issue.is_a?(Issue) && journal.is_a?(Journal)

      RichEditor::AuthorGrace.call(issue, journal)

      # ZÁMERNE len uloženia zo živého editora. Bežné odoslanie formulára, hromadná úprava ani
      # REST API sa nezlučujú — tam je uloženie vedomý akt a jeden záznam = jedno „Submit".
      return unless params[:re_live].to_s == '1'
      return if params[:time_entry].present?
      return if RichEditor::ImageOnly.call(journal)

      RichEditor::LiveMerge.call(issue, journal)
    end
  end
end
