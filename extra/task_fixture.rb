# Docasne testovacie data pre zaskrtavanie checkboxov v komentari.
# Vytvori usera s rolou Viewer (smie komentovat, NESMIE editovat komentare — presne ten
# pripad, ktory doteraz checkbox nezaklikol), usera bez prava komentovat, ulohu a komentar
# s tromi checkboxami od NIEKOHO INEHO.
#
#   bin/rails runner -e production plugins/redmine_rich_editor/extra/task_fixture.rb setup
#   bin/rails runner -e production plugins/redmine_rich_editor/extra/task_fixture.rb teardown

MODE = (ARGV[0] || 'setup')
PASS = 'DocasneHesloNaTest-2026'
RO_ROLE = 'RE docasna rola len na citanie'
NOTES = "- [ ] prva vec\n- [ ] druha vec\n- [x] tretia hotova\n"

# V tejto instancii NEEXISTUJE rola, ktora ulohy vidi a komentovat nesmie — kto vidi, ten
# aj komentuje. Aby sa dala otestovat aj ta druha strana (policka musia zostat zamknute),
# vytvorime si docasnu rolu; teardown ju maze.
def readonly_role!
  role = Role.find_by(name: RO_ROLE)
  return role if role

  role = Role.new(name: RO_ROLE, issues_visibility: 'all')
  role.permissions = [:view_issues]
  role.save!
  role
end

def find_or_make_user(login, role_name, project)
  user = User.find_by(login: login)
  unless user
    user = User.new(login: login, firstname: 'Re', lastname: login,
                    mail: "#{login}@previo.cz", language: 'en')
    user.password = PASS
    user.must_change_passwd = false
    user.admin = false
    user.save!
  end
  role = Role.find_by(name: role_name) || raise("rola #{role_name} neexistuje")
  unless Member.exists?(user_id: user.id, project_id: project.id)
    Member.create!(user: user, project: project, roles: [role])
  end
  user
end

# Projekty v klone maju povinne vlastne polia aj kategoriu — doplnime prvu pouzitelnu
# hodnotu, aby sa dala uloha vobec vytvorit. Testu je jedno, co v tych poliach je.
def fill_required!(issue, project)
  issue.category = project.issue_categories.first if project.issue_categories.any?
  issue.custom_field_values.each do |cv|
    cf = cv.custom_field
    next unless cf.is_required
    next if cv.value.present?

    opts = begin
      cf.possible_values_options(project)
    rescue StandardError
      nil
    end
    cv.value =
      if opts.present?
        o = opts.first
        o.is_a?(Array) ? o.last.to_s : o.to_s
      else
        case cf.field_format
        when 'bool' then '1'
        when 'date' then Date.today.to_s
        when 'int', 'float' then '1'
        else 'test'
        end
      end
  end
end

if MODE == 'setup'
  admin = User.active.where(admin: true).order(:id).first
  User.current = admin

  issue = nil
  project = nil
  Project.active.joins(:trackers).distinct.order(:id).each do |p|
    cand = Issue.new(project: p, tracker: p.trackers.first, author: admin,
                     subject: 'DOCASNA testovacia uloha — checkboxy v komentari',
                     description: 'Vytvorene automatickym testom, po teste sa maze.')
    fill_required!(cand, p)
    next unless cand.save

    issue = cand
    project = p
    break
  end
  raise 'nepodarilo sa vytvorit ulohu v ziadnom projekte' unless issue

  tester = find_or_make_user('re_task_tester', 'Viewer', project)
  readonly_role!
  noperm = find_or_make_user('re_task_noperm', RO_ROLE, project)

  journal = Journal.create!(journalized: Issue.find(issue.id), user: admin, notes: NOTES)

  puts "PROJECT=#{project.identifier}"
  puts "ISSUE=#{issue.id}"
  puts "JOURNAL=#{journal.id}"
  puts "TESTER=#{tester.login} (#{tester.id}) role=Viewer"
  puts "NOPERM=#{noperm.login} (#{noperm.id}) role=#{RO_ROLE}"
  puts "PASS=#{PASS}"
  # Kontrola, ze test naozaj meri to, co ma: tester komentar upravit NESMIE.
  puts "tester_editable_by=#{journal.editable_by?(tester)}"
  puts "tester_notes_addable=#{Issue.find(issue.id).notes_addable?(tester)}"
  puts "noperm_notes_addable=#{Issue.find(issue.id).notes_addable?(noperm)}"
  puts "noperm_issue_visible=#{Issue.find(issue.id).visible?(noperm)}"
elsif MODE == 'reset'
  # Vrati komentar do vychodzieho stavu, aby sa CDP test dal pustit znova.
  issue = Issue.where("subject LIKE 'DOCASNA testovacia uloha%'").order(:id).last
  journal = issue && Journal.where(journalized: issue).order(:id).first
  if journal
    journal.update_columns(notes: NOTES)
    puts "journal #{journal.id} obnoveny: #{Journal.find(journal.id).notes == NOTES}"
  else
    puts 'komentar neexistuje'
  end
elsif MODE == 'teardown'
  admin = User.active.where(admin: true).order(:id).first
  User.current = admin
  issue = Issue.where("subject LIKE 'DOCASNA testovacia uloha%'").order(:id).last
  if issue
    id = issue.id
    issue.destroy
    puts "issue #{id} zmazana: #{Issue.exists?(id) ? 'NIE' : 'ANO'}"
  else
    puts 'issue neexistuje'
  end
  %w[re_task_tester re_task_noperm].each do |login|
    u = User.find_by(login: login)
    next puts("user #{login} neexistuje") unless u

    uid = u.id
    u.destroy
    puts "user #{login} zmazany: #{User.exists?(uid) ? 'NIE' : 'ANO'}"
  end
  role = Role.find_by(name: RO_ROLE)
  if role
    rid = role.id
    role.destroy
    puts "rola zmazana: #{Role.exists?(rid) ? 'NIE' : 'ANO'}"
  else
    puts 'rola neexistuje'
  end
else
  puts 'pouzitie: task_fixture.rb setup|teardown'
end
