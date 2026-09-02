# Selftest zlucovania zivych uprav (redmine_rich_editor).
# Bezi proti zivej DB, ale VSETKO je vo vonkajsej transakcii, ktora sa na konci zahodi —
# klon obsahuje realne produkcne data, takze po sebe nesmie zostat ani stopa.
# Maily NIKAM neodchadzaju: delivery_method sa prepne na :test.
#
# Spustenie:
#   docker compose exec -T --user redmine -e SECRET_KEY_BASE=... redmine \
#     bin/rails runner -e production plugins/redmine_rich_editor/extra/selftest_merge.rb

$ok = 0
$bad = 0

def check(name, actual, expected)
  if actual == expected
    $ok += 1
    puts "  #{name.ljust(50)}: OK"
  else
    $bad += 1
    puts "  #{name.ljust(50)}: CHYBA (ocakavane #{expected.inspect}, prislo #{actual.inspect})"
  end
end

# Ulozenie presne tak, ako to robi IssuesController#save_issue_with_child_records:
# vlastna transakcia + volanie hooku po uspesnom save.
#
# POZOR, preco sa uloha zakazdym nacitava NANOVO (`Issue.find`) a nie `reload`:
# Redmine si journal memoizuje na instancii (`@current_journal ||= Journal.new`) a `reload`
# to nezhodi. Druhe ulozenie tej istej instancie by teda recyklovalo PRVY journal namiesto
# vytvorenia noveho — a test by meral nieco uplne ine nez realitu. V controlleri je kazdy
# request cerstva instancia, takze toto je vlastnost testu, nie produkcneho kodu.
#
# `save` tu zamerne nie je v `raise ActiveRecord::Rollback` vetve: vnorene `transaction`
# bez `requires_new` Rollback TICHO zahodi, takze by neuspesne ulozenie vyzeralo ako uspesne.
def live_save!(issue_id, user, attrs, live: true)
  issue = Issue.find(issue_id)
  issue.init_journal(user)
  issue.safe_attributes = attrs.stringify_keys
  params = ActionController::Parameters.new(live ? { 're_live' => '1' } : {})
  Issue.transaction do
    raise "save zlyhal: #{issue.errors.full_messages.join(', ')}" unless issue.save

    Redmine::Hook.call_hook(:controller_issues_edit_after_save,
                            params: params, issue: issue, journal: issue.current_journal)
  end
  issue
end

# Pocet zaznamov historie priamo z DB (nie cez cachovanu asociaciu).
def journal_count(issue_id)
  Journal.where(journalized_type: 'Issue', journalized_id: issue_id).count
end

def last_journal(issue_id)
  Journal.where(journalized_type: 'Issue', journalized_id: issue_id).order(:id).last
end

# Uzavrie predchadzajucu davku: posunie posledny zaznam mimo casoveho okna, takze sa don
# uz nic nezlucuje. Bez toho by sa PRVE ulozenie kazdeho dalsieho bloku zlucilo so zaznamom
# z bloku predchadzajuceho a testy by merali navzajom prepletene scenare, nie ten svoj.
def start_fresh_burst!(issue_id)
  j = last_journal(issue_id)
  j&.update_columns(created_on: 2.hours.ago)
end

# Uloha, ktoru sa da po zmene popisu naozaj ulozit. Niektore projekty maju povinnu kategoriu
# alebo custom field a validacia by spadla na nieco, co s pluginom vobec nesuvisi.
# init_journal MUSI byt aj tu: Redmine berie povinne polia z workflow podla pouzivatela
# v journale, takze bez neho je valid? mieknejsi nez skutocny save.
def pick_saveable(user, limit = 200)
  Issue.where.not(description: [nil, '']).order(id: :desc).limit(limit).detect do |i|
    c = Issue.find(i.id)
    c.init_journal(user)
    c.description = "#{c.description} x"
    c.valid?
  end
end

puts "=" * 64
puts "Selftest: zlucovanie zivych uprav (redmine_rich_editor)"
puts "=" * 64

listeners = Redmine::Hook.hook_listeners(:controller_issues_edit_after_save).map { |l| l.class.name }
check("listener je zaregistrovany", listeners.include?('RichEditor::MergeHooks'), true)
check("zlucovanie je zapnute", RichEditor::LiveMerge.enabled?, true)
puts "  okno: #{RichEditor::LiveMerge.window.inspect}"

user  = User.active.where(admin: true).first
other = User.active.where.not(id: user.id).first
User.current = user

orig_method  = ActionMailer::Base.delivery_method
orig_perform = ActionMailer::Base.perform_deliveries
ActionMailer::Base.delivery_method = :test
ActionMailer::Base.perform_deliveries = true

conn = ActiveRecord::Base.connection
# joinable: false → vnutorne `transaction` bloky sa spravaju ako vrcholove a spustia sa
# after_commit callbacky (inak by sa notifikacia neposlala a nedalo by sa overit potlacenie).
conn.begin_transaction(joinable: false)
begin
  # with_synched_deliveries urobi z `deliver_later` inline doruceni, takze sa da pocitat
  Mailer.with_synched_deliveries do
    issue = pick_saveable(user)
    raise 'nenasiel som pouzitelnu ulohu' unless issue

    iss  = issue.id
    base = issue.description
    puts "
  testovacia uloha: ##{iss}"

    # --- 1. dve po sebe iduce ZIVE zmeny -> jeden zaznam A->C, jeden mail ---
    puts "\n[1] dve zive zmeny popisu za sebou"
    n0 = journal_count(iss)
    ActionMailer::Base.deliveries.clear
    live_save!(iss, user, { description: "#{base}\n\nmedzikrok" })
    mails_after_first = ActionMailer::Base.deliveries.size
    live_save!(iss, user, { description: "#{base}\n\nfinalny stav" })
    check("pribudol prave jeden zaznam", journal_count(iss) - n0, 1)
    check("prvy mail odisiel", mails_after_first >= 1, true)
    check("druhy mail NEodisiel", ActionMailer::Base.deliveries.size, mails_after_first)
    d = last_journal(iss).details.detect { |x| x.prop_key == 'description' }
    check("historia: povodny stav", d && d.old_value, base)
    # Redmine normalizuje konce riadkov na CRLF, takze sa porovnava s tym, co je naozaj
    # v DB — a to je zaroven silnejsie tvrdenie: historia sedi s aktualnym popisom.
    check("historia sedi s aktualnym popisom", d && d.value, Issue.find(iss).description)

    # --- 2. zmena vratena spat -> v historii nezostane nic ---
    puts "\n[2] zmena vratena na povodnu hodnotu"
    n = journal_count(iss)
    start_fresh_burst!(iss)
    cur = Issue.find(iss).description
    live_save!(iss, user, { description: "#{cur} docasne" })
    live_save!(iss, user, { description: cur })
    check("ziadny novy zaznam v historii", journal_count(iss), n)

    # --- 3. bezne ulozenie formulara sa NEzlucuje ---
    puts "\n[3] bezne ulozenie formulara (bez re_live)"
    n = journal_count(iss)
    start_fresh_burst!(iss)
    live_save!(iss, user, { description: "#{base} f1" }, live: false)
    live_save!(iss, user, { description: "#{base} f2" }, live: false)
    check("dva samostatne zaznamy", journal_count(iss) - n, 2)

    # --- 4. mimo casoveho okna ---
    puts "\n[4] predchadzajuci zaznam je starsi ako okno"
    n = journal_count(iss)
    start_fresh_burst!(iss)
    live_save!(iss, user, { description: "#{base} w1" })
    last_journal(iss).update_columns(created_on: 2.hours.ago)
    live_save!(iss, user, { description: "#{base} w2" })
    check("nezlucilo sa", journal_count(iss) - n, 2)

    # --- 5. medzitym niekto komentoval ---
    puts "\n[5] medzi ulozeniami pribudol cudzi komentar"
    n = journal_count(iss)
    start_fresh_burst!(iss)
    live_save!(iss, user, { description: "#{base} c1" })
    commenter = Issue.find(iss)
    commenter.init_journal(other, 'medzitym komentar')
    commenter.save!
    live_save!(iss, user, { description: "#{base} c2" })
    check("nezlucilo sa", journal_count(iss) - n, 3)

    # --- 6. druhu zmenu robi iny pouzivatel ---
    puts "\n[6] druhu zmenu robi iny pouzivatel"
    n = journal_count(iss)
    start_fresh_burst!(iss)
    live_save!(iss, user, { description: "#{base} u1" })
    live_save!(iss, other, { description: "#{base} u2" })
    check("nezlucilo sa", journal_count(iss) - n, 2)

    # --- 7. predchadzajuci zaznam nesie zmenu stavu ---
    puts "\n[7] predchadzajuci zaznam nesie zmenu stavu"
    n = journal_count(iss)
    start_fresh_burst!(iss)
    changer = Issue.find(iss)
    changer.init_journal(user)
    changer.status = changer.new_statuses_allowed_to(user).detect { |st| st.id != changer.status_id }
    changer.save!
    live_save!(iss, user, { description: "#{base} s1" })
    check("nezlucilo sa", journal_count(iss) - n, 2)
  end
ensure
  conn.rollback_transaction
  ActionMailer::Base.delivery_method = orig_method
  ActionMailer::Base.perform_deliveries = orig_perform
  ActionMailer::Base.deliveries.clear
end

puts "\n" + "=" * 64
puts "OK: #{$ok}   CHYBA: #{$bad}"
puts "(vsetky zmeny zahodene, v DB nezostalo nic, ziadny mail neodisiel)"
exit($bad.zero? ? 0 : 1)
