import { useState } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { FiGlobe, FiImage, FiType } from "react-icons/fi"
import { DEFAULT_SETTINGS } from "@neutab/shared/utils/settings"
import type { getTranslations } from "@neutab/shared/utils/i18n"
import { handleCommitOnEnter } from "~components/settings/sectionUtils"

interface SiteSectionProps {
  t: ReturnType<typeof getTranslations>
}

/** 站点分区:标签页标题与 Favicon 定制 */
const SiteSection = ({ t }: SiteSectionProps) => {
  const [siteTitle, setSiteTitle] = useStorage("siteTitle", DEFAULT_SETTINGS.siteTitle)
  const [siteFavicon, setSiteFavicon] = useStorage("siteFavicon", DEFAULT_SETTINGS.siteFavicon)

  const [titleDraft, setSiteTitleDraft] = useState<string>()
  const [faviconDraft, setSiteFaviconDraft] = useState<string>()
  const siteTitleDraft = titleDraft ?? siteTitle ?? ""
  const siteFaviconDraft = faviconDraft ?? siteFavicon ?? ""

  const commitSiteTitle = async () => {
    await setSiteTitle(siteTitleDraft)
    setSiteTitleDraft((current) => current === siteTitleDraft ? undefined : current)
  }

  const commitSiteFavicon = async () => {
    await setSiteFavicon(siteFaviconDraft)
    setSiteFaviconDraft((current) => current === siteFaviconDraft ? undefined : current)
  }

  return (
    <section className="settings-section" key="site">
      <h3>{t.siteSettings}</h3>

      {/* 页面元数据预览 (Title & Favicon) */}
      <div className="settings-island">
        <div className="site-preview-card" style={{ padding: "20px 18px" }}>
          <div className="site-preview-icon soft-in">
            {siteFavicon ? (
              <img src={siteFavicon} alt="Favicon" onError={(e) => (e.currentTarget.style.display = "none")} />
            ) : (
              <FiGlobe size={24} />
            )}
          </div>
          <div className="site-preview-info">
            <h4>{siteTitle || t.newTab}</h4>
            <p>{t.previewEffect}</p>
          </div>
        </div>
      </div>

      {/* 设置表单:支持失焦自动保存及 Enter 提交 */}
      <div className="settings-island">
        <div className="settings-field">
          <label>
            <FiType size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            {t.pageTitle}
          </label>
          <input
            type="text"
            className="settings-input soft-in"
            placeholder={t.pageTitlePlaceholder}
            value={siteTitleDraft}
            onChange={(e) => setSiteTitleDraft(e.target.value)}
            onBlur={commitSiteTitle}
            onKeyDown={(event) => handleCommitOnEnter(event, commitSiteTitle)}
          />
        </div>

        <div className="settings-field">
          <label>
            <FiImage size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            {t.faviconUrl}
          </label>
          <input
            type="text"
            className="settings-input soft-in"
            placeholder={t.faviconUrlPlaceholder}
            value={siteFaviconDraft}
            onChange={(e) => setSiteFaviconDraft(e.target.value)}
            onBlur={commitSiteFavicon}
            onKeyDown={(event) => handleCommitOnEnter(event, commitSiteFavicon)}
          />
        </div>
      </div>
    </section>
  )
}

export default SiteSection
