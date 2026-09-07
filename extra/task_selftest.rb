# Selftest zaskrtavania checkboxov v ulozenom komentari (redmine_rich_editor).
#
# Vacsina kontrol je CISTA LOGIKA nad textom (ziadna DB). Posledna sekcia sa dotyka DB, ale
# vsetko je vo vonkajsej transakcii, ktora sa na konci zahodi — klon obsahuje realne
# produkcne data, takze po sebe nesmie zostat ani stopa.
#
# Spustenie:
#   docker compose exec -T --user redmine -e SECRET_KEY_BASE=... redmine \
#     bin/rails runner -e production plugins/redmine_rich_editor/extra/task_selftest.rb

require_relative '../lib/rich_editor/task_toggle'

T = RichEditor::TaskToggle

$ok = 0
$bad = 0

def check(name, actual, expected)
  if actual == expected
    $ok += 1
    puts "  #{name.ljust(52)}: OK"
  else
    $bad += 1
    puts "  #{name.ljust(52)}: CHYBA (ocakavane #{expected.inspect}, prislo #{actual.inspect})"
  end
end

puts '[1] Hladanie znaciek v markdowne'

two = "- [ ] prva\n- [x] druha\n"
check('dve polozky', T.markers(two).map { |m| m[:checked] }, [false, true])

check('hviezdicka aj plus su tiez odrazky',
      T.markers("* [ ] a\n+ [x] b\n").size, 2)

check('`[ ]` v strede riadku nie je checkbox',
      T.markers("text [ ] dalej text\n").size, 0)

check('odrazka bez zatvoriek nie je checkbox',
      T.markers("- obycajna odrazka\n").size, 0)

fenced = "- [ ] skutocna\n\n```\n- [ ] v code blocku\n- [x] tiez v code blocku\n```\n\n- [x] druha skutocna\n"
check('fenced code block sa preskoci',
      T.markers(fenced).map { |m| m[:checked] }, [false, true])

check('vnorena polozka sa pocita',
      T.markers("- [ ] rodic\n  - [x] dieta\n").size, 2)

puts '[2] Prepis znacky'

out, err = T.apply(two, index: 0, checked: true, from: false, total: 2)
check('zaskrtnutie prvej', [out, err], ["- [x] prva\n- [x] druha\n", nil])

out, err = T.apply(two, index: 1, checked: false, from: true, total: 2)
check('odskrtnutie druhej', [out, err], ["- [ ] prva\n- [ ] druha\n", nil])

out, = T.apply(two, index: 0, checked: true, from: false, total: 2)
check('zmeni sa presne jeden znak',
      out.chars.each_with_index.count { |c, i| c != two[i] }, 1)
check('dlzka textu sa nemeni', out.length, two.length)

# Diakritika: pozicia znacky sa pocita v ZNAKOCH, nie v bajtoch. S bajtovym offsetom by
# prepis druhej polozky trafil doprostred textu prvej.
dia = "- [ ] Zlutoucky kun upel dabelske ody s prehlaskami: ěščřžýáíé\n- [ ] druha\n"
out, err = T.apply(dia, index: 1, checked: true, from: false, total: 2)
check('utf-8 text: prepise sa spravna znacka',
      [out, err], [dia.sub("- [ ] druha", "- [x] druha"), nil])

out, err = T.apply(two, index: 0, checked: true, from: true, total: 2)
check('nesedi povodny stav -> stale', [out, err], [nil, :stale])

out, err = T.apply(two, index: 0, checked: true, from: false, total: 3)
check('nesedi pocet policok -> stale', [out, err], [nil, :stale])

out, err = T.apply(two, index: 9, checked: true, from: false, total: 2)
check('index mimo rozsahu', [out, err], [nil, :out_of_range])

out, err = T.apply(two, index: 1, checked: true, from: true, total: 2)
check('uz je v cielovom stave -> text bez zmeny', [out, err], [two, nil])

puts '[3] Poradie znaciek sedi s poradim checkboxov na stranke'

check('bezny text: renderer aj regex daju rovnaky pocet',
      T.rendered_count(two), T.markers(two).size)
check('fenced: renderer aj regex daju rovnaky pocet',
      T.rendered_count(fenced), T.markers(fenced).size)
check('renderer nepocita `[ ]` v strede riadku',
      T.rendered_count("text [ ] dalej\n"), 0)

# Toto je ta poistka, pre ktoru sa renderer vola: markdown, kde sa nase poradie znaciek
# rozide s realitou, sa NEPREPISUJE vobec. Indentovany code block (4 mezery) je presne
# taky pripad — regex tam znacku vidi, renderer checkbox nevykresli.
indented = "text\n\n    - [ ] toto je code block, nie checkbox\n"
if T.rendered_count(indented) != T.markers(indented).size
  out, err = T.apply(indented, index: 0, checked: true, from: false, total: 1)
  check('rozidene poradie -> neprepisuje sa nic', [out, err], [nil, :stale])
else
  check('rozidene poradie -> neprepisuje sa nic', 'renderer sa nerozisel', 'renderer sa nerozisel')
end

puts '[4] Prava (DB, vsetko sa na konci zahodi)'

ActiveRecord::Base.transaction do
  journal = Journal.where(journalized_type: 'Issue', private_notes: false)
                   .where.not(notes: [nil, '']).order(:id).last
  issue = journal.journalized

  admin = User.active.where(admin: true).order(:id).first
  check('admin smie zaskrtnut', T.allowed?(journal, admin), true)
  check('anonym nesmie', T.allowed?(journal, User.anonymous), false)

  # Clovek, ktory na projekt NEMA ziadnu rolu: ulohu (verejny projekt) vidiet moze,
  # komentovat nie -> policko neodklikne.
  outsider = User.active.where(admin: false).where.not(id: issue.project.members.pluck(:user_id)).order(:id).first
  if outsider
    check('bez prava komentovat nesmie',
          T.allowed?(journal, outsider), outsider.allowed_to?(:add_issue_notes, issue.project))
  else
    check('bez prava komentovat nesmie', 'v klone nie je vhodny user', 'v klone nie je vhodny user')
  end

  check('vypnuty plugin -> nesmie nikto', begin
    orig = Setting.plugin_redmine_rich_editor
    Setting.plugin_redmine_rich_editor = orig.merge('enabled' => '0')
    res = T.allowed?(journal, admin)
    Setting.plugin_redmine_rich_editor = orig
    res
  end, false)

  puts '[5] Tichy zapis (komentar nezacne hlasit "edited")'

  # Presne to, co robi controller: `update_columns` obchadza callbacky aj `updated_on`.
  # Keby sa pisalo cez `save`, `render_journal_update_info` by pri komentari zobrazil
  # "· edited" a vyzeralo by to, ze niekto prepisal text.
  target = Journal.create!(journalized: issue, user: admin, notes: "- [ ] jedna\n- [ ] dva\n")
  before_updated_on = Journal.find(target.id).updated_on
  before_updated_by = Journal.find(target.id).updated_by_id

  new_text, err = T.apply(target.notes, index: 1, checked: true, from: false, total: 2)
  check('apply nad realnym komentarom prejde', err, nil)
  target.update_columns(notes: new_text)

  fresh = Journal.find(target.id)
  check('text v DB je prepisany', fresh.notes, "- [ ] jedna\n- [x] dva\n")
  check('updated_on sa nezmenil', fresh.updated_on, before_updated_on)
  check('updated_by sa nezmenil', fresh.updated_by_id, before_updated_by)
  check('komentar nehlasi "edited"', fresh.created_on == fresh.updated_on, true)

  raise ActiveRecord::Rollback
end

puts
puts "Vysledok: #{$ok} OK, #{$bad} CHYBA"
exit($bad.zero? ? 0 : 1)
