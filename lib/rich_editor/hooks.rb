module RichEditor
  # Injektáž CSS + JS na každú stránku (len prihlásený + zapnuté v nastaveniach).
  # Bundle je vendored (esbuild) → nezávislý od Redmine asset pipeline verzií.
  class Hooks < Redmine::Hook::ViewListener
    def view_layouts_base_html_head(context = {})
      return '' unless enabled?

      project = context[:project]
      issue = safe_current_issue(context)
      eff_project = (project && project.persisted? ? project : (issue ? issue.project : nil))
      cfg = {
        base: Redmine::Utils.relative_url_root.to_s,
        meId: User.current.id,
        projectId: (eff_project ? eff_project.id : nil),
        i18n: {
          placeholder: ::I18n.t(:re_ph),
          link: ::I18n.t(:re_link_prompt),
          noBlocks: ::I18n.t(:re_no_blocks)
        }
      }
      out = +''
      out << stylesheet_link_tag('rich_editor', plugin: 'redmine_rich_editor')
      out << javascript_tag("window.RE_CONFIG=#{cfg.to_json};")
      out.html_safe
    end

    def view_layouts_base_body_bottom(context = {})
      return '' unless enabled?

      javascript_include_tag('rich_editor.bundle', plugin: 'redmine_rich_editor').html_safe
    end

    private

    def safe_current_issue(context)
      c = context[:controller]
      iss = c && c.instance_variable_get(:@issue)
      iss.is_a?(Issue) && iss.persisted? ? iss : nil
    rescue StandardError
      nil
    end

    def enabled?
      return false unless User.current.logged?

      Setting.plugin_redmine_rich_editor['enabled'].to_s != '0'
    end
  end
end
