import { useEffect, useRef, useState } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { FiClock, FiGlobe, FiHome, FiSearch, FiSliders } from "react-icons/fi"
import { DEFAULT_SETTINGS, type ThemeMode, type VisualTheme } from "@neutab/shared/utils/settings"
import type { getTranslations } from "@neutab/shared/utils/i18n"
import { commitThemeCache } from "~utils/uiCache"

interface PersonalizationSectionProps {
  t: ReturnType<typeof getTranslations>
  themeMode: ThemeMode | undefined
  visualTheme: VisualTheme | undefined
  setVisualTheme: (v: VisualTheme) => Promise<void> | void
}

/** 个性化分区:视觉主题、组件显隐、网络环境 */
const PersonalizationSection = ({ t, themeMode, visualTheme, setVisualTheme }: PersonalizationSectionProps) => {
  const [showClock, setShowClock] = useStorage("showClock", DEFAULT_SETTINGS.showClock)
  const [showSeconds, setShowSeconds] = useStorage("showSeconds", DEFAULT_SETTINGS.showSeconds)
  const [showSearchBar, setShowSearchBar] = useStorage("showSearchBar", DEFAULT_SETTINGS.showSearchBar)
  const [showTopSites, setShowTopSites] = useStorage("showTopSites", DEFAULT_SETTINGS.showTopSites)
  const [showRecentHistory, setShowRecentHistory] = useStorage("showRecentHistory", DEFAULT_SETTINGS.showRecentHistory)
  const [autoSelectInternalUrl, setAutoSelectInternalUrl] = useStorage(
    "autoSelectInternalUrl",
    DEFAULT_SETTINGS.autoSelectInternalUrl
  )

  const [isVisualThemeOpen, setIsVisualThemeOpen] = useState(false)
  const visualThemeSelectRef = useRef<HTMLDivElement | null>(null)

  const currentVisualTheme = visualTheme || "neumorphic"
  const visualThemeOptions: { value: VisualTheme; label: string }[] = [
    { value: "neumorphic", label: t.themeNeumorphic },
    { value: "liquid-glass", label: t.themeLiquidGlass }
  ]
  const currentVisualThemeLabel =
    visualThemeOptions.find((option) => option.value === currentVisualTheme)?.label ?? t.themeNeumorphic

  useEffect(() => {
    if (!isVisualThemeOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (visualThemeSelectRef.current && !visualThemeSelectRef.current.contains(event.target as Node)) {
        setIsVisualThemeOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isVisualThemeOpen])

  return (
    <section className="settings-section" key="personalization">
      <h3>{t.appearanceAndDisplay}</h3>

      {/* 视觉主题岛屿 */}
      <div className="settings-island">
        <div className="island-row">
          <div className="row-left">
            <div className="row-icon icon-theme">
              <FiSliders size={18} />
            </div>
            <div className="row-text">
              <span className="row-title">{t.visualTheme}</span>
              <span className="row-desc">{t.visualThemeDesc}</span>
            </div>
          </div>
          <div className="language-select" ref={visualThemeSelectRef}>
            <button
              type="button"
              className="language-select-btn soft-in"
              onClick={() => setIsVisualThemeOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={isVisualThemeOpen}
            >
              <span>{currentVisualThemeLabel}</span>
              <span className={`language-select-arrow ${isVisualThemeOpen ? "open" : ""}`}>▼</span>
            </button>
            {isVisualThemeOpen && (
              <ul className="language-select-options soft-out" role="listbox">
                {visualThemeOptions.map((option) => (
                  <li
                    key={option.value}
                    role="option"
                    aria-selected={option.value === currentVisualTheme}
                    className={`language-select-option ${option.value === currentVisualTheme ? "selected" : ""}`}
                    onClick={() => {
                      commitThemeCache(themeMode || "auto", option.value)
                      void setVisualTheme(option.value)
                      setIsVisualThemeOpen(false)
                    }}
                  >
                    {option.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* 组件显示岛屿 */}
      <div className="settings-island">
        <div className="island-row-group">
          <label className="island-row compact">
            <div className="row-left">
              <div className="row-icon icon-clock">
                <FiClock size={18} />
              </div>
              <div className="row-text">
                <span className="row-title">{t.clock}</span>
              </div>
            </div>
            <div className="toggle-switch">
              <input type="checkbox" checked={!!showClock} onChange={() => setShowClock(!showClock)} />
              <span className="toggle-slider"></span>
            </div>
          </label>

          <label className={`island-row compact ${!showClock ? "disabled" : ""}`}>
            <div className="row-left">
              <div className="row-icon icon-seconds">
                <FiClock size={18} />
              </div>
              <div className="row-text">
                <span className="row-title">{t.showSeconds}</span>
              </div>
            </div>
            <div className="toggle-switch">
              <input
                type="checkbox"
                checked={!!showSeconds}
                onChange={() => setShowSeconds(!showSeconds)}
                disabled={!showClock}
              />
              <span className="toggle-slider"></span>
            </div>
          </label>
        </div>

        <div className="island-row-group">
          <label className="island-row compact">
            <div className="row-left">
              <div className="row-icon icon-search">
                <FiSearch size={18} />
              </div>
              <div className="row-text">
                <span className="row-title">{t.searchBar}</span>
              </div>
            </div>
            <div className="toggle-switch">
              <input
                type="checkbox"
                checked={!!showSearchBar}
                onChange={() => setShowSearchBar(!showSearchBar)}
              />
              <span className="toggle-slider"></span>
            </div>
          </label>
        </div>
      </div>

      {/* 快捷方式岛屿 (经常访问/最近访问) */}
      <div className="settings-island">
        <div className="island-row-group">
          <label className="island-row compact">
            <div className="row-left">
              <div className="row-icon icon-site">
                <FiGlobe size={18} />
              </div>
              <div className="row-text">
                <span className="row-title">{t.topSites}</span>
              </div>
            </div>
            <div className="toggle-switch">
              <input
                type="checkbox"
                checked={!!showTopSites}
                onChange={() => setShowTopSites(!showTopSites)}
              />
              <span className="toggle-slider"></span>
            </div>
          </label>

          <label className="island-row compact">
            <div className="row-left">
              <div className="row-icon icon-clock">
                <FiClock size={18} />
              </div>
              <div className="row-text">
                <span className="row-title">{t.recentHistory}</span>
              </div>
            </div>
            <div className="toggle-switch">
              <input
                type="checkbox"
                checked={!!showRecentHistory}
                onChange={() => setShowRecentHistory(!showRecentHistory)}
              />
              <span className="toggle-slider"></span>
            </div>
          </label>
        </div>
      </div>

      {/* 网络环境岛屿 (自动选择内网地址) */}
      <div className="settings-island">
        <div className="island-row-group">
          <label className="island-row compact">
            <div className="row-left">
              <div className="row-icon icon-site">
                <FiHome size={18} />
              </div>
              <div className="row-text">
                <span className="row-title">{t.autoSelectInternalUrl}</span>
                <span className="row-desc">{t.autoSelectInternalUrlDesc}</span>
              </div>
            </div>
            <div className="toggle-switch">
              <input
                type="checkbox"
                checked={!!autoSelectInternalUrl}
                onChange={() => setAutoSelectInternalUrl(!autoSelectInternalUrl)}
              />
              <span className="toggle-slider"></span>
            </div>
          </label>
        </div>
      </div>
    </section>
  )
}

export default PersonalizationSection
