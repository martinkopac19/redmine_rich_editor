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
        atts: attachment_map(issue),
        i18n: {
          placeholder: ::I18n.t(:re_ph),
          link: ::I18n.t(:re_link_prompt),
          noBlocks: ::I18n.t(:re_no_blocks),
          addComment: ::I18n.t(:re_add_comment),
          submit: ::I18n.t(:re_submit),
          textSize: ::I18n.t(:re_text_size),
          normalText: ::I18n.t(:re_normal_text),
          heading: ::I18n.t(:re_heading),
          bulletList: ::I18n.t(:re_bullet_list),
          numberedList: ::I18n.t(:re_numbered_list),
          checklist: ::I18n.t(:re_checklist),
          codeBlock: ::I18n.t(:re_code_block),
          imgSmall: ::I18n.t(:re_img_small),
          imgFull: ::I18n.t(:re_img_full),
          imgLink: ::I18n.t(:re_img_link),
          imgSmaller: ::I18n.t(:re_img_smaller),
          imgBigger: ::I18n.t(:re_img_bigger)
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

    # filename → { u: URL plného obrázka, t: základ URL náhľadu (JS doplní /<size>) }.
    # Slúži len na NÁHĽAD v editore: bez toho má editor v `src` iba filename (rozbitý obrázok,
    # kým sa issue neuloží). Cesty stavíme ručne — hook nemá spoľahlivý routing kontext.
    # Rovnaké mená prílohy: vyhráva najnovšia (rovnako ako Attachment.latest_attach v jadre).
    def attachment_map(issue)
      return {} unless issue

      root = Redmine::Utils.relative_url_root.to_s
      issue.attachments.sort_by(&:id).each_with_object({}) do |a, h|
        h[a.filename] = {
          u: "#{root}/attachments/download/#{a.id}/#{ERB::Util.url_encode(a.filename)}",
          t: (a.thumbnailable? ? "#{root}/attachments/thumbnail/#{a.id}" : nil)
        }
      end
    rescue StandardError
      {}
    end

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
