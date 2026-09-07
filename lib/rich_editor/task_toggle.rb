module RichEditor
  # Zaškrtnutie checkboxu v už uloženom komentári — bez otvárania editácie.
  #
  # Redmine renderuje task listy (`- [ ] text`) VŽDY ako `disabled` checkbox
  # (`lib/redmine/wiki_formatting/common_mark/formatter.rb`, `tasklist: true`), takže
  # zaškrtnúť sa dá len prepisom textu komentára. Editáciu komentára smie len jeho autor
  # (alebo `edit_issue_notes`) — checklist v komentári tým bol pre ostatných mŕtvy.
  #
  # Tento modul je ČISTÁ logika prepisu: nájde v markdowne značky `[ ]` / `[x]` a prepíše
  # práve jednu. Nič iné sa v texte zmeniť nemôže — a to je celý bezpečnostný základ toho,
  # že endpoint smie použiť aj človek, ktorý komentár upravovať nesmie.
  module TaskToggle
    # Task item = odrážka alebo číslovanie, medzera, a hneď `[ ]` / `[x]`.
    # `[ ]` v strede riadku checkbox nie je a nesmie sa započítať.
    MARKER = /\A([-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\]/
    FENCE  = /\A(`{3,}|~{3,})/

    def self.enabled?
      Setting.plugin_redmine_rich_editor['enabled'].to_s != '0'
    end

    # Kto smie zaškrtnúť: každý, kto smie na tú úlohu napísať komentár — teda člen tímu,
    # ktorý sa k úlohe môže vyjadriť. Kto má do projektu len nazeranie, políčko neodklikne.
    # `notes_addable?` je natívna metóda jadra, takže sa rešpektujú aj role obmedzené
    # na tracker a neaktívny/uzavretý projekt.
    #
    # Súkromný komentár smie odkliknúť len ten, kto ho vôbec vidí. `Journal.visible` to rieši
    # v SQL, tu je to explicitne, aby sa to dalo otestovať a nezáviselo to od volajúceho.
    def self.allowed?(journal, user)
      return false unless enabled?
      return false unless user && user.logged?
      return false unless journal.is_a?(Journal) && journal.persisted?

      issue = journal.journalized
      return false unless issue.is_a?(Issue) && issue.visible?(user)

      if journal.private_notes? && journal.user_id != user.id
        return false unless user.allowed_to?(:view_private_notes, issue.project)
      end

      issue.notes_addable?(user)
    end

    # Vráti značky v poradí, v akom ich renderer premení na checkboxy:
    # `[{ pos: <index znaku v texte>, checked: true/false }]`.
    # Riadky vo fenced code blocku sa preskakujú — tam sa checkbox nerenderuje a bez toho
    # by sa poradie rozišlo a klik by zaškrtol iné políčko, než na ktoré človek klikol.
    def self.markers(text)
      out = []
      fence = nil
      offset = 0
      text.to_s.each_line do |line|
        stripped = line.lstrip
        if fence
          fence = nil if stripped.start_with?(fence)
        elsif (f = FENCE.match(stripped))
          fence = f[1][0, 3]
        elsif (m = MARKER.match(stripped))
          indent = line.length - stripped.length
          out << { pos: offset + indent + m.begin(2), checked: m[2] != ' ' }
        end
        offset += line.length
      end
      out
    end

    # Koľko checkboxov z tohto textu naozaj vznikne. Zámerne sa pýtame RENDERERA, nie
    # vlastného regexu: je to nezávislá kontrola, že naše poradie značiek zodpovedá tomu,
    # čo vidí človek na stránke (indentovaný code block, makro, iný text formatting…).
    # `nil` = nevieme to zistiť → volajúci nesmie nič prepísať.
    def self.rendered_count(text)
      html = Redmine::WikiFormatting.to_html(Setting.text_formatting, text.to_s)
      html.to_s.scan('task-list-item-checkbox').size
    rescue StandardError
      nil
    end

    # Prepne `index`-tú značku na `checked`. Vráti `[novy_text, nil]` alebo `[nil, :priznak]`.
    #
    # `from` a `total` sú to, čo videl prehliadač v okamihu kliknutia (pôvodný stav políčka
    # a počet checkboxov v komentári). Keď to nesedí s aktuálnym textom, medzitým niekto
    # komentár zmenil — potom sa NEPREPISUJE nič a klient si má stránku načítať znova.
    def self.apply(text, index:, checked:, from:, total:)
      list = markers(text)
      rendered = rendered_count(text)

      return [nil, :unrenderable] if rendered.nil?
      # Poradie značiek musí sedieť s poradím checkboxov na stránke aj s tým, čo videl klient.
      return [nil, :stale] if list.size != rendered || list.size != total.to_i
      return [nil, :out_of_range] if index.to_i.negative? || index.to_i >= list.size

      marker = list[index.to_i]
      return [nil, :stale] if marker[:checked] != from
      return [text, nil] if marker[:checked] == checked # už je v cieľovom stave, netreba zápis

      out = text.dup
      out[marker[:pos]] = checked ? 'x' : ' '
      [out, nil]
    end
  end
end
